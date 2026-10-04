use std::time::Duration;

use axum::Json;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa::openapi::{OpenApi, Ref, RefOr, ResponseBuilder, content::ContentBuilder};

/// Every error the server answers with. Closed: a code the server does not
/// declare here cannot be sent, and the web keys its copy by this enum.
///
/// One grammar with fossil's and kanzo-ui's codes, `area/kind`, so one registry
/// in the web keys all three. The areas are keasy's own and never one of
/// fossil's (`storage`, `engine`, `run`, …): a code means one thing. Each
/// variant is its wire name spelled in Rust, `area/kind-x` as `AreaKindX`, so
/// the code a test asserts and the variant a handler names are one word.
///
/// Every refusal the server writes is an [`ErrorBody`] with one of these, with
/// one exception: the AI relay (`routes::ai`) passes the gateway's own refusal
/// through in the OpenAI error format the browser's model client reads, status
/// and body untouched. Its own failures — unreachable, silent —
/// are `gateway/*` bodies like any other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, strum::EnumIter)]
pub enum ErrorCode {
    #[serde(rename = "auth/session-required")]
    AuthSessionRequired,
    #[serde(rename = "auth/keys-unavailable")]
    AuthKeysUnavailable,
    #[serde(rename = "rbac/no-membership")]
    RbacNoMembership,
    #[serde(rename = "rbac/insufficient-role")]
    RbacInsufficientRole,
    /// The caller holds the role, but not this resource: another member's.
    #[serde(rename = "rbac/forbidden")]
    RbacForbidden,
    #[serde(rename = "request/rate-limited")]
    RequestRateLimited,
    /// Well-formed, but what it asks for is not allowed.
    #[serde(rename = "request/invalid")]
    RequestInvalid,
    /// Not well-formed: a body, path or query that does not parse.
    #[serde(rename = "request/malformed")]
    RequestMalformed,
    #[serde(rename = "request/method-not-allowed")]
    RequestMethodNotAllowed,
    #[serde(rename = "request/too-large")]
    RequestTooLarge,
    /// No route answers at this path.
    #[serde(rename = "route/not-found")]
    RouteNotFound,
    #[serde(rename = "server/internal")]
    ServerInternal,
    /// The server did not answer within its own bound; `after` says how long
    /// it waited.
    #[serde(rename = "server/silent")]
    ServerSilent,
    /// The server is up but cannot serve: its database did not answer.
    #[serde(rename = "server/not-ready")]
    ServerNotReady,
    #[serde(rename = "graph/not-found")]
    GraphNotFound,
    /// Only a draft is edited or submitted.
    #[serde(rename = "graph/not-draft")]
    GraphNotDraft,
    /// A graph's output is read once the graph has completed.
    #[serde(rename = "graph/not-completed")]
    GraphNotCompleted,
    /// Not running yet: a graph's output is written, and its run reported, only
    /// once it runs.
    #[serde(rename = "graph/not-running")]
    GraphNotRunning,
    /// The graph has ended — completed, failed, cancelled or swept — so it has
    /// no run left to report or write.
    #[serde(rename = "graph/ended")]
    GraphEnded,
    #[serde(rename = "graph/still-running")]
    GraphStillRunning,
    /// A run is under way already: a graph runs once at a time.
    #[serde(rename = "graph/already-running")]
    GraphAlreadyRunning,
    /// The runner went silent: no heartbeat within the lease. Stored as the
    /// graph's problem by the sweep.
    #[serde(rename = "graph/abandoned")]
    GraphAbandoned,
    /// The runner's own tab lost the run (it reloaded, or closed and came
    /// back) and its runner ended it, to run it again. Stored as the graph's
    /// problem; reported by the runner, never raised by the server.
    #[serde(rename = "graph/interrupted")]
    GraphInterrupted,
    #[serde(rename = "graph/invalid-destination")]
    GraphInvalidDestination,
    #[serde(rename = "graph/no-destination")]
    GraphNoDestination,
    /// Another graph that is not a draft writes to that folder of the sink;
    /// `field` is `folder`.
    #[serde(rename = "graph/folder-taken")]
    GraphFolderTaken,
    #[serde(rename = "secret/not-found")]
    SecretNotFound,
    #[serde(rename = "connection/not-found")]
    ConnectionNotFound,
    /// A secret or connection of that name exists already, or a second sink.
    #[serde(rename = "resource/already-exists")]
    ResourceAlreadyExists,
    /// Still used: `dependents` names what uses it.
    #[serde(rename = "resource/in-use")]
    ResourceInUse,
    /// A storage connection's location lies within another's, or holds one:
    /// `dependents` names them. Locations never overlap, so a prefix has one
    /// owner.
    #[serde(rename = "connection/overlaps")]
    ConnectionOverlaps,
    /// A secret or connection was probed and did not pass; `dependents`
    /// names the connections that failed.
    #[serde(rename = "probe/failed")]
    ProbeFailed,
    /// The store answered and refused: to vend, or to list.
    #[serde(rename = "store/refused")]
    StoreRefused,
    /// The store, or the identity service in front of it (Entra, STS), did not
    /// answer within its deadline; `after` says how long it was given.
    #[serde(rename = "store/silent")]
    StoreSilent,
    /// The AI gateway could not be reached.
    #[serde(rename = "gateway/unreachable")]
    GatewayUnreachable,
    /// The AI gateway sent nothing within its deadline — before its answer
    /// began, or in the middle of it; `after` says how long it was given.
    #[serde(rename = "gateway/silent")]
    GatewaySilent,
}

