// server/src/catalog/reconcile.rs — the catalog durability net (§11).
//
// `complete_job` registers a job's output best-effort: a catalog miss never
// fails a job whose data is already at the sink. This periodic sweep is what
// makes that safe — it re-registers any completed job whose output isn't in the
// catalog yet (a missed registration, a catalog that was down at completion, a
// restart mid-write). The catalog itself is the authority on "is it registered"
// (the job's schema exists), so there is no flag on `Job` to drift.
//
// Promotion only — the orphan sweep (deleting sink objects under a job prefix
// that the catalog never referenced, past a grace window) is a separate step;
// it is the host's sole deleter and needs object_store list/delete + a window.

use std::collections::HashSet;
use std::time::Duration;

use futures::StreamExt;
use tracing::{info, warn};

use super::Catalog;
use crate::AppState;
use crate::jobs::models::{Job, JobStatus};

/// Whether a job needs (re)registering this pass: a completed job that produced
/// an output manifest and whose dataset the catalog doesn't already hold. Pure
/// so the reconciler's decision is testable without an `AppState`.
fn needs_registration(job: &Job, registered: &HashSet<String>) -> bool {
    matches!(job.status, JobStatus::Completed)
        && job.manifest.is_some()
        && !Catalog::is_registered(registered, &job.id)
}

/// Registered schemas with no live job behind them — datasets to deregister so
/// governance stops listing ghosts (e.g. a deleted job). `registered` and the
/// returned ids are `sanitize`d schema suffixes. BYOS-safe to act on: dropping a
/// schema never touches the member's Parquet. Pure for testability.
fn orphan_schemas(registered: &HashSet<String>, live_job_ids: &[String]) -> Vec<String> {
    let live: HashSet<String> = live_job_ids.iter().map(|id| super::sanitize(id)).collect();
    registered.difference(&live).cloned().collect()
}

