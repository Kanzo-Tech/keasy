use keasy_server::{AppState, OutputCache, Database, JobRunner, RdfGraph};
use keasy_server::config::ServerConfig;
use keasy_server::routes::build_router;
use keasy_server::tenant::TenantScoped;
use secrecy::ExposeSecret;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tracing::{info, warn};

use tower_sessions::ExpiredDeletion;

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
    // Startup catalog restore — uses startup_ctx (seed org) since no session context exists at boot
    let catalog_ctx = TenantScoped::startup_ctx();
    for (job_id, turtle) in &db.completed_catalogs(&catalog_ctx).await {
        match keasy_server::discovery::loader::parse_rdf_to_triples(turtle.as_bytes(), "catalog.ttl") {
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

    // Session store — separate tokio-rusqlite connection (safe in WAL mode).
    // tower-sessions-rusqlite-store manages its own schema via migrate().
    // Access tokio_rusqlite through the re-export from tower-sessions-rusqlite-store.
    let session_conn = tower_sessions_rusqlite_store::tokio_rusqlite::Connection::open(&db_path)
        .await
        .unwrap_or_else(|e| {
            eprintln!("FATAL: Failed to open session store connection: {e}");
            std::process::exit(1);
        });
    let session_store = tower_sessions_rusqlite_store::RusqliteStore::new(session_conn);
    session_store.migrate().await.unwrap_or_else(|e| {
        eprintln!("FATAL: Failed to migrate session store: {e}");
        std::process::exit(1);
    });

    // Background task: continuously delete expired sessions (every 60 seconds)
    let deletion_task = tokio::task::spawn(
        session_store
            .clone()
            .continuously_delete_expired(tokio::time::Duration::from_secs(60)),
    );

    let output_cache = Arc::new(Mutex::new(OutputCache::new(config.cache_capacity)));
    let runner = Arc::new(JobRunner::new(
        db.clone(),
        catalog.clone(),
        config.max_concurrent_jobs,
        config.job_timeout_secs,
    ));

    // Walt.id Verifier client — used for wallet connection (OID4VP).
    // Only active when KEASY_WALT_ID_VERIFIER_URL is configured.
    let vc_client = if config.walt_id_verifier_url.is_some() {
        Some(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap_or_default(),
        )
    } else {
        info!("Walt.id Verifier URL not configured — wallet connection disabled");
        None
    };

    // Keycloak admin client — only active when all three OIDC config fields are present
    let keycloak_admin = match (&config.oidc_issuer_url, &config.oidc_client_id, &config.oidc_client_secret) {
        (Some(issuer), Some(client_id), Some(secret)) => {
            match keasy_server::keycloak::admin::KeycloakAdmin::new(issuer, client_id, secret.clone()) {
                Ok(admin) => {
                    tracing::info!(issuer = %issuer, "Keycloak admin client configured");
                    Some(admin)
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to configure Keycloak admin client — instance registration will be unavailable");
                    None
                }
            }
        }
        _ => {
            tracing::info!("OIDC not configured — Keycloak admin client disabled");
            None
        }
    };

    // Build OIDC relying party client — only when all three config fields are present.
    let oidc_state = match (&config.oidc_issuer_url, &config.oidc_client_id, &config.oidc_client_secret) {
        (Some(issuer), Some(client_id), Some(secret)) => {
            let redirect_uri = format!(
                "{}/v1/auth/oidc-callback",
                config.base_url.trim_end_matches('/')
            );
            match keasy_server::auth::oidc::build_oidc_client(
                issuer,
                client_id,
                secret.expose_secret(),
                &redirect_uri,
                config.oidc_internal_base_url.as_deref(),
            )
            .await
            {
                Ok(state) => {
                    tracing::info!(issuer = %issuer, "OIDC relying party client initialized");
                    Some(Arc::new(state))
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to initialize OIDC client — OIDC auth will be unavailable"
                    );
                    None
                }
            }
        }
        _ => {
            tracing::info!("OIDC not fully configured — OIDC auth disabled");
            None
        }
    };

    // Ensure keasy:dataspaces protocol mapper exists in Keycloak (idempotent).
    // Best-effort: if it fails, the server still starts but custom claims may be missing.
    if let (Some(admin), Some(client_id)) = (&keycloak_admin, &config.oidc_client_id) {
        match admin.ensure_protocol_mapper(client_id).await {
            Ok(()) => tracing::debug!("Keycloak protocol mapper verified"),
            Err(e) => tracing::warn!(
                error = %e,
                "Failed to ensure keasy:dataspaces protocol mapper — custom claims may not appear in ID tokens"
            ),
        }
    }

    let shutdown_grace = Duration::from_secs(config.shutdown_grace_secs);
    let state = AppState {
        db,
        runner: runner.clone(),
        catalog,
        output_cache,
        api_key: config.api_key,
        base_url: config.base_url,
        vc_client,
        gxdch_notary_url: config.gxdch_notary_url,
        gxdch_compliance_url: config.gxdch_compliance_url,
        oidc_issuer_url: config.oidc_issuer_url,
        oidc_client_id: config.oidc_client_id,
        oidc_client_secret: config.oidc_client_secret,
        keycloak_admin,
        oidc_state,
    };
    let app = build_router(state, config.cors_origins, session_store, config.session_secret);

    let listener = match tokio::net::TcpListener::bind(config.bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("FATAL: Failed to bind to {}: {e}", config.bind_addr);
            std::process::exit(1);
        }
    };

    info!(addr = %config.bind_addr, "Keasy server listening");

    if let Err(e) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    {
        eprintln!("FATAL: Server error: {e}");
        std::process::exit(1);
    }

    runner.shutdown(shutdown_grace).await;
    deletion_task.abort();
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C handler");
    info!("Shutdown signal received");
}
