use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::http::{Request, StatusCode};
use axum::response::Response;
use axum::{Router, middleware};
use tokio::net::TcpListener;
use tower_governor::GovernorError;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::KeyExtractor;
use tower_http::trace::{DefaultOnResponse, TraceLayer};
use tracing::info;
use utoipa::Modify;
use utoipa::OpenApi;
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa_axum::router::OpenApiRouter;

use crate::authentication::middleware::{AuthenticatedUser, bearer_required};
use crate::authentication::token::{SharedValidator, Validator};
use crate::configuration::{BrandingSettings, DatabaseSettings, Settings};
use crate::database::Database;
use crate::error::{ErrorBody, ErrorCode, ErrorData, fail};
use crate::routes;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    /// This instance's workspace slug (`KEASY_ORG_ALIAS`), the "current" entry
    /// in the workspace switcher.
    pub workspace_slug: Option<String>,
    /// This instance's display name (`KEASY_WORKSPACE_NAME`).
    pub workspace_name: String,
    /// This instance's declared look (`KEASY_BRANDING_*`).
    pub branding: Arc<BrandingSettings>,
    /// Verifies the bearer token every protected request carries.
    pub auth: SharedValidator,
    /// The AI gateway every model call is relayed to, if this workspace has one.
    pub ai: Option<Arc<crate::routes::ai::Gateway>>,
}

/// The server, bound and ready to serve.
pub struct Application {
    port: u16,
    listener: TcpListener,
    router: Router,
}

impl Application {
    /// Open the stores, ensure what the bootstrap file declares and bind. The
    /// bind happens here so a caller that asked for port 0 can learn the port.
    pub async fn build(settings: Settings) -> Result<Self, String> {
        let Settings {
            application,
            database,
            oidc,
            ai,
        } = settings;
        let db = get_database(&database).await?;

        // After the key check: a declared credential is sealed with the key.
        if let Some(path) = &application.bootstrap_file {
            crate::bootstrap::ensure_declared(&db, path).await;
        }

        // Built without touching the network: Keycloak is routinely not up yet, and
        // the keys are fetched on the first request that needs them.
        let auth = Arc::new(Validator::new(
            &oidc.issuer_url,
            &oidc.audience,
            &oidc.client_id,
            oidc.internal_base_url.as_deref(),
        ));
        info!(
            issuer = %oidc.issuer_url,
            audience = %oidc.audience,
            client_id = %oidc.client_id,
            "Bearer tokens validated against"
        );

        let state = AppState {
            db,
            workspace_slug: application.workspace_slug,
            workspace_name: application.workspace_name,
            branding: Arc::new(application.branding),
            auth,
            ai: ai.map(|ai| Arc::new(crate::routes::ai::Gateway::new(ai))),
        };

        let listener = TcpListener::bind(application.bind_addr)
            .await
            .map_err(|e| format!("failed to bind to {}: {e}", application.bind_addr))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("failed to read the bound address: {e}"))?
            .port();
        Ok(Self {
            port,
            listener,
            router: router(state),
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Serve until `shutdown` resolves, finishing the requests in flight.
    pub async fn run_until_stopped(
        self,
        shutdown: impl Future<Output = ()> + Send + 'static,
    ) -> Result<(), String> {
        info!(port = self.port, "Keasy server listening");
        axum::serve(self.listener, self.router)
            .with_graceful_shutdown(shutdown)
            .await
            .map_err(|e| format!("server error: {e}"))
    }
}

/// The instance database, refused when the configured key does not open what
/// it stores.
pub async fn get_database(settings: &DatabaseSettings) -> Result<Database, String> {
    std::fs::create_dir_all(&settings.data_dir)
        .map_err(|e| format!("failed to create data dir {:?}: {e}", settings.data_dir))?;

    let path = settings.path();
    let db = Database::open(&path, settings.secret_key.clone())
        .map_err(|e| format!("failed to open the database: {e}"))?;
    info!(path = %path.display(), "Database opened");

    if !db
        .key_opens_credentials()
        .await
        .map_err(|e| format!("failed to read the stored credentials: {e}"))?
    {
        return Err(
            "KEASY_SECRET_KEY does not open the secrets this database stores. \
             Set the key it was created with, or delete the data volume to start fresh"
                .into(),
        );
    }
    Ok(db)
}

/// Every route, once: the public ones, and those behind a verified token. Each
/// handler's role extractor says whom it admits; the workspace list admits a
/// verified caller with no role here, who still needs to be told where they do
/// belong.
fn routes() -> (OpenApiRouter<AppState>, OpenApiRouter<AppState>) {
    let public = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(routes::health_check::router())
        .merge(routes::branding::router());
    let protected = OpenApiRouter::new()
        .merge(routes::workspaces::router())
        .merge(routes::jobs::router())
        .merge(routes::datasets::router())
        .merge(routes::jobs::output::router())
        .merge(routes::jobs::dashboard::router())
        .merge(routes::credentials::router())
        .merge(routes::connections::router())
        .merge(routes::ai::router());
    (public, protected)
}

/// The contract the routes publish.
pub fn openapi() -> utoipa::openapi::OpenApi {
    let (public, protected) = routes();
    let mut api = public.merge(protected).into_openapi();
    crate::error::document_refusals(&mut api);
    api
}

pub fn router(state: AppState) -> Router {
    let (public, protected) = routes();
    // Per caller: 20 requests a second with bursts of 100, relaxed in dev.
    let (period_ms, burst) = if cfg!(debug_assertions) {
        (10, 500)
    } else {
        (50, 100)
    };
    let per_caller = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(Subject)
            .per_millisecond(period_ms)
            .burst_size(burst)
            .finish()
            .expect("a non-zero period and burst"),
    );
    let protected = protected
        .layer(GovernorLayer::new(per_caller).error_handler(over_rate))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            bearer_required,
        ));
    let (router, _) = public.merge(protected).split_for_parts();

    router
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(crate::telemetry::request_span)
                .on_response(DefaultOnResponse::new().level(tracing::Level::INFO)),
        )
        .with_state(state)
}

