use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa::openapi::{OpenApi, RefOr, ResponseBuilder, content::ContentBuilder};

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
    BadRequest,
    ValidationFailed,
    InvalidFormat,
    InvalidPath,
    NotFound,
    Forbidden,
    InternalError,
    NotDraft,
    NotCompleted,
    StillRunning,
    InvalidDestination,
    NoDestination,
    InvalidConnection,
    ContainerNotFound,
    ListFilesFailed,
    StoreError,
    SignError,
    CatalogError,
    AiNotConfigured,
    SchemaRequired,
    InsufficientCredits,
    LlmFailed,
}

/// The body of every 4xx/5xx, and the payload of an SSE `error` frame.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    pub error: ErrorCode,
    pub message: String,
}

/// Every route behind the bearer scheme can be refused before its handler runs:
/// 401 without a verified token, 403 without the role it admits, 429 over the
/// caller's rate, 503 when the realm's keys cannot be fetched — and any of them
/// can fail with a 500. Documented once, here, for each of them.
pub fn document_refusals(openapi: &mut OpenApi) {
    let refused = |description: &str| {
        RefOr::T(
            ResponseBuilder::new()
                .description(description)
                .content(
                    "application/json",
                    ContentBuilder::new()
                        .schema(Some(RefOr::Ref(utoipa::openapi::Ref::from_schema_name(
                            "ErrorBody",
                        ))))
                        .build(),
                )
                .build(),
        )
    };
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
        {
            if op.security.is_some() {
                continue;
            }
            let responses = &mut op.responses.responses;
            for (status, description) in [
                ("401", "No verified bearer token"),
                ("403", "The caller holds no role this route admits"),
                ("429", "The caller exceeded their request rate"),
                ("500", "The server failed"),
                ("503", "The identity provider's keys are unreachable"),
            ] {
                responses
                    .entry(status.to_string())
                    .or_insert_with(|| refused(description));
            }
        }
    }
}