impl ErrorCode {
    /// What the code means, fixed per code: the same words for every refusal
    /// that carries it. What this refusal is about goes in `detail`.
    pub fn title(self) -> &'static str {
        match self {
            Self::AuthSessionRequired => "Sign in required",
            Self::AuthKeysUnavailable => "The identity provider is unreachable",
            Self::RbacNoMembership => "Not a member of this workspace",
            Self::RbacInsufficientRole => "Your role does not allow this",
            Self::RbacForbidden => "Not allowed",
            Self::RequestRateLimited => "Too many requests",
            Self::RequestInvalid => "The request is not valid",
            Self::RequestMalformed => "The request is malformed",
            Self::RequestMethodNotAllowed => "The method is not allowed here",
            Self::RequestTooLarge => "The request is too large",
            Self::RouteNotFound => "No such route",
            Self::ServerInternal => "The server failed",
            Self::ServerSilent => "The server did not answer in time",
            Self::ServerNotReady => "The server is not ready",
            Self::GraphNotFound => "Graph not found",
            Self::GraphNotDraft => "Not a draft",
            Self::GraphNotCompleted => "The graph has not completed",
            Self::GraphNotRunning => "The graph is not running",
            Self::GraphEnded => "The graph has ended",
            Self::GraphStillRunning => "The graph is still running",
            Self::GraphAlreadyRunning => "The graph is running already",
            Self::GraphAbandoned => "The run was abandoned",
            Self::GraphInterrupted => "The run was interrupted",
            Self::GraphInvalidDestination => "Not a valid destination",
            Self::GraphNoDestination => "No destination",
            Self::GraphFolderTaken => "Another graph writes to that folder",
            Self::SecretNotFound => "Secret not found",
            Self::ConnectionNotFound => "Connection not found",
            Self::ResourceAlreadyExists => "It exists already",
            Self::ResourceInUse => "Still in use",
            Self::ConnectionOverlaps => "The location overlaps another",
            Self::ProbeFailed => "Validation failed",
            Self::StoreRefused => "The store refused",
            Self::StoreSilent => "The store did not answer in time",
            Self::GatewayUnreachable => "The AI gateway is unreachable",
            Self::GatewaySilent => "The AI gateway did not answer in time",
        }
    }
}

/// The body of every 4xx/5xx, and the payload of an SSE `error` frame — the
/// shape fossil's problems have: a code, its fixed title, a detail for a
/// person that nothing parses, and the data the code carries.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub title: String,
    pub detail: String,
    pub data: ErrorData,
}

/// What a refusal carries beside its words.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct ErrorData {
    /// What the refusal is about: what still uses a secret or connection,
    /// or the connections a rotation would break.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependents: Vec<String>,
    /// How long a deadline waited before it fired, in milliseconds: set on
    /// the `*/silent` codes, and only on them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
    /// The request field the refusal is about, so a form can say it on that
    /// field: `folder`, `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

