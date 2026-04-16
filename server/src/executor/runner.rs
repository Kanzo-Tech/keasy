use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use crate::graph::manifest::DataManifest;

use crate::jobs::errors::{JobRuntimeError, classify_error};
use crate::jobs::models::{JobStatus, now_iso8601};
use super::path_resolver::PathResolver;
use crate::db::Repos;
use crate::graph::dcat::extract::extract_dcat_input;
use crate::graph::dcat::types::DcatInput;
use crate::jobs::pipeline_types::PipelineOutput;
use super::script;
use crate::settings::org::OrgSettings;
use crate::tenant::{OrgId, TenantResource};

/// Parameters for spawning a job execution task.
pub struct SpawnParams {
    pub org_id: String,
    pub job_id: String,
    pub script: String,
    pub org_settings: Option<OrgSettings>,
    pub dcat_enabled: bool,
    pub fossil_registry: Arc<fossil_lang::FossilRegistry>,
    pub path_resolver: Arc<dyn PathResolver>,
}

struct JobResult {
    dcat_input: Option<DcatInput>,
    rdf_base: Option<String>,
    manifest: Option<DataManifest>,
    catalog_manifest: Option<DataManifest>,
    catalog_base: Option<String>,
}

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
        }
    }

    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }

    pub fn spawn(&self, params: SpawnParams) {
        let SpawnParams { org_id, job_id, script, org_settings, dcat_enabled, fossil_registry, path_resolver } = params;
        let db = self.db.clone();
        let semaphore = self.semaphore.clone();
        let job_timeout = self.job_timeout;

        self.tasks.lock().expect("tasks lock poisoned").spawn(async move {
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
            let registry_blocking = fossil_registry.clone();
            let resolver_blocking = path_resolver.clone();
            let result = tokio::time::timeout(
                job_timeout,
                tokio::task::spawn_blocking(move || {
                    let fossil_db =
                        super::fossil::build_fossil_db(&registry_blocking);
                    run_job(
                        &job_id_clone,
                        &fossil_db,
                        &script,
                        if dcat_enabled { org_settings.as_ref() } else { None },
                        job_name.as_deref(),
                        &outputs,
                        &resolver_blocking,
                    )
                }),
            )
            .await
            .map_err(|_| JobFailure::Timeout)
            .and_then(|r| r.map_err(|e| JobFailure::Panic(e.to_string())))
            .and_then(|r| r.map_err(JobFailure::Execution));

            match result {
                Ok(JobResult { dcat_input, rdf_base, manifest, catalog_manifest, catalog_base }) => {
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
    fossil_db: &fossil_lang::FossilDb,
    script_source: &str,
    org: Option<&OrgSettings>,
    job_name: Option<&str>,
    outputs: &[PipelineOutput],
    path_resolver: &Arc<dyn PathResolver>,
) -> Result<JobResult, String> {
    let plan = script::compile_to_plan(fossil_db, &format!("job-{}", job_id), script_source)
        .map_err(|errors| errors.join("; "))?;

    let completed_at = now_iso8601();
    let dcat_input = org.map(|org| {
        extract_dcat_input(job_id, job_name, &completed_at, org, outputs)
    });

    let duckdb = super::duckdb::DuckDbConn::new()
        .map_err(|e| format!("DuckDB init failed: {e}"))?;

    duckdb
        .load_extensions(&["httpfs", "azure"])
        .map_err(|e| format!("DuckDB load_extensions failed: {e}"))?;
    for entry in path_resolver.entries() {
        duckdb
            .install_secret(&entry.name, &entry.base_url, &entry.secret_spec)
            .map_err(|e| format!("install secret '{}': {e}", entry.name))?;
    }

    use super::fossil::DuckDbNativeHandler;
    let exec = super::engine::Executor::new(duckdb)
        .source(DuckDbNativeHandler::new("csv", path_resolver.clone()))
        .source(DuckDbNativeHandler::new("parquet", path_resolver.clone()))
        .source(DuckDbNativeHandler::new("json", path_resolver.clone()))
        .source(DuckDbNativeHandler::new("excel", path_resolver.clone()));
    let results = exec.execute(&plan).map_err(|e| e.to_string())?;

    let rdf_base = results.first().map(|r| r.path.clone());
    let manifest: Option<DataManifest> = None;

    Ok(JobResult { dcat_input, rdf_base, manifest, catalog_manifest: None, catalog_base: None })
}
