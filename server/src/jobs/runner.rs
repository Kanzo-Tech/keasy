use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Semaphore, broadcast};
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use crate::graph::manifest::DataManifest;

use super::errors::{JobRuntimeError, classify_error};
use super::models::{JobStatus, now_iso8601};
use crate::db::Repos;
use crate::graph::dcat::extract::extract_dcat_input;
use crate::graph::dcat::types::DcatInput;
use super::pipeline_types::PipelineOutput;
use super::script;
use crate::settings::org::OrgSettings;
use crate::tenant::{OrgId, TenantResource};

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
pub struct SpawnParams {
    pub org_id: String,
    pub job_id: String,
    pub script: String,
    pub org_settings: Option<OrgSettings>,
    pub dcat_enabled: bool,
    /// Pre-resolved catalog storage destination (promotor cloud).
    /// None when catalog storage is not configured.
    pub catalog_dest: Option<fossil_lang::traits::resolver::ResolvedPath>,
}

const TOTAL_PHASES: u8 = 5;

/// Value returned by [`run_job`] after successful script execution.
struct JobResult {
    dcat_input: Option<DcatInput>,
    /// Detected fragment base URL (present when `Rdf.fragments()` was used).
    rdf_base: Option<String>,
    /// GraphAr manifest with vertex/edge file paths and column statistics.
    manifest: Option<DataManifest>,
    /// DCAT-AP catalog manifest (parquets in promotor storage).
    catalog_manifest: Option<DataManifest>,
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
    db: Repos,
    semaphore: Arc<Semaphore>,
    job_timeout: Duration,
    tasks: std::sync::Mutex<JoinSet<()>>,
    progress: Arc<std::sync::Mutex<HashMap<String, broadcast::Sender<JobEvent>>>>,
}

impl JobRunner {
    pub fn new(
        db: Repos,
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
    /// `params.org_id` is the organization that owns this job.
    pub fn spawn(&self, params: SpawnParams) {
        let SpawnParams { org_id, job_id, script, org_settings, dcat_enabled, catalog_dest } = params;
        let db = self.db.clone();
        let semaphore = self.semaphore.clone();
        let job_timeout = self.job_timeout;
        let progress = self.progress.clone();

        // Create broadcast channel synchronously -- guaranteed to exist when spawn() returns
        let (tx, _) = broadcast::channel::<JobEvent>(16);
        {
            let mut map = progress.lock().expect("progress lock poisoned");
            map.insert(job_id.clone(), tx.clone());
        }

        self.tasks.lock().expect("tasks lock poisoned").spawn(async move {
            // Emit initial queued event
            if tx.send(JobEvent { phase: "queued".into(), index: 0, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

            let org = OrgId(org_id.clone());

            let _permit = match semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => {
                    let ctx = TenantResource { org_id: &org, id: job_id.as_str() };
                    if let Err(e) = db.update_job(&ctx, |job| {
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

            let job_ctx = TenantResource { org_id: &org, id: job_id.as_str() };

            let (job_name, pipeline_outputs) = db
                .get_job(&job_ctx)
                .await
                .map(|j| (j.name.clone(), j.pipeline.outputs.clone()))
                .unwrap_or_default();

            if let Err(e) = db.update_job(&job_ctx, |job| {
                job.status = JobStatus::Running;
                job.started_at = Some(now_iso8601());
            }).await {
                error!(job_id = %job_id, error = %e, "failed to update job");
            }

            info!(job_id = %job_id, "Job started");

            let job_id_clone = job_id.clone();
            let outputs = pipeline_outputs;
            let tx_blocking = tx.clone();
            let result = tokio::time::timeout(
                job_timeout,
                tokio::task::spawn_blocking(move || {
                    run_job(
                        &job_id_clone,
                        &script,
                        if dcat_enabled { org_settings.as_ref() } else { None },
                        job_name.as_deref(),
                        &outputs,
                        catalog_dest.as_ref(),
                        &tx_blocking,
                    )
                }),
            )
            .await
            .map_err(|_| JobFailure::Timeout)
            .and_then(|r| r.map_err(|e| JobFailure::Panic(e.to_string())))
            .and_then(|r| r.map_err(JobFailure::Execution));

            match result {
                Ok(JobResult { dcat_input, rdf_base, manifest, catalog_manifest, catalog_base }) => {
                    // Phase 3: finalizing
                    if tx.send(JobEvent { phase: "finalizing".into(), index: 3, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

                    if let Err(e) = db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Completed;
                        job.completed_at = Some(now_iso8601());
                        job.dcat_input = dcat_input;
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
                    if let Err(e) = db.update_job(&job_ctx, |job| {
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

fn run_job(
    job_id: &str,
    script_source: &str,
    org: Option<&OrgSettings>,
    job_name: Option<&str>,
    outputs: &[PipelineOutput],
    catalog_dest: Option<&fossil_lang::traits::resolver::ResolvedPath>,
    tx: &broadcast::Sender<JobEvent>,
) -> Result<JobResult, String> {
    // Phase 1: compiling
    if tx.send(JobEvent { phase: "compiling".into(), index: 1, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

    let plan = script::compile_to_plan(&format!("job-{}", job_id), script_source)
        .map_err(|errors| errors.join("; "))?;

    let completed_at = now_iso8601();
    let dcat_input = org.map(|org| {
        extract_dcat_input(job_id, job_name, &completed_at, org, outputs)
    });

    // Phase 2: executing
    if tx.send(JobEvent { phase: "executing".into(), index: 2, total: TOTAL_PHASES, error: None }).is_err() { warn!("SSE subscriber disconnected"); }

    // Execute the plan via Executor<DuckDB>
    let duckdb = super::duckdb_engine::DuckDbConn::new()
        .map_err(|e| format!("DuckDB init failed: {e}"))?;
    // Cloud credentials require SpawnParams to carry connector configs
    let exec = super::executor::Executor::new(duckdb);
    // Handlers registered when fossil-doc/fossil-graphar are added as deps
    let _results = exec.execute(&plan).map_err(|e| e.to_string())?;

    // Extract rdf_base and manifest from execution output
    let rdf_base = plan.outputs.first().map(|o| o.path.clone());
    let manifest: Option<DataManifest> = None; // GraphAr handler will provide this

    // Materialize DCAT-AP catalog as parquets (if dcat + manifest + dest available)
    let (catalog_manifest, catalog_base) = match (&dcat_input, &manifest, catalog_dest) {
        (Some(input), Some(data_manifest), Some(dest)) => {
            let dest_with_job = dest.join(&format!("{}/{job_id}", input.org.publisher_name));
            match crate::graph::dcat::materializer::materialize_catalog(input, data_manifest, &dest_with_job) {
                Ok(cat_manifest) => (Some(cat_manifest), Some(dest_with_job.to_str().to_string())),
                Err(e) => {
                    warn!("Catalog materialization failed (non-fatal): {e}");
                    (None, None)
                }
            }
        }
        _ => (None, None),
    };

    Ok(JobResult { dcat_input, rdf_base, manifest, catalog_manifest, catalog_base })
}