impl ErrorBody {
    pub fn new(code: ErrorCode, detail: impl Into<String>, dependents: Vec<String>) -> Self {
        Self {
            code,
            title: code.title().to_string(),
            detail: detail.into(),
            data: ErrorData {
                dependents,
                ..ErrorData::default()
            },
        }
    }

    /// A deadline that fired: `code` names who did not answer, `after` how
    /// long they were given.
    pub fn silent(code: ErrorCode, detail: impl Into<String>, after: Duration) -> Self {
        let mut body = Self::new(code, detail, Vec::new());
        body.data.after = Some(after.as_millis() as u64);
        body
    }
}

/// Why a request was refused, and the one way the server refuses: a status
/// and the [`ErrorBody`] it carries. Every failure a handler meets — the
/// database's, the role check's, the token check's, the store's — converts into
/// one, so a route has one error type and the wire has one shape.
#[derive(Debug)]
pub struct Refusal {
    pub status: StatusCode,
    /// Boxed: a refusal is the `Err` of nearly every function here, and the
    /// body is the large part of it.
    pub body: Box<ErrorBody>,
}

impl Refusal {
    pub fn new(status: StatusCode, code: ErrorCode, detail: impl Into<String>) -> Self {
        Self::about(status, code, detail, Vec::new())
    }

    /// A refusal that names the resources it is about.
    pub fn about(
        status: StatusCode,
        code: ErrorCode,
        detail: impl Into<String>,
        dependents: Vec<String>,
    ) -> Self {
        Self {
            status,
            body: Box::new(ErrorBody::new(code, detail, dependents)),
        }
    }

    /// A deadline that fired: `code` names who did not answer, `after` how
    /// long they were given.
    pub fn silent(
        status: StatusCode,
        code: ErrorCode,
        detail: impl Into<String>,
        after: Duration,
    ) -> Self {
        Self {
            status,
            body: Box::new(ErrorBody::silent(code, detail, after)),
        }
    }

    /// `code` is the resource's own `*/not-found`, so the web can tell a graph
    /// that is not there from a route that is not.
    pub fn not_found(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, detail)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, ErrorCode::RbacForbidden, message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, ErrorCode::RequestInvalid, message)
    }

    /// The resource is in a state that does not allow this: 409 and its code.
    pub fn conflict(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, detail)
    }

    /// A refusal about one field of the request.
    pub fn field(
        status: StatusCode,
        code: ErrorCode,
        field: &str,
        detail: impl Into<String>,
    ) -> Self {
        let mut refusal = Self::new(status, code, detail);
        refusal.body.data.field = Some(field.to_string());
        refusal
    }

    /// A field spelled in a way the request may not.
    pub fn invalid_field(field: &str, detail: impl Into<String>) -> Self {
        Self::field(
            StatusCode::BAD_REQUEST,
            ErrorCode::RequestInvalid,
            field,
            detail,
        )
    }

    /// A storage location that would share a prefix with `dependents`.
    pub fn overlaps(message: impl Into<String>, dependents: Vec<String>) -> Self {
        Self::about(
            StatusCode::CONFLICT,
            ErrorCode::ConnectionOverlaps,
            message,
            dependents,
        )
    }

    /// A probe ran and did not pass: the store or provider answered, and did
    /// not accept what it was shown. A store that refused to answer at all is
    /// `store/refused`, a 502, not this.
    pub fn probe_failed(message: impl Into<String>, dependents: Vec<String>) -> Self {
        Self::about(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::ProbeFailed,
            message,
            dependents,
        )
    }

    /// The server failed; what failed is logged, never sent.
    pub fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::ServerInternal,
            "An internal error occurred",
        )
    }
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

