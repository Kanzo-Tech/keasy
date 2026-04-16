use keasy_server::{AppState, AuthServices, GaiaXServices, Repos, JobRunner};
use keasy_server::config::ServerConfig;
use keasy_server::routes::{build_router, SessionConfig};
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
    let repos = match Repos::open(&db_path, config.secret_key, config.seed_file.as_deref()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("FATAL: Failed to open database: {e}");
            std::process::exit(1);
        }
    };

    info!(path = %db_path.display(), seed_file = ?config.seed_file, "Repos opened");

    // Self-register in dataspaces so workspace picker can find this instance
    if let Some(client_id) = &config.oidc_client_id
        && let Err(e) = repos
            .ensure_dataspace(client_id, "This Instance", &config.base_url)
            .await
        {
            warn!(error = %e, "Failed to self-register in dataspaces");
        }

    if !repos.verify_secret_key().await {
        eprintln!("FATAL: KEASY_SECRET_KEY does not match the key used to encrypt stored secrets");
        eprintln!("       Cloud account credentials will not be accessible.");
        eprintln!("       Set the correct KEASY_SECRET_KEY or remove the database to start fresh.");
        std::process::exit(1);
    }

    // Session store — shares the Diesel pool (no separate rusqlite connection needed).
    // The tower_sessions table is created by schema::apply() during Repos::open().
    let session_store = keasy_server::db::session_store::DieselStore::new(repos.diesel_pool.clone());

    // Background task: continuously delete expired sessions (every 60 seconds)
    let deletion_task = tokio::task::spawn(
        session_store
            .clone()
            .continuously_delete_expired(tokio::time::Duration::from_secs(60)),
    );

    // Build Fossil compiler registry with keasy sources pre-registered.
    // Replaces old init_registry() global state pattern. The registry is
    // Send+Sync; per-job FossilDb instances are built from it in run_job.
    let fossil_registry = Arc::new(keasy_server::executor::fossil::build_fossil_registry());

    let runner = Arc::new(JobRunner::new(
        repos.clone(),
        config.max_concurrent_jobs,
        config.job_timeout_secs,
    ));

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
        gxdch: keasy_server::gaia_x::gxdch::GxdchClient::from_config(
            config.gxdch_mock,
            config.gxdch_notary_url,
            config.gxdch_compliance_url,
        ),
        base_domain: config.base_domain,
        caddy_certs_dir: config.caddy_certs_dir,
    };
    let state = AppState {
        repos,
        runner: runner.clone(),
        fossil_registry,
        api_key: config.api_key,
        base_url: config.base_url,
        auth,
        gaia_x,
    };
    info!(
        oidc = if state.auth.oidc_state.is_some() { "ready" } else { "not configured" },
        gxdch = %state.gaia_x.gxdch,
        base_domain = state.gaia_x.base_domain.as_deref().unwrap_or("not configured"),
        "External services"
    );

    let session_config = SessionConfig {
        store: session_store,
        secret: config.session_secret,
        cookie_name: config.session_cookie_name,
        secure: config.session_secure,
    };
    let app = build_router(state, config.cors_origins, session_config);

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