/// One pass: register every completed job whose output the catalog doesn't have.
/// Idempotent and best-effort. Returns how many datasets it registered.
pub async fn reconcile_once(state: &AppState) -> usize {
    let Some(catalog) = state.catalog.clone() else {
        return 0;
    };

    // Snapshot what's already registered (one catalog read), then diff.
    let registered = {
        let catalog = catalog.clone();
        match tokio::task::spawn_blocking(move || catalog.registered_jobs()).await {
            Ok(Ok(set)) => set,
            Ok(Err(e)) => {
                warn!(error = %e, "reconciler: failed to list registered jobs");
                return 0;
            }
            Err(e) => {
                warn!(error = %e, "reconciler: registered-jobs task panicked");
                return 0;
            }
        }
    };

    let jobs = state.db.list_jobs().await;

    // Register pass: completed jobs the catalog doesn't have yet.
    let mut registered_now = 0;
    for job in &jobs {
        if !needs_registration(job, &registered) {
            continue;
        }
        let dataset = job.manifest.clone().expect("needs_registration checked manifest is_some");
        let Some((_, creds)) = state.db.job_output_target(job).await else {
            continue; // no sink configured — can't read the output to register it
        };

        let catalog = catalog.clone();
        let id = job.id.clone();
        match tokio::task::spawn_blocking(move || catalog.register(&id, &dataset, &creds)).await {
            Ok(Ok(())) => {
                registered_now += 1;
                info!(job = %job.id, "reconciler registered output");
            }
            Ok(Err(e)) => warn!(job = %job.id, error = %e, "reconciler: registration failed"),
            Err(e) => warn!(job = %job.id, error = %e, "reconciler: registration task panicked"),
        }
    }

    // Deregister pass: registered schemas with no live job (a deleted job).
    // BYOS-safe — drops only catalog metadata, never the member's Parquet.
    let live_ids: Vec<String> = jobs.iter().map(|j| j.id.clone()).collect();
    for orphan in orphan_schemas(&registered, &live_ids) {
        let catalog = catalog.clone();
        // `orphan` is the sanitized schema suffix; it round-trips through
        // `unregister` (which re-sanitizes — idempotent on already-safe input).
        match tokio::task::spawn_blocking(move || catalog.unregister(&orphan)).await {
            Ok(Ok(())) => info!("reconciler deregistered orphan dataset"),
            Ok(Err(e)) => warn!(error = %e, "reconciler: deregister failed"),
            Err(e) => warn!(error = %e, "reconciler: deregister task panicked"),
        }
    }

    registered_now
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::models::RunMode;
    use fossil_run_status::RunStatus;

    fn job(id: &str, status: JobStatus, manifest: Option<RunStatus>) -> Job {
        Job {
            id: id.into(),
            status,
            name: None,
            created_at: "t".into(),
            started_at: None,
            completed_at: None,
            error: None,
            mode: RunMode::Integrated,
            connection_ids: vec![],
            created_by: String::new(),
            sink_connection_id: None,
            script: None,
            manifest,
            catalog_manifest: None,
        }
    }

    fn manifest() -> RunStatus {
        RunStatus { version: 1, dest: "s3://b/x".into(), vertices: vec![], edges: vec![] }
    }

    #[test]
    fn registers_only_completed_with_manifest_and_not_yet_registered() {
        let none = HashSet::new();

        // The one case that needs work: completed, has output, not registered.
        assert!(needs_registration(&job("a", JobStatus::Completed, Some(manifest())), &none));

        // Not yet terminal / no output / failed → skip.
        assert!(!needs_registration(&job("b", JobStatus::Running, Some(manifest())), &none));
        assert!(!needs_registration(&job("c", JobStatus::Completed, None), &none));
        assert!(!needs_registration(&job("d", JobStatus::Failed, Some(manifest())), &none));

        // Already in the catalog → skip (idempotent across passes).
        let registered: HashSet<String> = ["a".to_string()].into_iter().collect();
        assert!(!needs_registration(&job("a", JobStatus::Completed, Some(manifest())), &registered));
    }

    #[test]
    fn orphan_schemas_are_registered_minus_live() {
        // job ids sanitize `-` → `_`, so a live "a-1" covers schema "a_1".
        let registered: HashSet<String> =
            ["a_1".into(), "b".into(), "gone".into()].into_iter().collect();
        let live = vec!["a-1".to_string(), "b".to_string()];

        let orphans = orphan_schemas(&registered, &live);
        assert_eq!(orphans, vec!["gone".to_string()], "only the schema with no live job");
    }

    #[test]
    fn orphan_disposition_keeps_live_sweeps_gone_and_stale_failures() {
        let now: jiff::Timestamp = "2026-06-16T12:00:00Z".parse().unwrap();
        let mut failed_old = job("x", JobStatus::Failed, None);
        let mut failed_recent = job("y", JobStatus::Failed, None);
        failed_old.completed_at = Some("2026-06-10T12:00:00Z".into()); // >24h ago
        failed_recent.completed_at = Some("2026-06-16T11:00:00Z".into()); // 1h ago

        // No job behind the prefix → orphaned.
        assert_eq!(orphan_disposition(None, now), Disposition::Sweep);
        // Live / in-flight → always kept.
        assert_eq!(orphan_disposition(Some(&job("a", JobStatus::Completed, None)), now), Disposition::Keep);
        assert_eq!(orphan_disposition(Some(&job("b", JobStatus::Running, None)), now), Disposition::Keep);
        // Failed past grace → swept; within grace → kept.
        assert_eq!(orphan_disposition(Some(&failed_old), now), Disposition::Sweep);
        assert_eq!(orphan_disposition(Some(&failed_recent), now), Disposition::Keep);
        // Failed but no timestamp → conservative keep.
        assert_eq!(orphan_disposition(Some(&job("z", JobStatus::Failed, None)), now), Disposition::Keep);
    }

    /// End-to-end glue: `reconcile_once` over a REAL `AppState` (real `Database`
    /// + `Catalog`, local Parquet — no cloud stack). Verifies the deregister pass
    /// removes a ghost dataset (its job was deleted) while keeping a live job's,
    /// exercising the wiring the pure unit tests above don't.
    #[tokio::test]
    async fn reconcile_once_deregisters_ghost_keeps_live() {
        use crate::catalog::Catalog;
        use crate::{AppState, AuthServices, Database};
        use fossil_run_status::VertexStatus;
        use std::collections::HashMap;
        use std::sync::Arc;

        let dir = tempfile::tempdir().unwrap();
        let probe = duckdb::Connection::open_in_memory().unwrap();
        let parquet = dir.path().join("Person.parquet");
        probe
            .execute_batch(&format!(
                "COPY (SELECT 1 AS id) TO '{}' (FORMAT parquet);",
                parquet.display(),
            ))
            .unwrap();
        let ds = || RunStatus {
            version: 1,
            dest: dir.path().display().to_string(),
            vertices: vec![VertexStatus {
                vertex_type: "Person".into(),
                rdf_type: None,
                file: "Person.parquet".into(),
                count: Some(1),
                columns: vec![],
            }],
            edges: vec![],
        };

        // Catalog pre-loaded with two datasets; only one has a live job.
        let catalog = Arc::new(Catalog::open(dir.path()).unwrap());
        catalog.register("live", &ds(), &HashMap::new()).unwrap();
        catalog.register("ghost", &ds(), &HashMap::new()).unwrap();

        // Real DB holding only the live (already-registered) completed job.
        let db = Database::open(&dir.path().join("keasy.db"), None).unwrap();
        db.insert_job(&job("live", JobStatus::Completed, Some(ds()))).await.unwrap();

        let state = AppState {
            db,
            api_key: secrecy::SecretString::from("test"),
            base_url: String::new(),
            auth: AuthServices {
                oidc_state: None,
                keycloak_admin: None,
                oidc_issuer_url: None,
                oidc_client_id: None,
                oidc_client_secret: None,
                oidc_org_id: None,
            },
            catalog: Some(catalog.clone()),
        };

        reconcile_once(&state).await;

        let registered = catalog.registered_jobs().unwrap();
        assert!(Catalog::is_registered(&registered, "live"), "live job's dataset kept");
        assert!(!Catalog::is_registered(&registered, "ghost"), "ghost dataset deregistered");
        assert!(parquet.exists(), "deregister never deletes the member's Parquet (BYOS)");
    }
}

