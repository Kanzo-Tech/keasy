use keasy_server::auth::jwt::Validator;
use keasy_server::config::ServerConfig;
use keasy_server::routes::build_router;
use keasy_server::{AppState, Database};

use std::net::SocketAddr;
use std::sync::Arc;

use tracing::info;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let config = ServerConfig::from_env();

    if let Err(e) = std::fs::create_dir_all(&config.data_dir) {
        eprintln!(
            "FATAL: Failed to create data dir {:?}: {e}",
            config.data_dir
        );
        std::process::exit(1);
    }

    // Fail closed: without the encryption key, stored tenant connection creds
    // would be written in plaintext. Required (the deployment injects it as a
    // Swarm secret via KEASY_SECRET_KEY_FILE). See W4 in the deploy plan.
    if config.secret_key.is_none() {
        eprintln!("FATAL: KEASY_SECRET_KEY is required to encrypt stored credentials");
        eprintln!("       Generate one with: openssl rand -base64 32");
        std::process::exit(1);
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

    // Seed the local workspace identity (compliance metadata) once. Membership,
    // roles, and the workspace registry are all Keycloak-native now (the
    // Organization + client roles), so the server keeps no identity state.
    if db.get_workspace_identity().await.is_none() {
        db.set_workspace_identity(&keasy_server::settings::org::WorkspaceIdentity {
            name: config.workspace_name.clone(),
            legal_name: config.workspace_name.clone(),
            country: "EU".to_string(),
            ..Default::default()
        })
        .await;
    }

    if !db.verify_secret_key().await {
        eprintln!("FATAL: KEASY_SECRET_KEY does not match the key used to encrypt stored secrets");
        eprintln!("       Cloud account credentials will not be accessible.");
        eprintln!("       Set the correct KEASY_SECRET_KEY or remove the database to start fresh.");
        std::process::exit(1);
    }

    // The connections the environment declares (the dev bucket, and where output
    // lands) — after the key check, since creating them writes encrypted
    // credentials.
    keasy_server::connections::bootstrap::ensure_declared_connections(&db).await;

    // The bearer validator. Constructed without touching the network: Keycloak
    // is routinely not up when this is, and the keys are fetched on the first
    // request that needs them.
    let auth = Arc::new(Validator::new(
        &config.oidc_issuer_url,
        &config.oidc_audience,
        &config.oidc_client_id,
        config.oidc_internal_base_url.as_deref(),
    ));

    // Server-side DuckLake catalog (authority over output metadata). Non-fatal
    // if it fails to open — the host keeps serving jobs and the reconciler
    // registers their output once the catalog is back.
    let catalog = match keasy_server::catalog::Catalog::open(&config.data_dir) {
        Ok(c) => {
            info!("DuckLake catalog opened");
            Some(std::sync::Arc::new(c))
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to open DuckLake catalog — output registration disabled until reconcile");
            None
        }
    };

    let state = AppState {
        db,
        api_key: config.api_key,
        workspace_slug: config.workspace_slug,
        auth,
        catalog,
    };
    info!(
        issuer = %config.oidc_issuer_url,
        audience = %config.oidc_audience,
        client_id = %config.oidc_client_id,
        "Bearer tokens validated against"
    );

    // Catalog durability net: periodically register any completed job whose
    // output never made it into the catalog (a miss at completion, a restart) and
    // deregister datasets whose job was deleted.
    if state.catalog.is_some() {
        keasy_server::catalog::reconcile::spawn(
            state.clone(),
            tokio::time::Duration::from_secs(60),
        );
        info!("Catalog reconciler started (60s)");
    }

    let app = build_router(state, config.cors_origins);

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
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C handler");
    info!("Shutdown signal received");
}
