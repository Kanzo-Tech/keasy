use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Semaphore, broadcast};
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use super::errors::{JobRuntimeError, classify_error};
use super::fossil_runner::{FossilRunner, RunCreds, RunStatus};
use super::models::{JobStatus, now_iso8601};
use crate::db::Database;
use crate::graph::dcat::extract::build_catalog_input;
use crate::settings::org::OrgSettings;

/// SSE event emitted by the job runner at each execution phase.
#[derive(Clone, Serialize, utoipa::ToSchema)]
pub struct JobEvent {
    pub phase: String,
    pub index: u8,
    pub total: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Parameters for spawning a job execution task.
/// Introduced to fix clippy::too_many_arguments on JobRunner::spawn().
pub struct SpawnParams {
    pub job_id: String,
    pub script: String,
    pub org_settings: Option<OrgSettings>,
    pub dcat_enabled: bool,
    /// Destination URL for the job's GraphAr output (owner storage + job id).
    /// None when no output storage is configured — the run fails fast.
    pub output_dest: Option<String>,
    /// Cloud secrets for the dest + `@conn` sources, piped to the subprocess.
    pub run_creds: RunCreds,
    /// Base URL for catalog storage (owner cloud). The dest cloud secret is
    /// reused from `run_creds.dest` (catalog + output share the owner
    /// account). None when catalog storage is not configured.
    pub catalog_dest: Option<String>,
}

const TOTAL_PHASES: u8 = 5;

/// Value returned by [`run_job`] after successful script execution.
struct JobResult {
    /// Base URL the GraphAr dataset was written under (the subprocess `--dest`).
    rdf_base: Option<String>,
    /// GraphAr structure from the subprocess (`RunStatus`).
    manifest: Option<RunStatus>,
    /// DCAT-AP catalog graph structure (`fossil catalog` subprocess output).
    catalog_manifest: Option<RunStatus>,
    /// Base URL for catalog parquets.
    catalog_base: Option<String>,
}

/// Flattened error from the three failure modes of job execution:
/// script error, task panic, or timeout.
enum JobFailure {
    Execution(String),
    Panic(String),
    Timeout,
}

impl JobFailure {
    fn runtime_error(&self) -> JobRuntimeError {
        match self {
            Self::Execution(err) => classify_error(err),
            Self::Panic(detail) => JobRuntimeError::with_detail(
                "INTERNAL_ERROR",
                "An internal error occurred",
                detail.clone(),
            ),
            Self::Timeout => JobRuntimeError::new("TIMEOUT", "Job execution timed out"),
        }
    }

