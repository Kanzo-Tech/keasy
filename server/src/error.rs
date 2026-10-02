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
/// fossil's (`storage`, `engine`, `run`, …): a code means one thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum ErrorCode {
    #[serde(rename = "auth/session-required")]
    SessionRequired,
    #[serde(rename = "auth/keys-unavailable")]
    KeysUnavailable,
    #[serde(rename = "rbac/no-membership")]
    NoMembership,
    #[serde(rename = "rbac/insufficient-role")]
    InsufficientRole,
    /// The caller holds the role, but not this resource: another member's.
    #[serde(rename = "rbac/forbidden")]
    Forbidden,
    #[serde(rename = "request/rate-limited")]
    RateLimited,
    /// Well-formed, but what it asks for is not allowed.
    #[serde(rename = "request/invalid")]
    ValidationFailed,
    /// Not well-formed: a body, path or query that does not parse.
    #[serde(rename = "request/malformed")]
    InvalidFormat,
    #[serde(rename = "request/method-not-allowed")]
    MethodNotAllowed,
    #[serde(rename = "request/too-large")]
    TooLarge,
    /// No route answers at this path.
    #[serde(rename = "route/not-found")]
    RouteNotFound,
    #[serde(rename = "server/internal")]
    InternalError,
    /// The server did not answer within its own bound; `after` says how long
    /// it waited.
    #[serde(rename = "server/silent")]
    ServerSilent,
    #[serde(rename = "job/not-found")]
    JobNotFound,
    #[serde(rename = "job/not-draft")]
    NotDraft,
    /// A job's output is read once the job has completed.
    #[serde(rename = "job/not-completed")]
    NotCompleted,
    /// A job's output is written only while the job runs.
    #[serde(rename = "job/not-running")]
    NotRunning,
    #[serde(rename = "job/still-running")]
    StillRunning,
    /// The runner went silent: no heartbeat within the lease, or a pending
    /// job no runner picked up. Stored as the job's problem by the sweep.
    #[serde(rename = "job/abandoned")]
    Abandoned,
    #[serde(rename = "job/invalid-destination")]
    InvalidDestination,
    #[serde(rename = "job/no-destination")]
    NoDestination,
    #[serde(rename = "credential/not-found")]
    CredentialNotFound,
    #[serde(rename = "connection/not-found")]
    ConnectionNotFound,
    /// A credential or connection of that name exists already, a second sink,
    /// or a second job writing to one folder.
    #[serde(rename = "resource/already-exists")]
    AlreadyExists,
    /// Still used: `dependents` names what uses it.
    #[serde(rename = "resource/in-use")]
    InUse,
    /// A storage connection's location lies within another's, or holds one:
    /// `dependents` names them. Locations never overlap, so a prefix has one
    /// owner.
    #[serde(rename = "connection/overlaps")]
    Overlaps,
    /// A credential or connection did not validate against its store or
    /// provider; `dependents` names the connections that failed.
    #[serde(rename = "probe/failed")]
    ProbeFailed,
    #[serde(rename = "store/list-failed")]
    ListFilesFailed,
    /// The store answered and refused to vend.
    #[serde(rename = "store/refused")]
    StoreError,
    /// The store, or the identity service in front of it (Entra, STS), did not
    /// answer within its deadline; `after` says how long it was given.
    #[serde(rename = "store/silent")]
    StoreSilent,
    /// This workspace has no AI gateway.
    #[serde(rename = "gateway/not-configured")]
    AiNotConfigured,
    /// The AI gateway could not be reached.
    #[serde(rename = "gateway/unreachable")]
    AiUnreachable,
    /// The AI gateway sent nothing within its deadline — before its answer
    /// began, or in the middle of it; `after` says how long it was given.
    #[serde(rename = "gateway/silent")]
    AiSilent,
}

