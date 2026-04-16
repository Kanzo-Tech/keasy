use axum::extract::DefaultBodyLimit;
use axum::http::header::{self, HeaderName};
use axum::http::HeaderValue;
use axum::routing::get;
use axum::{middleware, Router};
use secrecy::ExposeSecret;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tower_sessions::cookie::{Key, SameSite};
use tower_sessions::{ExpiredDeletion, SessionManagerLayer};

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tracing::{info, warn};

use crate::config::ServerConfig;
use crate::middleware::session_auth::session_required;
use crate::middleware::tenant::tenant_context_required;
use crate::{AppState, AuthServices, GaiaXServices, JobRunner, Repos};

/// Session configuration — groups the 4 session-related params for router construction.
pub struct SessionConfig {
    pub store: crate::auth::session_store::DieselStore,
    pub secret: secrecy::SecretString,
    pub cookie_name: String,
    pub secure: bool,
}

pub struct Application {
    listener: tokio::net::TcpListener,
    app: Router,
    runner: Arc<JobRunner>,
    shutdown_grace: Duration,
    deletion_task: tokio::task::JoinHandle<Result<(), tower_sessions::session_store::Error>>,
}

impl Application {
    pub async fn build(config: ServerConfig) -> Self {
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
        let session_store =
            crate::auth::session_store::DieselStore::new(repos.diesel_pool.clone());

        // Background task: continuously delete expired sessions (every 60 seconds)
        let deletion_task = tokio::task::spawn(
            session_store
                .clone()
                .continuously_delete_expired(tokio::time::Duration::from_secs(60)),
        );

        // Build Fossil compiler registry with keasy sources pre-registered.
        let fossil_registry =
            Arc::new(crate::executor::fossil::build_fossil_registry());

        let runner = Arc::new(JobRunner::new(
            repos.clone(),
            config.max_concurrent_jobs,
            config.job_timeout_secs,
        ));

        // Keycloak admin client — only active when all three OIDC config fields are present.
        let keycloak_admin = match (
            &config.oidc_issuer_url,
            &config.oidc_client_id,
            &config.oidc_client_secret,
        ) {
            (Some(issuer), Some(client_id), Some(secret)) => {
                match crate::keycloak::admin::KeycloakAdmin::new(
                    issuer,
                    client_id,
                    secret.clone(),
                    config.oidc_internal_base_url.as_deref(),
                ) {
                    Ok(admin) => Some(admin),
                    Err(e) => {
                        warn!(error = %e, "Failed to configure Keycloak admin client — instance registration will be unavailable");
                        None
                    }
                }
            }
            _ => None,
        };

        // Build OIDC relying party client — only when all three config fields are present.
        let oidc_state = match (
            &config.oidc_issuer_url,
            &config.oidc_client_id,
            &config.oidc_client_secret,
        ) {
            (Some(issuer), Some(client_id), Some(secret)) => {
                let redirect_uri = format!(
                    "{}/v1/auth/oidc-callback",
                    config.base_url.trim_end_matches('/')
                );
                match crate::auth::oidc::build_oidc_client(
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
                        warn!(
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
            gxdch: crate::gaia_x::gxdch::GxdchClient::from_config(
                config.gxdch_mock,
                config.gxdch_notary_url,
                config.gxdch_compliance_url,
            ),
            base_domain: config.base_domain,
            caddy_certs_dir: config.caddy_certs_dir,
        };
        let connector_repo = Arc::new(crate::connectors::db::DieselConnectorRepo::new(repos.clone()));
        let job_repo = Arc::new(crate::jobs::db::DieselJobRepo::new(repos.clone()));
        let settings_repo = Arc::new(crate::settings::db::DieselSettingsRepo::new(repos.clone()));
        let gaia_x_repo = Arc::new(crate::gaia_x::db::DieselGaiaXRepo::new(repos.clone()));
        let org_repo = Arc::new(crate::org::db::DieselOrgRepo::new(repos.diesel_pool.clone()));
        let org_service = crate::org::service::OrgService::new(org_repo);
        let state = AppState {
            repos,
            runner: runner.clone(),
            fossil_registry,
            connectors: connector_repo,
            jobs: job_repo,
            settings: settings_repo,
            gaia_x_repo,
            orgs: org_service,
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

        Self {
            listener,
            app,
            runner,
            shutdown_grace,
            deletion_task,
        }
    }

    pub fn port(&self) -> u16 {
        self.listener.local_addr().unwrap().port()
    }

    pub async fn run_until_stopped(self) {
        if let Err(e) = axum::serve(
            self.listener,
            self.app
                .into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(shutdown_signal())
        .await
        {
            eprintln!("FATAL: Server error: {e}");
            std::process::exit(1);
        }

        self.runner.shutdown(self.shutdown_grace).await;
        self.deletion_task.abort();
    }
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C handler");
    info!("Shutdown signal received");
}

fn build_router(
    state: AppState,
    cors_origins: Option<Vec<String>>,
    session: SessionConfig,
) -> Router {
    // Build the session layer with signed cookies
    let key_bytes = derive_session_key(session.secret.expose_secret().as_bytes());
    let key = Key::from(&key_bytes);

    let session_layer = SessionManagerLayer::new(session.store)
        .with_name(session.cookie_name)
        .with_http_only(true)
        .with_same_site(SameSite::Lax)
        .with_secure(session.secure)
        .with_expiry(tower_sessions::Expiry::OnInactivity(
            time::Duration::hours(24),
        ))
        .with_signed(key);

    // Health routes — NOT rate-limited (LB probes must not eat the budget)
    let health_routes = crate::health::routes().with_state(state.clone());

    // Public routes — no auth required
    let public_api_routes = Router::new()
        .route("/openapi.json", get(crate::openapi::openapi_json))
        .merge(crate::health::public_routes())
        .merge(crate::settings::public_routes())
        .merge(crate::gaia_x::public_routes())
        .with_state(state.clone());

    // Public auth routes (no session middleware)
    let auth_routes = crate::auth::public_routes().with_state(state.clone());

    // Session-authenticated routes (session required, NO tenant context required)
    let session_auth_routes = crate::auth::session_routes()
        .layer(middleware::from_fn_with_state(
            state.clone(),
            session_required,
        ))
        .with_state(state.clone());

    // All API routes — session + tenant context required
    let api_routes = Router::new()
        .merge(crate::jobs::api_routes())
        .merge(crate::executor::api_routes())
        .merge(crate::settings::api_routes())
        .merge(crate::connectors::api_routes())
        .merge(crate::org::api_routes())
        .merge(crate::gaia_x::api_routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            tenant_context_required, // runs second (inner), after session_required
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            session_required, // runs first (outer)
        ))
        .with_state(state);

    let cors = match cors_origins {
        Some(origins) => {
            let origins: Vec<_> = origins.iter().filter_map(|o| o.parse().ok()).collect();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
        }
        None => {
            if cfg!(debug_assertions) {
                tracing::warn!("CORS: allowing all origins (dev mode)");
                CorsLayer::permissive()
            } else {
                panic!("KEASY_CORS_ORIGINS must be set in production");
            }
        }
    };

    let security_headers = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-xss-protection"),
            HeaderValue::from_static("1; mode=block"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ));

    // Rate limiting — relaxed in dev to support DuckDB concurrent range requests
    let (rps, burst) = if cfg!(debug_assertions) {
        (100, 500)
    } else {
        (20, 100)
    };
    let governor_conf = tower_governor::governor::GovernorConfigBuilder::default()
        .per_second(rps)
        .burst_size(burst)
        .finish()
        .unwrap();

    // Rate-limited routes (excludes health checks so LB probes don't eat the budget)
    let rated_routes = Router::new()
        .merge(public_api_routes)
        .merge(auth_routes)
        .merge(session_auth_routes)
        .merge(api_routes)
        .layer(tower_governor::GovernorLayer::new(governor_conf));

    // IMPORTANT: session_layer MUST be outermost (applied after all merges).
    // In axum, layers applied last wrap outermost. session_required middleware
    // (applied inside api_routes) can access Session because session_layer
    // processes the request first.
    Router::new()
        .merge(health_routes)
        .merge(rated_routes)
        .layer(axum::middleware::from_fn(
            crate::middleware::audit::audit_log,
        ))
        .layer(session_layer)
        .layer(cors)
        .layer(security_headers)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
}

/// Derive a 64-byte key from an arbitrary-length session secret using PBKDF2-SHA256.
/// Key::from() requires at least 64 bytes; this ensures we always provide exactly 64.
const PBKDF2_ITERATIONS: u32 = 100_000;

fn derive_session_key(secret: &[u8]) -> [u8; 64] {
    use pbkdf2::hmac::Hmac;
    use sha2::Sha256;

    let mut key = [0u8; 64];
    pbkdf2::pbkdf2::<Hmac<Sha256>>(
        secret,
        b"keasy-session-key-derivation",
        PBKDF2_ITERATIONS,
        &mut key,
    )
    .expect("PBKDF2 key derivation must not fail for 64-byte output");
    key
}
