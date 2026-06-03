pub mod admin;
pub mod health;
pub mod org;
pub mod providers;

use axum::{middleware, Router};
use axum::extract::DefaultBodyLimit;
use axum::http::HeaderValue;
use axum::http::header::{self, HeaderName};
use secrecy::ExposeSecret;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tower_sessions::{cookie::{Key, SameSite}, SessionManagerLayer};

use crate::AppState;
use crate::middleware::session_auth::session_required;
use crate::middleware::tenant::tenant_context_required;

/// Session configuration — groups the 4 session-related params for `build_router`.
pub struct SessionConfig {
    pub store: tower_sessions_rusqlite_store::RusqliteStore,
    pub secret: secrecy::SecretString,
    pub cookie_name: String,
    pub secure: bool,
}

pub fn build_router(
    state: AppState,
    cors_origins: Option<Vec<String>>,
    session: SessionConfig,
) -> Router {
    // Build the session layer with signed cookies
    // Key::from requires at least 64 bytes — derive from the session secret
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

    let health_routes = Router::new()
        .route("/healthz/live", axum::routing::get(health::liveness))
        .route("/healthz/ready", axum::routing::get(health::readiness))
        .with_state(state.clone());

    let public_api_routes = Router::new()
        .route("/openapi.json", axum::routing::get(crate::openapi::openapi_json))
        .route("/v1/status", axum::routing::get(health::service_status))
        .route(
            "/v1/settings/schema",
            axum::routing::get(crate::settings::routes::get_schema),
        )
        .route(
            "/v1/providers",
            axum::routing::get(providers::list_providers),
        )
        // Gaia-X .well-known public endpoints (no auth required — GXDCH must resolve these)
        .route(
            "/.well-known/did.json",
            axum::routing::get(crate::gaia_x::routes::get_did_document),
        )
        .route(
            "/.well-known/x509CertificateChain.pem",
            axum::routing::get(crate::gaia_x::routes::get_cert_chain),
        )
        .with_state(state.clone());

    // Public auth routes (no session middleware)
    let auth_routes = Router::new()
        .route(
            "/v1/auth/invite-info",
            axum::routing::get(crate::auth::routes::get_invite_info),
        )
        // OIDC authorization code flow — public (session is created inside oidc_callback)
        .route(
            "/v1/auth/oidc-start",
            axum::routing::get(crate::auth::oidc::oidc_start),
        )
        .route(
            "/v1/auth/oidc-callback",
            axum::routing::get(crate::auth::oidc::oidc_callback),
        )
        .with_state(state.clone());

    // Session-authenticated routes (session required, NO tenant context required)
    let session_auth_routes = Router::new()
        .route(
            "/v1/auth/logout",
            axum::routing::post(crate::auth::routes::logout),
        )
        .route(
            "/v1/auth/me",
            axum::routing::get(crate::auth::routes::get_me),
        )
        .route(
            "/v1/auth/workspaces",
            axum::routing::get(crate::auth::routes::list_workspaces),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            session_required,
        ))
        .with_state(state.clone());

    // All existing API routes now protected by session_required
    let api_routes = Router::new()
        .route(
            "/v1/jobs",
            axum::routing::get(crate::jobs::routes::list_jobs)
                .post(crate::jobs::routes::create_job),
        )
        .route(
            "/v1/jobs/{id}",
            axum::routing::get(crate::jobs::routes::get_job)
                .put(crate::jobs::routes::update_job)
                .delete(crate::jobs::routes::delete_job),
        )
        .route(
            "/v1/jobs/{id}/stream",
            axum::routing::get(crate::jobs::routes::stream_job),
        )
        .route(
            "/v1/settings/organization",
            axum::routing::get(crate::settings::routes::get_org_settings)
                .put(crate::settings::routes::save_org_settings),
        )
        .route(
            "/v1/settings/catalog-storage",
            axum::routing::get(crate::settings::routes::get_catalog_storage)
                .put(crate::settings::routes::save_catalog_storage),
        )
        .route(
            "/v1/settings/preferences",
            axum::routing::get(crate::settings::routes::get_preferences)
                .put(crate::settings::routes::save_preferences),
        )
        .route(
            "/v1/settings/ai/providers",
            axum::routing::get(crate::settings::routes::list_ai_providers),
        )
        .route(
            "/v1/settings/ai/providers/{provider_id}",
            axum::routing::put(crate::settings::routes::save_ai_provider)
                .delete(crate::settings::routes::delete_ai_provider),
        )
        .route(
            "/v1/jobs/{id}/dashboard-layout",
            axum::routing::get(crate::jobs::routes::get_dashboard_layout)
                .put(crate::jobs::routes::save_dashboard_layout),
        )
        .route(
            "/v1/jobs/{id}/discover/urls",
            axum::routing::get(crate::discovery::routes::resolve_discover_urls),
        )
        .route(
            "/v1/jobs/{id}/catalog/urls",
            axum::routing::get(crate::discovery::routes::resolve_catalog_urls),
        )
        .route(
            "/v1/jobs/{id}/discover/ask-stream",
            axum::routing::post(crate::ai::routes::ask_discover_stream),
        )
        .route(
            "/v1/jobs/{id}/conversations",
            axum::routing::get(crate::ai::routes::list_conversations)
                .post(crate::ai::routes::create_conversation),
        )
        .route(
            "/v1/conversations/{id}/messages",
            axum::routing::get(crate::ai::routes::get_conversation_messages),
        )
        .route(
            "/v1/conversations/{id}",
            axum::routing::put(crate::ai::routes::rename_conversation)
                .delete(crate::ai::routes::delete_conversation),
        )
        .route(
            "/v1/cloud-accounts",
            axum::routing::get(crate::cloud::routes::list_accounts)
                .post(crate::cloud::routes::create_account),
        )
        .route(
            "/v1/cloud-accounts/{id}",
            axum::routing::get(crate::cloud::routes::get_account)
                .put(crate::cloud::routes::update_account)
                .delete(crate::cloud::routes::delete_account),
        )
        .route(
            "/v1/connections",
            axum::routing::get(crate::connections::routes::list_connections)
                .post(crate::connections::routes::create_connection),
        )
        .route(
            "/v1/connections/{id}",
            axum::routing::get(crate::connections::routes::get_connection)
                .put(crate::connections::routes::update_connection)
                .delete(crate::connections::routes::delete_connection),
        )
        .route(
            "/v1/connections/{id}/files",
            axum::routing::get(crate::connections::routes::list_connection_files)
                .put(crate::connections::routes::upload_file),
        )
        .route(
            "/v1/connections/{id}/schema",
            axum::routing::get(crate::connections::routes::get_file_schema),
        )
        // Assistant (SSE streaming)
        .route(
            "/v1/assistant/suggest-stream",
            axum::routing::post(crate::assistant::routes::suggest_cqs_stream),
        )
        .route(
            "/v1/assistant/generate-stream",
            axum::routing::post(crate::assistant::routes::generate_script_stream),
        )
        // Admin routes — promotor only
        .route(
            "/v1/admin/organizations",
            axum::routing::get(admin::list_all_orgs).post(admin::create_org_and_invite),
        )
        // Invite link management — promotor only
        .route(
            "/v1/admin/invites",
            axum::routing::get(admin::list_invites).post(admin::create_invite),
        )
        .route(
            "/v1/admin/invites/{token}",
            axum::routing::delete(admin::revoke_invite),
        )
        // OIDC instance registration — promotor only
        .route(
            "/v1/admin/oidc-clients",
            axum::routing::get(admin::list_dataspaces)
                .post(admin::register_dataspace),
        )
        // Org identity — read for any participant, write for participant org admins
        .route(
            "/v1/org/identity",
            axum::routing::get(org::get_org_identity)
                .put(org::update_org_identity),
        )
        // Org admin routes — participant org admins only
        .route(
            "/v1/org/users",
            axum::routing::get(org::list_users),
        )
        .route(
            "/v1/org/users/{id}",
            axum::routing::put(org::update_user_role).delete(org::remove_user),
        )
        // Org invite management — participant org admins only
        .route(
            "/v1/org/invites",
            axum::routing::get(org::list_org_invites).post(org::create_org_invite),
        )
        .route(
            "/v1/org/invites/{token}",
            axum::routing::delete(org::revoke_org_invite),
        )
        // Gaia-X compliance routes (session + tenant protected)
        .route(
            "/v1/gaia-x/comply",
            axum::routing::post(crate::gaia_x::routes::comply),
        )
        .route(
            "/v1/gaia-x/compliance",
            axum::routing::get(crate::gaia_x::routes::get_compliance_status),
        )
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
    let (rps, burst) = if cfg!(debug_assertions) { (100, 500) } else { (20, 100) };
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
        .layer(axum::middleware::from_fn(crate::middleware::audit::audit_log))
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
    use sha2::Sha256;
    use pbkdf2::hmac::Hmac;

    let mut key = [0u8; 64];
    // Use a fixed salt — the secret itself provides uniqueness.
    // This is a deterministic KDF, not password hashing, so a fixed salt is acceptable.
    pbkdf2::pbkdf2::<Hmac<Sha256>>(secret, b"keasy-session-key-derivation", PBKDF2_ITERATIONS, &mut key)
        .expect("PBKDF2 key derivation must not fail for 64-byte output");
    key
}
