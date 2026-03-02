use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use fossil_lang::runtime::executor::ExecutionConfig;
use fossil_lang::runtime::storage::StorageConfig;

use super::errors::{JobRuntimeError, classify_error};
use super::models::{JobStatus, now_iso8601};
use crate::cloud::resolver::CloudOutputResolver;
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

pub struct JobRunner {
    db: Database,
    graph_store: Arc<RdfGraph>,
    semaphore: Arc<Semaphore>,
    job_timeout: Duration,
    tasks: std::sync::Mutex<JoinSet<()>>,
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
        }
    }

    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }

    /// Spawn a job execution task.
    /// `params.org_id` is the organization that owns this job.
    pub fn spawn(&self, params: SpawnParams) {
        let SpawnParams { org_id, job_id, script, storage, org_settings, dcat_enabled, dcat_format } = params;
        let db = self.db.clone();
        let semaphore = self.semaphore.clone();
        let graph_store = self.graph_store.clone();
        let job_timeout = self.job_timeout;

        self.tasks.lock().expect("tasks lock poisoned").spawn(async move {
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
            let pipeline_outputs_for_blocking = pipeline_outputs.clone();
            let result = tokio::time::timeout(
                job_timeout,
                tokio::task::spawn_blocking(move || {
                    run_job(
                        &job_id_clone,
                        &script,
                        storage,
                        if dcat_enabled { org_settings.as_ref() } else { None },
                        job_name.as_deref(),
                        &pipeline_outputs_for_blocking,
                        dcat_format.as_deref(),
                    )
                }),
            )
            .await;

            match result {
                Ok(Ok(Ok((catalog_str, dcat_input)))) => {
                    info!(job_id = %job_id, "Job completed");
                    if let Some(input) = &dcat_input {
                        let graph_name = format!("urn:keasy:job:{job_id}");
                        let triples = build_catalog_triples(input);
                        graph_store.insert_triples(Some(&graph_name), &triples);
                    }
                    // Auto-load job output into graph store in the background
                    let graph_store_bg = graph_store.clone();
                    let db_bg = db.clone();
                    let org_id_bg = org_id.clone();
                    let job_id_bg = job_id.clone();
                    let outputs_bg = pipeline_outputs.clone();
                    tokio::spawn(async move {
                        let output_graph = format!("urn:keasy:output:{job_id_bg}");
                        if !graph_store_bg.graph_exists(&output_graph) {
                            let ctx = TenantScoped::new(OrgId(org_id_bg), ());
                            let creds = db_bg.env_snapshot_all(&ctx).await;
                            for output in &outputs_bg {
                                if let Some(dest) = &output.destination {
                                    match crate::cloud::reader::download(dest, &creds).await {
                                        Ok(bytes) => {
                                            if let Err(e) = graph_store_bg.bulk_load_bytes(Some(&output_graph), &bytes, dest) {
                                                warn!(job_id = %job_id_bg, url = %dest, error = %e, "Failed to auto-load output");
                                            }
                                        }
                                        Err(e) => warn!(job_id = %job_id_bg, url = %dest, error = %e, "Failed to download output"),
                                    }
                                }
                            }
                        }
                    });
                    if let Err(e) = db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Completed;
                        job.completed_at = Some(now_iso8601());
                        job.catalog = catalog_str;
                        job.dcat_input = dcat_input;
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                }
                Ok(Ok(Err(err))) => {
                    error!(job_id = %job_id, error = %err, "Job failed");
                    if let Err(e) = db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(classify_error(&err));
                        job.completed_at = Some(now_iso8601());
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                }
                Ok(Err(join_err)) => {
                    error!(job_id = %job_id, error = %join_err, "Job panicked");
                    if let Err(e) = db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobRuntimeError::with_detail("INTERNAL_ERROR", "An internal error occurred", join_err.to_string()));
                        job.completed_at = Some(now_iso8601());
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                }
                Err(_elapsed) => {
                    error!(job_id = %job_id, "Job execution timed out");
                    if let Err(e) = db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobRuntimeError::new("TIMEOUT", "Job execution timed out"));
                        job.completed_at = Some(now_iso8601());
                    }).await {
                        error!(job_id = %job_id, error = %e, "failed to update job");
                    }
                }
            }
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
) -> Result<(Option<String>, Option<DcatInput>), String> {
    let compiled = script::compile(&format!("job-{}", job_id), script, storage.clone())
        .map_err(|errors| errors.join("; "))?;

    let completed_at = now_iso8601();
    let dcat_input = org.map(|org| {
        extract_dcat_input(&compiled.program, job_id, job_name, &completed_at, org, outputs)
    });

    let handle = tokio::runtime::Handle::current();
    let creds_snapshot = storage.as_map().clone();
    let resolver = Arc::new(CloudOutputResolver::new(handle, creds_snapshot));
    let config = ExecutionConfig {
        output_resolver: resolver,
        storage,
    };

    script::execute(compiled, config)?;

    let format = dcat_format
        .map(RdfExportFormat::from_name)
        .transpose()?
        .unwrap_or(RdfExportFormat::Turtle);

    let catalog = dcat_input
        .as_ref()
        .map(|input| generate_dcat_catalog(input, format))
        .transpose()?;
    Ok((catalog, dcat_input))
}
