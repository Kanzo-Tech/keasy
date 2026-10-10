use std::sync::Arc;

use std::time::Duration;

use axum::body::Body;
use axum::extract::DefaultBodyLimit;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::{Router, middleware};
use tokio::net::TcpListener;
use tower_governor::GovernorError;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::KeyExtractor;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::trace::{DefaultOnResponse, TraceLayer};
use tracing::info;
use utoipa::Modify;
use utoipa::OpenApi;
use utoipa::openapi::extensions::ExtensionsBuilder;
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa_axum::router::OpenApiRouter;

use crate::authentication::middleware::{AuthenticatedUser, bearer_required};
use crate::authentication::role::Role;
use crate::authentication::token::{SharedValidator, Validator};
use crate::configuration::{BrandingSettings, DatabaseSettings, Rate, Settings};
use crate::database::Database;
use crate::error::{ErrorBody, ErrorCode, ErrorData, Refusal};
use crate::routes;
use crate::storage_client::Endpoints;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    /// The Keycloak organization this instance serves (`KEASY_ORG_ALIAS`).
    pub org_alias: String,
    /// This instance's display name (`KEASY_WORKSPACE_NAME`).
    pub workspace_name: String,
    /// This instance's declared look (`KEASY_BRANDING_FILE`).
    pub branding: Arc<BrandingSettings>,
    /// Verifies the bearer token every protected request carries.
    pub auth: SharedValidator,
    /// Where S3 and STS answer, when not at AWS (`AWS_ENDPOINT_URL_S3`, `_STS`).
    pub endpoints: Arc<Endpoints>,
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
        } = settings;
        let db = get_database(&database).await?;

        // After the key check: a declared credential is sealed with the key.
        if let Some(path) = &application.bootstrap_file {
            crate::bootstrap::ensure_declared(&db, path, &application.endpoints).await;
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
            org_alias: application.org_alias,
            workspace_name: application.workspace_name,
            branding: Arc::new(application.branding),
            auth,
            endpoints: Arc::new(application.endpoints),
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
            router: router(state, application.rate),
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
        .merge(routes::graphs::router())
        .merge(routes::storage_credentials::router())
        .merge(routes::graphs::dashboard::router())
        .merge(routes::graphs::rules::router())
        .merge(routes::secrets::router())
        .merge(routes::connections::router())
        .merge(routes::access::router());
    (public, protected)
}

/// The contract the routes publish.
pub fn openapi() -> utoipa::openapi::OpenApi {
    let (public, protected) = routes();
    let mut api = public.merge(protected).into_openapi();
    crate::error::document_refusals(&mut api);
    api
}

pub fn router(state: AppState, rate: Rate) -> Router {
    let (public, protected) = routes();
    let per_caller = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(Subject)
            .per_millisecond(rate.period_ms)
            .burst_size(rate.burst)
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

    guarded(router, REQUEST_DEADLINE).with_state(state)
}

/// The largest request body: a credential, a connection, a graph's script and
/// run report — never data, which goes to the store, not through here.
const BODY_LIMIT: usize = 2 * 1024 * 1024;

/// What every request passes through, outermost last: a body limit, the
/// request deadline, a panic caught as a 500, and every failure spoken as an
/// [`ErrorBody`] — so a client never meets a dropped connection, a hang or a
/// plain-text body.
fn guarded<S: Clone + Send + Sync + 'static>(router: Router<S>, deadline: Duration) -> Router<S> {
    router
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(middleware::from_fn(move |request, next| {
            within(deadline, request, next)
        }))
        .layer(CatchPanicLayer::custom(crate::error::panicked))
        .layer(middleware::map_response(crate::error::as_error_body))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(crate::telemetry::request_span)
                .on_response(DefaultOnResponse::new().level(tracing::Level::INFO)),
        )
}

