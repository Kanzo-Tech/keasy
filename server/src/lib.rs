mod ai;
mod auth;
mod cloud;
mod config;
mod connections;
mod crypto;
mod db;
mod discovery;
mod error;
mod jobs;
mod routes;
mod settings;

use std::sync::Arc;

use tracing::info;

use db::Database;
pub use routes::openapi;

#[derive(Clone)]
struct AppState {
    db: Database,
    /// This instance's workspace slug (`KEASY_ORG_ALIAS`), the "current" entry
    /// in the workspace switcher.
    workspace_slug: Option<String>,
    /// This instance's display name (`KEASY_WORKSPACE_NAME`).
    workspace_name: String,
    /// Verifies the bearer token every protected request carries.
    auth: auth::jwt::SharedValidator,
}

/// Configure from the environment, open the stores and serve until Ctrl+C.
pub async fn run() -> Result<(), String> {
    let config = config::ServerConfig::from_env();

    std::fs::create_dir_all(&config.data_dir)
        .map_err(|e| format!("failed to create data dir {:?}: {e}", config.data_dir))?;

    let db_path = config.data_dir.join("keasy.db");
    let db = Database::open(&db_path, config.secret_key)
        .map_err(|e| format!("failed to open the database: {e}"))?;
    info!(path = %db_path.display(), "Database opened");

    if !db
        .verify_secret_key()
        .await
        .map_err(|e| format!("failed to read the stored secrets: {e}"))?
    {
        return Err(
            "KEASY_SECRET_KEY does not open the secrets this database stores. \
             Set the key it was created with, or delete the data volume to start fresh"
                .into(),
        );
    }

    // After the key check: declaring a connection writes encrypted credentials.
    connections::bootstrap::ensure_declared_connections(&db).await;

    // Built without touching the network: Keycloak is routinely not up yet, and
    // the keys are fetched on the first request that needs them.
    let auth = Arc::new(auth::jwt::Validator::new(
        &config.oidc_issuer_url,
        &config.oidc_audience,
        &config.oidc_client_id,
        config.oidc_internal_base_url.as_deref(),
    ));
    info!(
        issuer = %config.oidc_issuer_url,
        audience = %config.oidc_audience,
        client_id = %config.oidc_client_id,
        "Bearer tokens validated against"
    );

    let state = AppState {
        db,
        workspace_slug: config.workspace_slug,
        workspace_name: config.workspace_name,
        auth,
    };

    let app = routes::build_router(state);
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .map_err(|e| format!("failed to bind to {}: {e}", config.bind_addr))?;
    info!(addr = %config.bind_addr, "Keasy server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            if tokio::signal::ctrl_c().await.is_ok() {
                info!("Shutdown signal received");
            }
        })
        .await
        .map_err(|e| format!("server error: {e}"))
}
