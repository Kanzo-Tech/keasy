//! The catalog's durability net.
//!
//! Publishing a job's relations registers its output best-effort: a catalog
//! miss never fails a job whose data is already at the sink. This periodic pass
//! makes that safe — it registers any completed job whose output the catalog
//! does not hold (a missed registration, a restart mid-write) and deregisters
//! datasets whose job was deleted. The catalog is the authority on "is it
//! registered" (the job's schema exists), so no flag on `Job` can drift.
//!
//! Catalog metadata only: the bytes live in the sink, and keasy never deletes
//! them.

use std::collections::HashSet;
use std::time::Duration;

use tracing::{info, warn};

use super::Catalog;
use crate::AppState;
use crate::jobs::models::{Job, JobStatus};

/// Whether a job needs (re)registering this pass: a completed job whose corpus
/// reader has already said what the output is called, and whose dataset the
/// catalog doesn't hold yet. Pure so the reconciler's decision is testable
/// without an `AppState`.
///
/// The relations are the gate, not the report: naming a relation is the
/// corpus's answer and keasy has no way to produce one for a job that never
/// published any — such a job is skipped rather than guessed at.
fn needs_registration(job: &Job, registered: &HashSet<String>) -> bool {
    matches!(job.status, JobStatus::Completed)
        && !job.relations.is_empty()
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
    let catalog = state.catalog.clone();

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

    let jobs = match state.db.list_jobs().await {
        Ok(jobs) => jobs,
        Err(e) => {
            warn!(error = %e, "reconciler: failed to list jobs");
            return 0;
        }
    };

    // Register pass: completed jobs the catalog doesn't have yet.
    let mut registered_now = 0;
    for job in &jobs {
        if !needs_registration(job, &registered) {
            continue;
        }
        let relations = job.relations.clone();
        let (base, creds) = match state.db.job_output_target(job).await {
            Ok(Some(target)) => target,
            // The sink is gone: there is nothing left to read the output from.
            Ok(None) => continue,
            Err(e) => {
                warn!(job = %job.id, error = %e, "reconciler: failed to read the job's sink");
                continue;
            }
        };
        let dest = crate::jobs::dataset_dest(&base, &job.id);

        let catalog = catalog.clone();
        let id = job.id.clone();
        match tokio::task::spawn_blocking(move || catalog.register(&id, &dest, &relations, &creds))
            .await
        {
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

/// Spawn the periodic reconciler.
pub fn spawn(state: AppState, every: Duration) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        loop {
            tick.tick().await;
            let n = reconcile_once(&state).await;
            if n > 0 {
                info!(count = n, "reconciler pass registered datasets");
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::models::{OutputRelation, RunMode};

    fn job(id: &str, status: JobStatus, relations: Vec<OutputRelation>) -> Job {
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
            sink_connection_id: "sink".into(),
            script: None,
            manifest: None,
            relations,
        }
    }

    fn relations() -> Vec<OutputRelation> {
        vec![OutputRelation {
            name: "Person".into(),
            files: vec!["Person.parquet".into()],
            rows: Some(1),
        }]
    }

    #[test]
    fn registers_only_completed_with_relations_and_not_yet_registered() {
        let none = HashSet::new();

        // The one case that needs work: completed, has output, not registered.
        assert!(needs_registration(
            &job("a", JobStatus::Completed, relations()),
            &none
        ));

        // Not yet terminal / nothing published / failed → skip.
        assert!(!needs_registration(
            &job("b", JobStatus::Running, relations()),
            &none
        ));
        assert!(!needs_registration(
            &job("c", JobStatus::Completed, vec![]),
            &none
        ));
        assert!(!needs_registration(
            &job("d", JobStatus::Failed, relations()),
            &none
        ));

        // Already in the catalog → skip (idempotent across passes).
        let registered: HashSet<String> = ["a".to_string()].into_iter().collect();
        assert!(!needs_registration(
            &job("a", JobStatus::Completed, relations()),
            &registered
        ));
    }

    #[test]
    fn orphan_schemas_are_registered_minus_live() {
        // job ids sanitize `-` → `_`, so a live "a-1" covers schema "a_1".
        let registered: HashSet<String> = ["a_1".into(), "b".into(), "gone".into()]
            .into_iter()
            .collect();
        let live = vec!["a-1".to_string(), "b".to_string()];

        let orphans = orphan_schemas(&registered, &live);
        assert_eq!(
            orphans,
            vec!["gone".to_string()],
            "only the schema with no live job"
        );
    }

    /// End-to-end glue: `reconcile_once` over a REAL `AppState` (real `Database`
    /// + `Catalog`, local Parquet — no cloud stack). Verifies the deregister pass
    /// removes a ghost dataset (its job was deleted) while keeping a live job's,
    /// exercising the wiring the pure unit tests above don't.
    #[tokio::test]
    async fn reconcile_once_deregisters_ghost_keeps_live() {
        use crate::auth::jwt::Validator;
        use crate::catalog::Catalog;
        use crate::{AppState, Database};
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
        let dest = dir.path().display().to_string();

        // Catalog pre-loaded with two datasets; only one has a live job.
        let catalog = Arc::new(Catalog::open(dir.path()).unwrap());
        catalog
            .register("live", &dest, &relations(), &HashMap::new())
            .unwrap();
        catalog
            .register("ghost", &dest, &relations(), &HashMap::new())
            .unwrap();

        // Real DB holding only the live (already-registered) completed job.
        let db = Database::open(
            &dir.path().join("keasy.db"),
            crate::crypto::SecretKey::for_tests(),
        )
        .unwrap();
        db.insert_job(&job("live", JobStatus::Completed, relations()))
            .await
            .unwrap();

        let state = AppState {
            db,
            workspace_slug: None,
            auth: Arc::new(Validator::new(
                "https://id.test/realms/keasy",
                "keasy-api",
                "keasy-ws-test",
                None,
            )),
            catalog: catalog.clone(),
        };

        reconcile_once(&state).await;

        let registered = catalog.registered_jobs().unwrap();
        assert!(
            Catalog::is_registered(&registered, "live"),
            "live job's dataset kept"
        );
        assert!(
            !Catalog::is_registered(&registered, "ghost"),
            "ghost dataset deregistered"
        );
        assert!(
            parquet.exists(),
            "deregister never deletes the member's Parquet (BYOS)"
        );
    }
}