// ── Storage orphan sweep (§11, the host's sole deleter) ──────────────────────

/// How long (hours) after a job terminally fails its output lingers before the
/// sweep may reclaim it — room to inspect/retry. (A *deleted* job's output is
/// orphaned at once; there is no job to wait on.)
const FAILED_GRACE_HOURS: i64 = 24;

/// What to do with a storage prefix `{substrate}/{job_id}`, given the job behind
/// it (or its absence). Prefix-level ONLY — never reasons about individual
/// objects, so it can't mistake a GraphAr manifest YAML (which the catalog never
/// references) for an orphan. Pure for testability.
#[derive(Debug, PartialEq, Eq)]
enum Disposition {
    Keep,
    Sweep,
}

fn orphan_disposition(job: Option<&Job>, now: jiff::Timestamp) -> Disposition {
    let Some(job) = job else {
        return Disposition::Sweep; // no such job → its output is orphaned
    };
    match job.status {
        // Live or in-flight — never touch.
        JobStatus::Completed | JobStatus::Running | JobStatus::Pending | JobStatus::Draft => {
            Disposition::Keep
        }
        // Terminally failed: reclaim only past the grace window.
        JobStatus::Failed | JobStatus::Cancelled => {
            let grace = jiff::Span::new().hours(FAILED_GRACE_HOURS);
            let expired = job
                .completed_at
                .as_deref()
                .and_then(|t| t.parse::<jiff::Timestamp>().ok())
                .and_then(|t| t.checked_add(grace).ok())
                .is_some_and(|deadline| now >= deadline);
            if expired { Disposition::Sweep } else { Disposition::Keep }
        }
    }
}

/// Sweep storage prefixes under the workspace substrate whose job no longer
/// exists (or terminally failed past the grace window). The host's ONLY deleter.
/// `delete` gates the destructive action: when false (the default) it is a
/// DRY-RUN that only logs what it would remove, so enabling real deletion is an
/// explicit, post-inspection choice. Substrate sink only — custom per-job sinks
/// are not swept (the sweep never sees them, so it can never wrongly delete one).
pub async fn sweep_storage_orphans(state: &AppState, delete: bool) {
    let Some((account_id, base_url)) = state.db.substrate_config().await else {
        return; // no substrate configured — nothing to sweep
    };
    let creds = state.db.build_storage_config(&[account_id]).await;
    let (store, prefix) = match crate::cloud::build_store(&base_url, &creds) {
        Ok(sp) => sp,
        Err(e) => {
            warn!(error = %e, "orphan sweep: failed to build substrate store");
            return;
        }
    };

    let prefix_opt = (!prefix.as_ref().is_empty()).then_some(&prefix);
    let listing = match store.list_with_delimiter(prefix_opt).await {
        Ok(l) => l,
        Err(e) => {
            warn!(error = %e, "orphan sweep: failed to list substrate");
            return;
        }
    };

    let now = jiff::Timestamp::now();
    for dir in listing.common_prefixes {
        let Some(job_id) = dir.filename() else { continue };
        let job = state.db.get_job(job_id).await;
        if orphan_disposition(job.as_ref(), now) == Disposition::Keep {
            continue;
        }

        // List the orphan prefix's objects and remove (or, in dry-run, count) them.
        let objects: Vec<_> = store
            .list(Some(&dir))
            .filter_map(|r| async { r.ok() })
            .collect()
            .await;

        if !delete {
            warn!(prefix = %dir, objects = objects.len(), "orphan sweep (DRY-RUN): would delete prefix — set KEASY_CATALOG_ORPHAN_SWEEP=true to enable");
            continue;
        }

        let mut deleted = 0;
        for obj in &objects {
            match store.delete(&obj.location).await {
                Ok(()) => deleted += 1,
                Err(e) => warn!(path = %obj.location, error = %e, "orphan sweep: delete failed"),
            }
        }
        info!(prefix = %dir, deleted, "orphan sweep: removed orphaned output");
    }
}

/// Spawn the periodic reconciler. Mirrors the session-cleanup background task.
pub fn spawn(state: AppState, every: Duration, orphan_delete: bool) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        loop {
            tick.tick().await;
            let n = reconcile_once(&state).await;
            if n > 0 {
                info!(count = n, "reconciler pass registered datasets");
            }
            sweep_storage_orphans(&state, orphan_delete).await;
        }
    })
}
