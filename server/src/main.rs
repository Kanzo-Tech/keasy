mod ai;
mod cloud;
mod config;
mod dcat;
mod graph;
mod job;
mod middleware;
mod rdf;
mod routes;
mod script;
mod settings;
mod validation;

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use secrecy::SecretString;
use tokio::sync::Mutex;
use tracing::{info, warn};

use config::ServerConfig;
use graph::rdf_graph::RdfGraph;
use job::runner::JobRunner;
use job::store::JobStore;
use settings::accounts::CloudAccountStore;
use settings::ai::AiSettings;
use settings::connections::ConnectionStore;
use settings::file_store::FileStore;
use settings::org::OrgSettings;
use settings::preferences::Preferences;

pub struct OutputCache {
    entries: HashMap<String, Arc<RdfGraph>>,
    order: VecDeque<String>,
    capacity: usize,
}

impl OutputCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            capacity,
        }
    }

    pub fn get(&mut self, job_id: &str) -> Option<Arc<RdfGraph>> {
        if self.entries.contains_key(job_id) {
            self.order.retain(|k| k != job_id);
            self.order.push_back(job_id.to_string());
            self.entries.get(job_id).cloned()
        } else {
            None
        }
    }

    pub fn insert(&mut self, job_id: String, graph: RdfGraph) -> Arc<RdfGraph> {
        if self.entries.contains_key(&job_id) {
            self.order.retain(|k| k != &job_id);
        } else {
            while self.entries.len() >= self.capacity {
                if let Some(evicted) = self.order.pop_front() {
                    self.entries.remove(&evicted);
                }
            }
        }
        let arc = Arc::new(graph);
        self.entries.insert(job_id.clone(), arc.clone());
        self.order.push_back(job_id);
        arc
    }

    pub fn remove(&mut self, job_id: &str) {
        self.entries.remove(job_id);
        self.order.retain(|k| k != job_id);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub store: JobStore,
    pub runner: Arc<JobRunner>,
    pub cloud_accounts: CloudAccountStore,
    pub connections: ConnectionStore,
    pub org_settings: FileStore<Option<OrgSettings>>,
    pub preferences: FileStore<Preferences>,
    pub ai_settings: FileStore<Option<AiSettings>>,
    pub catalog: Arc<RdfGraph>,
    pub output_cache: Arc<Mutex<OutputCache>>,
    pub api_key: SecretString,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let config = ServerConfig::from_env();

    if let Err(e) = std::fs::create_dir_all(&config.data_dir) {
        eprintln!("FATAL: Failed to create data dir {:?}: {e}", config.data_dir);
        std::process::exit(1);
    }

    if config.secret_key.is_none() {
        warn!("KEASY_SECRET_KEY is not set — cloud accounts will NOT be persisted to disk");
    }

    let store = JobStore::new();
    let ai_secret = config.secret_key.clone();
    let cloud_accounts = CloudAccountStore::new(&config.data_dir, config.secret_key);
    let connections = ConnectionStore::new(&config.data_dir);
    let org_settings = FileStore::new(config.data_dir.join("org_settings.json"), None);
    let preferences = FileStore::new(config.data_dir.join("preferences.json"), None);
    let ai_settings = FileStore::new(config.data_dir.join("ai_settings.json"), ai_secret);
    let catalog = Arc::new(RdfGraph::new());
    let output_cache = Arc::new(Mutex::new(OutputCache::new(config.cache_capacity)));
    let runner = Arc::new(JobRunner::new(
        store.clone(),
        cloud_accounts.clone(),
        catalog.clone(),
        config.max_concurrent_jobs,
        config.job_timeout_secs,
    ));

    let shutdown_grace = Duration::from_secs(config.shutdown_grace_secs);
    let state = AppState {
        store,
        runner: runner.clone(),
        cloud_accounts,
        connections,
        org_settings,
        preferences,
        ai_settings,
        catalog,
        output_cache,
        api_key: config.api_key,
    };
    let app = routes::build_router(state, config.cors_origins);

    let listener = match tokio::net::TcpListener::bind(config.bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("FATAL: Failed to bind to {}: {e}", config.bind_addr);
            std::process::exit(1);
        }
    };

    info!(addr = %config.bind_addr, "Keasy server listening");

    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        eprintln!("FATAL: Server error: {e}");
        std::process::exit(1);
    }

    runner.shutdown(shutdown_grace).await;
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C handler");
    info!("Shutdown signal received");
}
