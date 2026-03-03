use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Semaphore, broadcast};
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use fossil_lang::runtime::executor::ExecutionConfig;
use fossil_lang::runtime::storage::StorageConfig;

use super::errors::{JobRuntimeError, classify_error};
use super::models::{JobStatus, now_iso8601};
use crate::cloud::resolver::CloudOutputResolver;
use crate::cloud::tee_resolver::{CapturedOutput, TeeOutputResolver};
use crate::db::Database;
use crate::discovery::dcat_extract::extract_dcat_input;
use crate::discovery::dcat_generator::{build_catalog_triples, generate_dcat_catalog};
use crate::discovery::dcat_types::DcatInput;
use crate::discovery::rdf_format::RdfExportFormat;
use crate::discovery::rdf_graph::RdfGraph;
use super::pipeline_types::PipelineOutput;
use super::script;
use crate::settings::org::OrgSettings;
use crate::tenant::{OrgId, TenantScoped};

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
    pub org_id: String,
    pub job_id: String,
    pub script: String,
    pub storage: StorageConfig,
    pub org_settings: Option<OrgSettings>,
    pub dcat_enabled: bool,
    pub dcat_format: Option<String>,
}

const TOTAL_PHASES: u8 = 5;

/// Value returned by [`run_job`] after successful script execution.
struct JobResult {
    catalog: Option<String>,
    dcat_input: Option<DcatInput>,
    captured: Vec<CapturedOutput>,
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
    graph_store: Arc<RdfGraph>,
    semaphore: Arc<Semaphore>,
    job_timeout: Duration,
    tasks: std::sync::Mutex<JoinSet<()>>,
    progress: Arc<std::sync::Mutex<HashMap<String, broadcast::Sender<JobEvent>>>>,
}

impl JobRunner {
    pub fn new(
        db: Database,
        graph_store: Arc<RdfGraph>,
        max_concurrent: usize,
        job_timeout_secs: u64,
    ) -> Self {
        Self {
            db,
            graph_store,
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
        let SpawnParams { org_id, job_id, script, storage, org_settings, dcat_enabled, dcat_format } = params;
        let db = self.db.clone();
        let semaphore = self.semaphore.clone();
        let graph_store = self.graph_store.clone();
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
            let _ = tx.send(JobEvent { phase: "queued".into(), index: 0, total: TOTAL_PHASES, error: None });

            let _permit = match semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => {
                    let ctx = TenantScoped::new(OrgId(org_id.clone()), job_id.as_str());
                    if let Err(e) = db.update_job(&ctx, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobRuntimeError::new("INTERNAL_ERROR", "Failed to acquire execution permit"));
                        job.completed_at = Some(now_iso8601());
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                    let _ = tx.send(JobEvent { phase: "error".into(), index: 0, total: TOTAL_PHASES, error: Some("Failed to acquire execution permit".into()) });
                    progress.lock().expect("progress lock poisoned").remove(&job_id);
                    return;
                }
            };

            let job_ctx = TenantScoped::new(OrgId(org_id.clone()), job_id.as_str());

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
                        storage,
                        if dcat_enabled { org_settings.as_ref() } else { None },
                        job_name.as_deref(),
                        &outputs,
                        dcat_format.as_deref(),
                        &tx_blocking,
                    )
                }),
            )
            .await
            .map_err(|_| JobFailure::Timeout)
            .and_then(|r| r.map_err(|e| JobFailure::Panic(e.to_string())))
            .and_then(|r| r.map_err(JobFailure::Execution));

            match result {
                Ok(JobResult { catalog, dcat_input, captured }) => {
                    // Phase 3: finalizing — load outputs into graph store
                    let _ = tx.send(JobEvent { phase: "finalizing".into(), index: 3, total: TOTAL_PHASES, error: None });

                    if let Some(input) = &dcat_input {
                        let graph_name = format!("urn:keasy:job:{job_id}");
                        let triples = build_catalog_triples(input);
                        graph_store.insert_triples(Some(&graph_name), &triples);
                    }

                    let output_graph = format!("urn:keasy:output:{job_id}");
                    if !graph_store.graph_exists(&output_graph) {
                        for output in &captured {
                            if let Err(e) = graph_store.bulk_load_bytes(Some(&output_graph), &output.bytes, &output.url) {
                                warn!(job_id = %job_id, url = %output.url, error = %e, "Failed to load captured output");
                            }
                        }
                    }

                    if let Err(e) = db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Completed;
                        job.completed_at = Some(now_iso8601());
                        job.catalog = catalog;
                        job.dcat_input = dcat_input;
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                    info!(job_id = %job_id, "Job completed");
                    let _ = tx.send(JobEvent { phase: "complete".into(), index: 4, total: TOTAL_PHASES, error: None });
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
                    let _ = tx.send(JobEvent { phase: "error".into(), index: 4, total: TOTAL_PHASES, error: Some(msg.to_string()) });
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
    script: &str,
    storage: StorageConfig,
    org: Option<&OrgSettings>,
    job_name: Option<&str>,
    outputs: &[PipelineOutput],
    dcat_format: Option<&str>,
    tx: &broadcast::Sender<JobEvent>,
) -> Result<JobResult, String> {
    // Phase 1: compiling
    let _ = tx.send(JobEvent { phase: "compiling".into(), index: 1, total: TOTAL_PHASES, error: None });

    let compiled = script::compile(&format!("job-{}", job_id), script, storage.clone())
        .map_err(|errors| errors.join("; "))?;

    let completed_at = now_iso8601();
    let dcat_input = org.map(|org| {
        extract_dcat_input(&compiled.program, job_id, job_name, &completed_at, org, outputs)
    });

    // Phase 2: executing
    let _ = tx.send(JobEvent { phase: "executing".into(), index: 2, total: TOTAL_PHASES, error: None });

    let handle = tokio::runtime::Handle::current();
    let creds_snapshot = storage.as_map().clone();
    let cloud_resolver = Arc::new(CloudOutputResolver::new(handle, creds_snapshot));
    let tee_resolver = Arc::new(TeeOutputResolver::new(cloud_resolver));
    let config = ExecutionConfig {
        output_resolver: tee_resolver.clone(),
        storage,
    };

    script::execute(compiled, config)?;

    let captured = tee_resolver.take_captured();

    let format = dcat_format
        .map(RdfExportFormat::from_name)
        .transpose()?
        .unwrap_or(RdfExportFormat::Turtle);

    let catalog = dcat_input
        .as_ref()
        .map(|input| generate_dcat_catalog(input, format))
        .transpose()?;
    Ok(JobResult { catalog, dcat_input, captured })
}