/// Keyed by who is calling, not from where. Every request reaches this server
/// from the web's BFF, so the peer address is one address for the whole
/// workspace; the verified token's subject is the only per-caller identity at
/// this layer. Shedding anonymous floods by client address is the ingress's job,
/// where that address is still known.
#[derive(Clone)]
struct Subject;

impl KeyExtractor for Subject {
    type Key = String;

    fn extract<T>(&self, req: &Request<T>) -> Result<String, GovernorError> {
        req.extensions()
            .get::<AuthenticatedUser>()
            .map(|user| user.user_id.clone())
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

/// The refusal a caller over their rate gets.
fn over_rate(error: GovernorError) -> Response {
    match error {
        GovernorError::TooManyRequests { .. } => fail(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::RateLimited,
            "Too many requests",
        ),
        _ => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::InternalError,
            "An internal error occurred",
        ),
    }
}

/// The document every route is collected into: its info, the bearer scheme, and
/// that scheme required by default. A public route opts out with `security(())`.
#[derive(utoipa::OpenApi)]
#[openapi(
    info(
        title = "Keasy API",
        version = "1.0.0",
        description = "Keasy host: identity, connections, vended credentials and the job record",
    ),
    components(schemas(ErrorBody, ErrorCode, ErrorData)),
    modifiers(&Bearer, &Unattributed),
    security(("bearer" = [])),
)]
pub struct ApiDoc;

pub const BEARER: &str = "bearer";

struct Bearer;

impl Modify for Bearer {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi
            .components
            .get_or_insert_with(Default::default)
            .add_security_scheme(
                BEARER,
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
    }
}

/// utoipa fills `info.contact` from the package's `authors`: who wrote the
/// server is not whom a client of the API should write to.
struct Unattributed;

impl Modify for Unattributed {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi.info.contact = None;
    }
}
