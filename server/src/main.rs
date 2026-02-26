mod ai;
mod cloud;
mod config;
mod crypto;
mod db;
mod dcat;
mod error;
mod graph;
mod job;
mod middleware;
mod pipeline;
mod rdf;
mod routes;
mod script;
mod settings;
mod tenant;
mod validation;

use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::Duration;

use secrecy::SecretString;
use tokio::sync::Mutex;
use tracing::{info, warn};

use config::ServerConfig;
use db::Database;
use graph::rdf_graph::RdfGraph;
use job::runner::JobRunner;

pub struct OutputCache(lru::LruCache<String, Arc<RdfGraph>>);

impl OutputCache {
    pub fn new(cap: usize) -> Self {
        Self(lru::LruCache::new(NonZeroUsize::new(cap).unwrap()))
    }
    pub fn get(&mut self, key: &str) -> Option<Arc<RdfGraph>> {
        self.0.get(key).cloned()
    }
    pub fn insert(&mut self, key: String, graph: RdfGraph) -> Arc<RdfGraph> {
        let arc = Arc::new(graph);
        self.0.put(key, arc.clone());
        arc
    }
    pub fn remove(&mut self, key: &str) {
        self.0.pop(key);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub runner: Arc<JobRunner>,
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
        warn!("KEASY_SECRET_KEY is not set — secrets will be stored unencrypted");
    }

    let db_path = config.data_dir.join("keasy.db");
    let db = match Database::open(&db_path, config.secret_key) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("FATAL: Failed to open database: {e}");
            std::process::exit(1);
        }
    };

    info!(path = %db_path.display(), "Database opened");

    if !db.verify_secret_key().await {
        eprintln!("FATAL: KEASY_SECRET_KEY does not match the key used to encrypt stored secrets");
        eprintln!("       Cloud account credentials will not be accessible.");
        eprintln!("       Set the correct KEASY_SECRET_KEY or remove the database to start fresh.");
        std::process::exit(1);
    }

    let catalog = Arc::new(RdfGraph::new());

    let mut restored = 0usize;
    // Phase 1 placeholder — Phase 4 middleware will pass real session context
    let catalog_ctx = tenant::TenantScoped::placeholder();
    for (job_id, turtle) in &db.completed_catalogs(&catalog_ctx).await {
        match graph::loader::parse_rdf_to_triples(turtle.as_bytes(), "catalog.ttl") {
            Ok(triples) => {
                catalog.insert_triples(Some(&format!("urn:keasy:job:{job_id}")), &triples);
                restored += 1;
            }
            Err(e) => warn!(job_id = %job_id, error = %e, "Failed to restore catalog"),
        }
    }
    if restored > 0 {
        info!(count = restored, "Restored catalogs into graph store");
    }

    let output_cache = Arc::new(Mutex::new(OutputCache::new(config.cache_capacity)));
    let runner = Arc::new(JobRunner::new(
        db.clone(),
        catalog.clone(),
        config.max_concurrent_jobs,
        config.job_timeout_secs,
    ));

    let shutdown_grace = Duration::from_secs(config.shutdown_grace_secs);
    let state = AppState {
        db,
        runner: runner.clone(),
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
