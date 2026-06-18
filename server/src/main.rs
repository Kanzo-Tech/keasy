use keasy_server::{AppState, AuthServices, Database};
use keasy_server::config::ServerConfig;
use keasy_server::routes::{build_router, SessionConfig};
use secrecy::ExposeSecret;

use std::net::SocketAddr;
use std::sync::Arc;

use tracing::info;

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
    if config.oidc_client_id.is_some() && db.get_workspace_identity().await.is_none() {
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

    // Resolve this workspace's Keycloak Organization id from its alias. The org
    // is the membership container; members, invites, and the switcher key off it.
    let oidc_org_id = match (&keycloak_admin, &config.org_alias) {
        (Some(admin), Some(alias)) => match admin.resolve_org_id(alias).await {
            Ok(Some(id)) => Some(id),
            Ok(None) => {
                tracing::warn!(alias = %alias, "Keycloak organization not found for alias");
                None
            }
            Err(e) => {
                tracing::warn!(error = %e, alias = %alias, "Failed to resolve Keycloak organization");
                None
            }
        },
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

    let auth = AuthServices {
        oidc_state,
        keycloak_admin,
        oidc_issuer_url: config.oidc_issuer_url,
        oidc_client_id: config.oidc_client_id,
        oidc_client_secret: config.oidc_client_secret,
        oidc_org_id,
        central_mode: config.central_mode,
        control_plane_url: config.control_plane_url,
        control_plane_key: config.control_plane_key,
    };
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
        base_url: config.base_url,
        auth,
        catalog,
    };
    info!(
        oidc = if state.auth.oidc_state.is_some() { "ready" } else { "not configured" },
        "External services"
    );

    // Catalog durability net: periodically register any completed job whose
    // output never made it into the catalog (a miss at completion, a restart) and
    // deregister datasets whose job was deleted.
    if state.catalog.is_some() {
        keasy_server::catalog::reconcile::spawn(state.clone(), tokio::time::Duration::from_secs(60));
        info!("Catalog reconciler started (60s)");
    }

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

    deletion_task.abort();
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C handler");
    info!("Shutdown signal received");
}