    fn message(&self) -> &str {
        match self {
            Self::Execution(err) => err,
            Self::Panic(_) => "An internal error occurred",
            Self::Timeout => "Job execution timed out",
        }
    }
}

pub struct JobRunner {
    db: Database,
    semaphore: Arc<Semaphore>,
    job_timeout: Duration,
    tasks: std::sync::Mutex<JoinSet<()>>,
    progress: Arc<std::sync::Mutex<HashMap<String, broadcast::Sender<JobEvent>>>>,
}

impl JobRunner {
    pub fn new(
        db: Database,
        max_concurrent: usize,
        job_timeout_secs: u64,
    ) -> Self {
        Self {
            db,
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            job_timeout: Duration::from_secs(job_timeout_secs),
            tasks: std::sync::Mutex::new(JoinSet::new()),
            progress: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }

    /// Subscribe to progress events for a running job.
    /// Returns `None` if no broadcast channel exists (job already finished or not yet spawned).
    pub fn subscribe(&self, job_id: &str) -> Option<broadcast::Receiver<JobEvent>> {
        let map = self.progress.lock().expect("progress lock poisoned");
        map.get(job_id).map(|tx| tx.subscribe())
    }

    /// Spawn a job execution task.
    pub fn spawn(&self, params: SpawnParams) {
        let SpawnParams { job_id, script, org_settings, dcat_enabled, output_dest, run_creds, catalog_dest } = params;
        let db = self.db.clone();
        let semaphore = self.semaphore.clone();
        let job_timeout = self.job_timeout;
        let progress = self.progress.clone();

        // Create broadcast channel synchronously — guaranteed to exist when spawn() returns
        let (tx, _) = broadcast::channel::<JobEvent>(16);
        {
            let mut map = progress.lock().expect("progress lock poisoned");
            map.insert(job_id.clone(), tx.clone());
        }

        self.tasks.lock().expect("tasks lock poisoned").spawn(async move {
            // Emit initial queued event
            if tx.send(JobEvent { phase: "queued".into(), index: 0, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

            let _permit = match semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => {
                    if let Err(e) = db.update_job(&job_id, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobRuntimeError::new("INTERNAL_ERROR", "Failed to acquire execution permit"));
                        job.completed_at = Some(now_iso8601());
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                    if tx.send(JobEvent { phase: "error".into(), index: 0, total: TOTAL_PHASES, error: Some("Failed to acquire execution permit".into()) }).is_err() { warn!("SSE subscriber disconnected"); }
                    progress.lock().expect("progress lock poisoned").remove(&job_id);
                    return;
                }
            };

            let job_name = db.get_job(&job_id).await.and_then(|j| j.name.clone());

            if let Err(e) = db.update_job(&job_id, |job| {
                job.status = JobStatus::Running;
                job.started_at = Some(now_iso8601());
            }).await {
                error!(job_id = %job_id, error = %e, "failed to update job");
            }

            info!(job_id = %job_id, "Job started");

            let job_id_clone = job_id.clone();
            let tx_blocking = tx.clone();
            let result = tokio::time::timeout(
                job_timeout,
                tokio::task::spawn_blocking(move || {
                    run_job(
                        &job_id_clone,
                        &script,
                        output_dest.as_deref(),
                        &run_creds,
                        if dcat_enabled { org_settings.as_ref() } else { None },
                        job_name.as_deref(),
                        catalog_dest.as_deref(),
                        &tx_blocking,
                    )
                }),
            )
            .await
            .map_err(|_| JobFailure::Timeout)
            .and_then(|r| r.map_err(|e| JobFailure::Panic(e.to_string())))
            .and_then(|r| r.map_err(JobFailure::Execution));

            match result {
                Ok(JobResult { rdf_base, manifest, catalog_manifest, catalog_base }) => {
                    // Phase 3: finalizing
                    if tx.send(JobEvent { phase: "finalizing".into(), index: 3, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

                    if let Err(e) = db.update_job(&job_id, |job| {
                        job.status = JobStatus::Completed;
                        job.completed_at = Some(now_iso8601());
                        job.rdf_base = rdf_base;
                        job.manifest = manifest;
                        job.catalog_manifest = catalog_manifest;
                        job.catalog_base = catalog_base;
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                    info!(job_id = %job_id, "Job completed");
                    if tx.send(JobEvent { phase: "complete".into(), index: 4, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }
                }
                Err(failure) => {
                    let msg = failure.message();
                    let runtime_err = failure.runtime_error();
                    error!(job_id = %job_id, error = %msg, "Job failed");
                    if let Err(e) = db.update_job(&job_id, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(runtime_err);
                        job.completed_at = Some(now_iso8601());
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                    if tx.send(JobEvent { phase: "error".into(), index: 4, total: TOTAL_PHASES, error: Some(msg.to_string()) }).is_err() { warn!("SSE subscriber disconnected"); }
                }
            }

            // Remove sender so subscribe() returns None for finished jobs
            progress.lock().expect("progress lock poisoned").remove(&job_id);
        });
    }

    pub async fn shutdown(&self, grace: Duration) {
        let mut tasks = {
            let mut lock = self.tasks.lock().expect("tasks lock poisoned");
            std::mem::replace(&mut *lock, JoinSet::new())
        };

        let remaining = tasks.len();
        if remaining == 0 {
            return;
        }

        info!(remaining, "Waiting for running jobs to finish");
        match tokio::time::timeout(grace, async {
            while tasks.join_next().await.is_some() {}
        })
        .await
        {
            Ok(()) => info!("All jobs finished cleanly"),
            Err(_) => {
                let still_running = tasks.len();
                warn!(still_running, "Grace period expired, aborting remaining jobs");
                tasks.abort_all();
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_job(
    job_id: &str,
    script: &str,
    output_dest: Option<&str>,
    run_creds: &RunCreds,
    org: Option<&OrgSettings>,
    job_name: Option<&str>,
    catalog_dest: Option<&str>,
    tx: &broadcast::Sender<JobEvent>,
) -> Result<JobResult, String> {
    // Phase 1: compiling — the fossil subprocess parses + typechecks the program.
    if tx.send(JobEvent { phase: "compiling".into(), index: 1, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

    let dest_url = output_dest
        .ok_or_else(|| "no output storage configured for this job".to_string())?;

    // The subprocess reads the program from a file; write it to a temp path
    // anchored so any relative source paths resolve against it.
    let fossil_file = std::env::temp_dir().join(format!("keasy-job-{job_id}.fossil"));
    std::fs::write(&fossil_file, script)
        .map_err(|e| format!("failed to write pipeline file: {e}"))?;

    // Phase 2: executing — run the pipeline to GraphAr under `dest_url`.
    if tx.send(JobEvent { phase: "executing".into(), index: 2, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

    let run_result = FossilRunner::from_env().run(&fossil_file, dest_url, run_creds);
    let _ = std::fs::remove_file(&fossil_file);
    let run_status = run_result.map_err(|e| e.to_string())?;

    let completed_at = now_iso8601();

    // Materialize the DCAT-AP catalog (if dcat enabled + catalog storage set).
    // The catalog is "just another output graph": keasy assembles the
    // governance + dataset structure (`CatalogInput`) from the run manifest and
    // lets `fossil catalog` build + write the DCAT-AP graph (same GraphAr path
    // as the run). The DCAT-AP *shape* lives in fossil, not here.
    let (catalog_manifest, catalog_base) = match (org, catalog_dest) {
        (Some(org), Some(base)) => {
            let catalog_input =
                build_catalog_input(job_id, job_name, &completed_at, org, &run_status, dest_url);
            let dest_with_job =
                format!("{}/{}/{job_id}", base.trim_end_matches('/'), org.publisher_name);
            // The catalog shares the owner cloud account with the output, so
            // its dest secret is the run's dest secret.
            match FossilRunner::from_env().run_catalog(&catalog_input, &dest_with_job, &run_creds.dest) {
                Ok(cat_status) => (Some(cat_status), Some(dest_with_job)),
                Err(e) => {
                    warn!("Catalog materialization failed (non-fatal): {e}");
                    (None, None)
                }
            }
        }
        _ => (None, None),
    };

    Ok(JobResult {
        rdf_base: Some(dest_url.to_string()),
        manifest: Some(run_status),
        catalog_manifest,
        catalog_base,
    })
}
