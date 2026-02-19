use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use fossil_lang::runtime::executor::ExecutionConfig;
use fossil_lang::runtime::storage::StorageConfig;

use super::errors::{JobError, classify_error};
use super::store::JobStore;
use super::types::{JobStatus, now_iso8601};
use crate::cloud::resolver::CloudOutputResolver;
use crate::dcat::extract::extract_dcat_input;
use crate::dcat::generator::{build_catalog_triples, generate_dcat_catalog};
use crate::dcat::types::DcatInput;
use crate::rdf::format::RdfExportFormat;
use crate::graph::rdf_graph::RdfGraph;
use crate::routes::scripts::OutputInfo;
use crate::script::ScriptContext;
use crate::settings::accounts::CloudAccountStore;
use crate::settings::org::OrgSettings;

pub struct JobRunner {
    store: JobStore,
    cloud_accounts: CloudAccountStore,
    catalog: Arc<RdfGraph>,
    semaphore: Arc<Semaphore>,
    job_timeout: Duration,
    tasks: std::sync::Mutex<JoinSet<()>>,
}

impl JobRunner {
    pub fn new(
        store: JobStore,
        cloud_accounts: CloudAccountStore,
        catalog: Arc<RdfGraph>,
        max_concurrent: usize,
        job_timeout_secs: u64,
    ) -> Self {
        Self {
            store,
            cloud_accounts,
            catalog,
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            job_timeout: Duration::from_secs(job_timeout_secs),
            tasks: std::sync::Mutex::new(JoinSet::new()),
        }
    }

    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }

    pub fn spawn(
        &self,
        job_id: String,
        script: String,
        cloud_account_ids: Vec<String>,
        org_settings: Option<OrgSettings>,
        dcat_enabled: bool,
        dcat_format: Option<String>,
    ) {
        let store = self.store.clone();
        let semaphore = self.semaphore.clone();
        let cloud_accounts = self.cloud_accounts.clone();
        let catalog = self.catalog.clone();
        let job_timeout = self.job_timeout;

        // Build StorageConfig from selected cloud accounts
        let storage = cloud_accounts.build_storage_config(&cloud_account_ids);

        self.tasks.lock().expect("tasks lock poisoned").spawn(async move {
            let _permit = match semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => {
                    store.update(&job_id, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobError::new("INTERNAL_ERROR", "Failed to acquire execution permit"));
                        job.completed_at = Some(now_iso8601());
                    });
                    return;
                }
            };

            // Snapshot outputs from the stored job for DCAT extraction
            let (job_name, outputs) = store
                .get(&job_id)
                .map(|j| (j.name.clone(), j.outputs.clone()))
                .unwrap_or_default();

            store.update(&job_id, |job| {
                job.status = JobStatus::Running;
                job.started_at = Some(now_iso8601());
            });

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
                        &outputs,
                        dcat_format.as_deref(),
                    )
                }),
            )
            .await;

            match result {
                Ok(Ok(Ok((catalog_str, dcat_input)))) => {
                    info!(job_id = %job_id, "Job completed");
                    // Insert DCAT triples into the catalog
                    if let Some(input) = &dcat_input {
                        let graph_name = format!("urn:keasy:job:{job_id}");
                        let triples = build_catalog_triples(input);
                        catalog.insert_triples(Some(&graph_name), &triples);
                    }
                    store.update(&job_id, |job| {
                        job.status = JobStatus::Completed;
                        job.completed_at = Some(now_iso8601());
                        job.catalog = catalog_str;
                        job.dcat_input = dcat_input;
                    });
                }
                Ok(Ok(Err(err))) => {
                    error!(job_id = %job_id, error = %err, "Job failed");
                    store.update(&job_id, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(classify_error(&err));
                        job.completed_at = Some(now_iso8601());
                    });
                }
                Ok(Err(join_err)) => {
                    error!(job_id = %job_id, error = %join_err, "Job panicked");
                    store.update(&job_id, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobError::with_detail("INTERNAL_ERROR", "An internal error occurred", join_err.to_string()));
                        job.completed_at = Some(now_iso8601());
                    });
                }
                Err(_elapsed) => {
                    error!(job_id = %job_id, "Job execution timed out");
                    store.update(&job_id, |job| {
                        job.status = JobStatus::Failed;
                        job.error = Some(JobError::new("TIMEOUT", "Job execution timed out"));
                        job.completed_at = Some(now_iso8601());
                    });
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
    outputs: &[OutputInfo],
    dcat_format: Option<&str>,
) -> Result<(Option<String>, Option<DcatInput>), String> {
    let ctx = ScriptContext::new();

    let compiled = ctx
        .compile(&format!("job-{}", job_id), script, storage.clone())
        .map_err(|errors| errors.join("; "))?;

    // Extract DCAT metadata BEFORE execute (program is moved by execute)
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

    ctx.execute(compiled, config)?;

    // Generate catalog string after successful execution
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
