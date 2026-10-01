use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa::openapi::{OpenApi, Ref, RefOr, ResponseBuilder, content::ContentBuilder};

/// Every error the server answers with. Closed: a code the server does not
/// declare here cannot be sent, and the web keys its copy by this enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    #[serde(rename = "auth/session_required")]
    SessionRequired,
    #[serde(rename = "auth/keys_unavailable")]
    KeysUnavailable,
    #[serde(rename = "rbac/no_membership")]
    NoMembership,
    #[serde(rename = "rbac/insufficient_role")]
    InsufficientRole,
    RateLimited,
    ValidationFailed,
    InvalidFormat,
    NotFound,
    Forbidden,
    InternalError,
    NotDraft,
    /// A job's output is read once the job has completed.
    NotCompleted,
    /// A job's output is written only while the job runs.
    NotRunning,
    StillRunning,
    InvalidDestination,
    NoDestination,
    /// A credential or connection of that name exists already, a second sink,
    /// or a second job writing to one folder.
    AlreadyExists,
    /// Still used: `dependents` names what uses it.
    InUse,
    /// A storage connection's location lies within another's, or holds one:
    /// `dependents` names them. Locations never overlap, so a prefix has one
    /// owner.
    Overlaps,
    /// A credential or connection did not validate against its store or
    /// provider; `dependents` names the connections that failed.
    ProbeFailed,
    ListFilesFailed,
    StoreError,
    /// This workspace has no AI gateway.
    AiNotConfigured,
    /// The AI gateway did not answer.
    AiUnreachable,
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
            Self::RateLimited => "Too many requests",
            Self::ValidationFailed => "The request is not valid",
            Self::InvalidFormat => "The request is malformed",
            Self::NotFound => "Not found",
            Self::Forbidden => "Not allowed",
            Self::InternalError => "The server failed",
            Self::NotDraft => "Not a draft",
            Self::NotCompleted => "The job has not completed",
            Self::NotRunning => "The job is not running",
            Self::StillRunning => "The job is still running",
            Self::InvalidDestination => "Not a valid destination",
            Self::NoDestination => "No destination",
            Self::AlreadyExists => "It exists already",
            Self::InUse => "Still in use",
            Self::Overlaps => "The location overlaps another",
            Self::ProbeFailed => "Validation failed",
            Self::ListFilesFailed => "The files could not be listed",
            Self::StoreError => "The store failed",
            Self::AiNotConfigured => "AI is not set up for this workspace",
            Self::AiUnreachable => "The AI gateway is unreachable",
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
}

impl ErrorBody {
    pub fn new(code: ErrorCode, detail: impl Into<String>, dependents: Vec<String>) -> Self {
        Self {
            code,
            title: code.title().to_string(),
            detail: detail.into(),
            data: ErrorData { dependents },
        }
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

    pub fn not_found(what: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            ErrorCode::NotFound,
            format!("{what} not found"),
        )
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