/// How long a request may take to answer, its headers at least: a stream's body
/// runs past it, and is bounded by its own idle deadline instead. Under the
/// browser's 30 s, so the server's own code reaches the screen before the
/// browser gives up and has to name the server itself.
pub const REQUEST_DEADLINE: Duration = Duration::from_secs(25);

/// How long the browser waits on an answer: the web's `DEADLINE_MS`
/// (`web/src/lib/deadline.ts`) for an API request. The web holds its side
/// against the published `x-keasy-bounds` (`web/src/lib/bounds.test.ts`).
pub const BROWSER_DEADLINE: Duration = Duration::from_secs(30);

const _: () = assert!(
    REQUEST_DEADLINE.as_millis() < BROWSER_DEADLINE.as_millis(),
    "the server names itself before the browser gives up"
);

/// Answer within `deadline` or with `server/silent`. Dropping the handler's
/// future is what ends whatever it was waiting on.
pub async fn within(deadline: Duration, request: Request<Body>, next: Next) -> Response {
    match tokio::time::timeout(deadline, next.run(request)).await {
        Ok(response) => response,
        Err(_) => {
            tracing::warn!(
                after_ms = deadline.as_millis() as u64,
                "request deadline fired"
            );
            Refusal::silent(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorCode::ServerSilent,
                "The server did not answer within its deadline",
                deadline,
            )
            .into_response()
        }
    }
}

/// Keyed by who is calling, not from where. Every request reaches this server
/// from the web's BFF, so the peer address is one address for the whole
/// workspace; the verified token's subject is the only per-caller identity at
/// this layer. Shedding anonymous floods by client address is the ingress's graph,
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
        GovernorError::TooManyRequests { .. } => Refusal::new(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::RequestRateLimited,
            "Too many requests",
        )
        .into_response(),
        _ => Refusal::internal().into_response(),
    }
}

/// The document every route is collected into: its info, the bearer scheme, and
/// that scheme required by default. A public route opts out with `security(())`.
#[derive(utoipa::OpenApi)]
#[openapi(
    info(
        title = "Keasy API",
        version = "1.0.0",
        description = "Keasy host: identity, connections, vended credentials and the graph record",
    ),
    components(schemas(ErrorBody, ErrorCode, ErrorData, Role)),
    modifiers(&Bearer, &Unattributed, &Bounds),
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

/// The figures a client keeps in step with, published beside the routes as
/// `x-keasy-bounds`: the request deadline its own must exceed, and the graph
/// lease its runner's heartbeat divides.
struct Bounds;

impl Modify for Bounds {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi
            .extensions
            .get_or_insert_with(Default::default)
            .merge(
                ExtensionsBuilder::new()
                    .add(
                        "x-keasy-bounds",
                        serde_json::json!({
                            "request_ms": REQUEST_DEADLINE.as_millis() as u64,
                            "graph_lease_ms": crate::graphs::persistence::LEASE.as_millis() as u64,
                        }),
                    )
                    .build(),
            );
    }
}

#[cfg(test)]
mod tests {
    use axum::routing::get;
    use tower::ServiceExt;

    use super::*;

    async fn answer(router: Router, path: &str) -> (StatusCode, serde_json::Value) {
        let response = router
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn a_handler_that_panics_answers_a_500_body_not_a_dropped_connection() {
        async fn boom() -> &'static str {
            panic!("boom")
        }
        let router = guarded(Router::new().route("/boom", get(boom)), REQUEST_DEADLINE);
        let (status, body) = answer(router, "/boom").await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["code"], "server/internal");
    }

    #[tokio::test]
    async fn a_handler_past_the_deadline_answers_server_silent_with_how_long() {
        async fn stuck() -> &'static str {
            std::future::pending().await
        }
        let router = guarded(
            Router::new().route("/stuck", get(stuck)),
            Duration::from_millis(100),
        );
        let started = std::time::Instant::now();
        let (status, body) = answer(router, "/stuck").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["code"], "server/silent");
        assert_eq!(body["data"]["after"], 100);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