/// The backstop that makes every 4xx/5xx an [`ErrorBody`], whoever produced
/// it. What the handlers refuse is one already; what reaches here bare is
/// axum's own answer — no route (404), a method the route does not take (405),
/// a body over the limit (413), and the `Json`, `Path` and `Query` rejections
/// (400/415/422) — whose plain-text message becomes the `detail`. A JSON error
/// body passes untouched: the server writes only `ErrorBody`, save the AI
/// relay's pass-through of the gateway's own refusal (see [`ErrorCode`]).
pub async fn as_error_body(response: Response) -> Response {
    let status = response.status();
    if !(status.is_client_error() || status.is_server_error()) {
        return response;
    }
    let is_json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"));
    if is_json {
        return response;
    }
    let (parts, body) = response.into_parts();
    let code = match status {
        StatusCode::NOT_FOUND => ErrorCode::RouteNotFound,
        StatusCode::METHOD_NOT_ALLOWED => ErrorCode::RequestMethodNotAllowed,
        StatusCode::PAYLOAD_TOO_LARGE => ErrorCode::RequestTooLarge,
        StatusCode::TOO_MANY_REQUESTS => ErrorCode::RequestRateLimited,
        StatusCode::UNAUTHORIZED => ErrorCode::AuthSessionRequired,
        s if s.is_server_error() => ErrorCode::ServerInternal,
        _ => ErrorCode::RequestMalformed,
    };
    // A rejection's message is a sentence; anything longer is not one, and
    // an unreadable body is no reason to fail the failure.
    let text = axum::body::to_bytes(body, 16 * 1024)
        .await
        .map(|b| String::from_utf8_lossy(&b).trim().to_string())
        .unwrap_or_default();
    let detail = if text.is_empty() {
        code.title().to_string()
    } else {
        text
    };
    let mut out = Refusal::new(status, code, detail).into_response();
    if let Some(allow) = parts.headers.get(header::ALLOW) {
        out.headers_mut().insert(header::ALLOW, allow.clone());
    }
    out
}

/// What a panicking handler answers instead of a dropped connection.
pub fn panicked(cause: Box<dyn std::any::Any + Send + 'static>) -> Response {
    let message = cause
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| cause.downcast_ref::<&str>().copied())
        .unwrap_or("a handler panicked");
    tracing::error!(panic = message, "handler panicked");
    Refusal::internal().into_response()
}

/// Every route behind the bearer scheme can be refused before its handler runs:
/// 401 without a verified token, 403 without the role it admits, 429 over the
/// caller's rate, 503 when the realm's keys cannot be fetched — and any of them
/// can fail with a 500. Each is one shared response, referenced by every such
/// route that does not document its own.
pub fn document_refusals(openapi: &mut OpenApi) {
    const REFUSALS: [(&str, &str, &str); 5] = [
        ("401", "Unauthorized", "No verified bearer token"),
        (
            "403",
            "Forbidden",
            "The caller holds no role this route admits",
        ),
        (
            "429",
            "RateLimited",
            "The caller exceeded their request rate",
        ),
        ("500", "InternalError", "The server failed"),
        (
            "503",
            "KeysUnavailable",
            "The identity provider's keys are unreachable",
        ),
    ];
    let components = openapi.components.get_or_insert_with(Default::default);
    for (_, name, description) in REFUSALS {
        components.responses.insert(
            name.to_string(),
            RefOr::T(
                ResponseBuilder::new()
                    .description(description)
                    .content(
                        "application/json",
                        ContentBuilder::new()
                            .schema(Some(Ref::from_schema_name("ErrorBody")))
                            .build(),
                    )
                    .build(),
            ),
        );
    }
    for item in openapi.paths.paths.values_mut() {
        for op in [
            &mut item.get,
            &mut item.post,
            &mut item.put,
            &mut item.patch,
            &mut item.delete,
        ]
        .into_iter()
        .flatten()
        .filter(|op| op.security.is_none())
        {
            for (status, name, _) in REFUSALS {
                op.responses
                    .responses
                    .entry(status.to_string())
                    .or_insert_with(|| RefOr::Ref(Ref::from_response_name(name)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use strum::IntoEnumIterator;

    /// `area/kind-x` is `AreaKindX`: the variant a handler names is the code
    /// the wire carries, spelled in Rust.
    #[test]
    fn each_variant_is_its_wire_name() {
        for code in ErrorCode::iter() {
            let wire = serde_json::to_value(code).unwrap();
            let wire = wire.as_str().unwrap();
            let spelled: String = wire
                .split(['/', '-'])
                .map(|w| {
                    let mut c = w.chars();
                    c.next()
                        .unwrap()
                        .to_uppercase()
                        .chain(c)
                        .collect::<String>()
                })
                .collect();
            assert_eq!(format!("{code:?}"), spelled, "{wire}");
        }
    }
}