impl ErrorCode {
    /// What the code means, fixed per code: the same words for every refusal
    /// that carries it. What this refusal is about goes in `detail`.
    pub fn title(self) -> &'static str {
        match self {
            Self::SessionRequired => "Sign in required",
            Self::KeysUnavailable => "The identity provider is unreachable",
            Self::NoMembership => "Not a member of this workspace",
            Self::InsufficientRole => "Your role does not allow this",
            Self::Forbidden => "Not allowed",
            Self::RateLimited => "Too many requests",
            Self::ValidationFailed => "The request is not valid",
            Self::InvalidFormat => "The request is malformed",
            Self::MethodNotAllowed => "The method is not allowed here",
            Self::TooLarge => "The request is too large",
            Self::RouteNotFound => "No such route",
            Self::InternalError => "The server failed",
            Self::ServerSilent => "The server did not answer in time",
            Self::JobNotFound => "Job not found",
            Self::NotDraft => "Not a draft",
            Self::NotCompleted => "The job has not completed",
            Self::NotRunning => "The job is not running",
            Self::StillRunning => "The job is still running",
            Self::Abandoned => "The run was abandoned",
            Self::InvalidDestination => "Not a valid destination",
            Self::NoDestination => "No destination",
            Self::CredentialNotFound => "Credential not found",
            Self::ConnectionNotFound => "Connection not found",
            Self::AlreadyExists => "It exists already",
            Self::InUse => "Still in use",
            Self::Overlaps => "The location overlaps another",
            Self::ProbeFailed => "Validation failed",
            Self::ListFilesFailed => "The files could not be listed",
            Self::StoreError => "The store refused",
            Self::StoreSilent => "The store did not answer in time",
            Self::AiNotConfigured => "AI is not set up for this workspace",
            Self::AiUnreachable => "The AI gateway is unreachable",
            Self::AiSilent => "The AI gateway did not answer in time",
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
    /// What the refusal is about: what still uses a credential or connection,
    /// or the connections a rotation would break.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependents: Vec<String>,
    /// How long a deadline waited before it fired, in milliseconds: set on
    /// the `*/silent` codes, and only on them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
}

impl ErrorBody {
    pub fn new(code: ErrorCode, detail: impl Into<String>, dependents: Vec<String>) -> Self {
        Self {
            code,
            title: code.title().to_string(),
            detail: detail.into(),
            data: ErrorData {
                dependents,
                after: None,
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

/// The one way the server refuses: a status and an [`ErrorBody`].
pub fn fail(status: StatusCode, code: ErrorCode, detail: impl Into<String>) -> Response {
    fail_about(status, code, detail, Vec::new())
}

/// Why a request was refused: a status, a code and a message, or a store
/// failure that maps itself.
#[derive(Debug)]
pub enum Refusal {
    Status {
        status: StatusCode,
        code: ErrorCode,
        detail: String,
        dependents: Vec<String>,
    },
    /// A body built whole, for a code whose `data` carries more than
    /// `dependents` — a deadline's `after`.
    Body(StatusCode, ErrorBody),
    Db(crate::database::DbError),
}

impl Refusal {
    pub fn new(status: StatusCode, code: ErrorCode, detail: impl Into<String>) -> Self {
        Self::Status {
            status,
            code,
            detail: detail.into(),
            dependents: Vec::new(),
        }
    }

    /// `code` is the resource's own `*/not-found`, so the web can tell a job
    /// that is not there from a route that is not.
    pub fn not_found(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, detail)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, ErrorCode::Forbidden, message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::ValidationFailed,
            message,
        )
    }

    /// A storage location that would share a prefix with `dependents`.
    pub fn overlaps(message: impl Into<String>, dependents: Vec<String>) -> Self {
        Self::Status {
            status: StatusCode::CONFLICT,
            code: ErrorCode::Overlaps,
            detail: message.into(),
            dependents,
        }
    }

    /// A probe failed: the store or provider did not accept what it was shown.
    pub fn probe_failed(message: impl Into<String>, dependents: Vec<String>) -> Self {
        Self::Status {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: ErrorCode::ProbeFailed,
            detail: message.into(),
            dependents,
        }
    }
}

impl From<crate::database::DbError> for Refusal {
    fn from(e: crate::database::DbError) -> Self {
        Self::Db(e)
    }
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        match self {
            Self::Status {
                status,
                code,
                detail,
                dependents,
            } => fail_about(status, code, detail, dependents),
            Self::Body(status, body) => (status, Json(body)).into_response(),
            Self::Db(e) => e.into_response(),
        }
    }
}

/// A refusal that names the resources it is about.
pub fn fail_about(
    status: StatusCode,
    code: ErrorCode,
    detail: impl Into<String>,
    dependents: Vec<String>,
) -> Response {
    (status, Json(ErrorBody::new(code, detail, dependents))).into_response()
}

/// The backstop that makes every 4xx/5xx an [`ErrorBody`], whoever produced
/// it. What the handlers refuse is one already; what reaches here bare is
/// axum's own answer — no route (404), a method the route does not take (405),
/// a body over the limit (413), and the `Json`, `Path` and `Query` rejections
/// (400/415/422) — whose plain-text message becomes the `detail`. A JSON error
/// body passes untouched: the only ones the server writes are `ErrorBody`.
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
        StatusCode::METHOD_NOT_ALLOWED => ErrorCode::MethodNotAllowed,
        StatusCode::PAYLOAD_TOO_LARGE => ErrorCode::TooLarge,
        StatusCode::TOO_MANY_REQUESTS => ErrorCode::RateLimited,
        StatusCode::UNAUTHORIZED => ErrorCode::SessionRequired,
        s if s.is_server_error() => ErrorCode::InternalError,
        _ => ErrorCode::InvalidFormat,
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
    let mut out = fail(status, code, detail);
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
    fail(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::InternalError,
        "An internal error occurred",
    )
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
