use keasy_server::{AppState, AuthServices, GaiaXServices, Database, JobRunner, RdfGraph};
use keasy_server::config::ServerConfig;
use keasy_server::routes::build_router;
use secrecy::ExposeSecret;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

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
    let db = match Database::open(&db_path, config.secret_key, config.seed_file.as_deref()) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("FATAL: Failed to open database: {e}");
            std::process::exit(1);
        }
    };

    info!(path = %db_path.display(), seed_file = ?config.seed_file, "Database opened");

    // Self-register in oidc_clients so workspace picker can find this instance
    if let Some(client_id) = &config.oidc_client_id {
        if let Err(e) = db
            .ensure_oidc_client(client_id, "This Instance", &config.base_url)
            .await
        {
            warn!(error = %e, "Failed to self-register in oidc_clients");
        }
    }

    if !db.verify_secret_key().await {
        eprintln!("FATAL: KEASY_SECRET_KEY does not match the key used to encrypt stored secrets");
        eprintln!("       Cloud account credentials will not be accessible.");
        eprintln!("       Set the correct KEASY_SECRET_KEY or remove the database to start fresh.");
        std::process::exit(1);
    }

    let catalog = Arc::new(RdfGraph::new());

    let mut restored = 0usize;
    for (job_id, turtle) in &db.completed_catalogs_all().await {
        match catalog.bulk_load_bytes(Some(&format!("urn:keasy:job:{job_id}")), turtle.as_bytes(), "catalog.ttl") {
            Ok(()) => restored += 1,
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
        None
    };

    // Walt.id Issuer client — used for OID4VCI credential export.
    // Only active when KEASY_WALT_ID_ISSUER_URL is configured.
    let issuer_client = if config.walt_id_issuer_url.is_some() {
        Some(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        )
    } else {
        None
    };

    // Keycloak admin client — only active when all three OIDC config fields are present.
    // Uses internal_base_url when set so admin API calls reach Keycloak via Docker DNS
    // (the public issuer URL resolves to this server container, not Keycloak).
    let keycloak_admin = match (&config.oidc_issuer_url, &config.oidc_client_id, &config.oidc_client_secret) {
        (Some(issuer), Some(client_id), Some(secret)) => {
            match keasy_server::keycloak::admin::KeycloakAdmin::new(
                issuer,
                client_id,
                secret.clone(),
                config.oidc_internal_base_url.as_deref(),
            ) {
                Ok(admin) => Some(admin),
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to configure Keycloak admin client — instance registration will be unavailable");
                    None
                }
            }
        }
        _ => None,
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
                Ok(state) => Some(Arc::new(state)),
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to initialize OIDC client — OIDC auth will be unavailable"
                    );
                    None
                }
            }
        }
        _ => None,
    };

    let shutdown_grace = Duration::from_secs(config.shutdown_grace_secs);
    let auth = AuthServices {
        oidc_state,
        keycloak_admin,
        oidc_issuer_url: config.oidc_issuer_url,
        oidc_client_id: config.oidc_client_id,
        oidc_client_secret: config.oidc_client_secret,
    };
    let gaia_x = GaiaXServices {
        vc_client,
        walt_id_verifier_url: config.walt_id_verifier_url,
        issuer_client,
        walt_id_issuer_url: config.walt_id_issuer_url,
        gxdch_notary_url: config.gxdch_notary_url,
        gxdch_compliance_url: config.gxdch_compliance_url,
        base_domain: config.base_domain,
    };
    let state = AppState {
        db,
        runner: runner.clone(),
        catalog,
        api_key: config.api_key,
        base_url: config.base_url,
        auth,
        gaia_x,
    };
    info!(
        wallet = if state.gaia_x.vc_client.is_some() { "ready" } else { "not configured" },
        issuer = if state.gaia_x.issuer_client.is_some() { "ready" } else { "not configured" },
        oidc = if state.auth.oidc_state.is_some() { "ready" } else { "not configured" },
        gxdch_notary = %state.gaia_x.gxdch_notary_url,
        gxdch_compliance = %state.gaia_x.gxdch_compliance_url,
        base_domain = state.gaia_x.base_domain.as_deref().unwrap_or("not configured"),
        "External services"
    );

    let app = build_router(state, config.cors_origins, session_store, config.session_secret, config.session_cookie_name);

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
