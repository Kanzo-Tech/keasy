use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use fossil_lang::runtime::executor::ExecutionConfig;
use fossil_lang::runtime::storage::StorageConfig;

use super::errors::{JobError, classify_error};
use super::types::{JobStatus, now_iso8601};
use crate::cloud::resolver::CloudOutputResolver;
use crate::db::Database;
use crate::dcat::extract::extract_dcat_input;
use crate::dcat::generator::{build_catalog_triples, generate_dcat_catalog};
use crate::dcat::types::DcatInput;
use crate::rdf::format::RdfExportFormat;
use crate::graph::rdf_graph::RdfGraph;
use crate::pipeline::PipelineOutput;
use crate::script;
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
    catalog: Arc<RdfGraph>,
    semaphore: Arc<Semaphore>,
    job_timeout: Duration,
    tasks: std::sync::Mutex<JoinSet<()>>,
}

impl JobRunner {
    pub fn new(
        db: Database,
        catalog: Arc<RdfGraph>,
        max_concurrent: usize,
        job_timeout_secs: u64,
    ) -> Self {
        Self {
            db,
            catalog,
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            job_timeout: Duration::from_secs(job_timeout_secs),
            tasks: std::sync::Mutex::new(JoinSet::new()),
        }
    }

    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }

    /// Spawn a job execution task.
    /// `params.org_id` is the organization that owns this job. Phase 1 passes SEED_ORG_ID;
    /// Phase 4 will pass the real session org_id from the request context.
    pub fn spawn(&self, params: SpawnParams) {
        let SpawnParams { org_id, job_id, script, storage, org_settings, dcat_enabled, dcat_format } = params;
        let db = self.db.clone();
        let semaphore = self.semaphore.clone();
        let catalog = self.catalog.clone();
        let job_timeout = self.job_timeout;

        self.tasks.lock().expect("tasks lock poisoned").spawn(async move {
            // Construct a tenant-scoped context for all DAL calls within this task
            let make_ctx = || TenantScoped::new(OrgId(org_id.clone()), ());
            let make_scoped = |id: &str| TenantScoped::new(OrgId(org_id.clone()), id.to_string());

            let _permit = match semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => {
                    let ctx = make_scoped(&job_id);
                    let ctx_ref = TenantScoped::new(OrgId(org_id.clone()), ctx.inner().as_str());
                    db.update_job(&ctx_ref, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobError::new("INTERNAL_ERROR", "Failed to acquire execution permit"));
                        job.completed_at = Some(now_iso8601());
                    }).await;
                    return;
                }
            };

            let job_ctx = TenantScoped::new(OrgId(org_id.clone()), job_id.as_str());

            let (job_name, pipeline_outputs) = db
                .get_job(&job_ctx)
                .await
                .map(|j| (j.name.clone(), j.pipeline.outputs.clone()))
                .unwrap_or_default();

            db.update_job(&job_ctx, |job| {
                job.status = JobStatus::Running;
                job.started_at = Some(now_iso8601());
            }).await;

            info!(job_id = %job_id, "Job started");

            let job_id_clone = job_id.clone();
            let result = tokio::time::timeout(
                job_timeout,
                tokio::task::spawn_blocking(move || {
                    run_job(
                        &job_id_clone,
                        &script,
                        storage,
                        if dcat_enabled { org_settings.as_ref() } else { None },
                        job_name.as_deref(),
                        &pipeline_outputs,
                        dcat_format.as_deref(),
                    )
                }),
            )
            .await;

            let _ = make_ctx; // used above; suppress warning

            let job_ctx = TenantScoped::new(OrgId(org_id.clone()), job_id.as_str());

            match result {
                Ok(Ok(Ok((catalog_str, dcat_input)))) => {
                    info!(job_id = %job_id, "Job completed");
                    if let Some(input) = &dcat_input {
                        let graph_name = format!("urn:keasy:job:{job_id}");
                        let triples = build_catalog_triples(input);
                        catalog.insert_triples(Some(&graph_name), &triples);
                    }
                    db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Completed;
                        job.completed_at = Some(now_iso8601());
                        job.catalog = catalog_str;
                        job.dcat_input = dcat_input;
                    }).await;
                }
                Ok(Ok(Err(err))) => {
                    error!(job_id = %job_id, error = %err, "Job failed");
                    db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(classify_error(&err));
                        job.completed_at = Some(now_iso8601());
                    }).await;
                }
                Ok(Err(join_err)) => {
                    error!(job_id = %job_id, error = %join_err, "Job panicked");
                    db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobError::with_detail("INTERNAL_ERROR", "An internal error occurred", join_err.to_string()));
                        job.completed_at = Some(now_iso8601());
                    }).await;
                }
                Err(_elapsed) => {
                    error!(job_id = %job_id, "Job execution timed out");
                    db.update_job(&job_ctx, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobError::new("TIMEOUT", "Job execution timed out"));
                        job.completed_at = Some(now_iso8601());
                    }).await;
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
