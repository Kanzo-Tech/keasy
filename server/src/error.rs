use std::time::Duration;

use axum::Json;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa::openapi::{OpenApi, Ref, RefOr, ResponseBuilder, content::ContentBuilder};

pub use crate::problems::{ServerCode, TYPE_BASE};

/// The media type of every refusal (RFC 9457 §3).
pub const PROBLEM_JSON: &str = "application/problem+json";

/// A problem a runner reports, its title filled in when its code is the
/// server's and it carries none: keasy's words for its own failures live in
/// `problems.bnf`, and the web sends the code alone.
pub fn titled(mut problem: serde_json::Value) -> serde_json::Value {
    if let Some(fields) = problem.as_object_mut()
        && !fields.contains_key("title")
        && let Some(code) = fields
            .get("code")
            .and_then(|code| ServerCode::deserialize(code).ok())
    {
        fields.insert("title".into(), code.title().into());
    }
    problem
}

/// Every 4xx/5xx the server writes, and every problem it stores:
/// `application/problem+json` (RFC 9457), with the extension members
/// `@kanzo-tech/kernel`'s `Problem.from` reads back (§3.2) — `code`, its
/// discriminator, and `data`, what the code carries.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Problem {
    /// The registry's base followed by `code`: derived from it, never set apart
    /// (§3.1.1).
    #[serde(rename = "type")]
    pub type_uri: String,
    /// The HTTP status of the response that carries it (§3.1.2); absent from a
    /// problem that is stored, never answered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// The code's title, the same for every occurrence (§3.1.3).
    pub title: String,
    /// This occurrence, for a person; nothing parses it (§3.1.4).
    pub detail: String,
    pub code: ServerCode,
    pub data: ProblemData,
}

/// What a problem carries beside its words.
#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct ProblemData {
    /// What the refusal is about: what still uses a secret or connection,
    /// or the connections a rotation would break.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dependents: Vec<String>,
    /// How long a deadline waited before it fired, in milliseconds: set on
    /// the `*/silent` codes, and only on them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
    /// The request field the refusal is about, so a form can say it on that
    /// field: `folder`, `name`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    /// Where in the field's text the refusal is, when its parser says: the
    /// 1-based line and column (in characters) its own message prints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    /// The column on `line`, as the parser counts it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u64>,
}

impl Problem {
    /// A problem of `code`, at the status `problems.bnf` gives it.
    pub fn new(code: ServerCode, detail: impl Into<String>) -> Self {
        Self {
            type_uri: format!("{TYPE_BASE}{}", code.as_str()),
            status: code.status(),
            title: code.title().to_string(),
            detail: detail.into(),
            code,
            data: ProblemData::default(),
        }
    }
}

/// Why a request was refused, and the one way the server refuses: a status
/// and the [`Problem`] it carries. Every failure a handler meets — the
/// database's, the role check's, the token check's, the store's — converts into
/// one, so a route has one error type and the wire has one shape.
#[derive(Debug)]
pub struct Refusal {
    pub status: StatusCode,
    /// Boxed: a refusal is the `Err` of nearly every function here, and the
    /// body is the large part of it.
    pub body: Box<Problem>,
}

impl Refusal {
    /// A refusal of `code`, at the status `problems.bnf` gives it. A code the
    /// registry answers with no status (`-`) is stored, never refused with: one
    /// that is anyway is the server's failure, a 500.
    pub fn new(code: ServerCode, detail: impl Into<String>) -> Self {
        let status = code
            .status()
            .and_then(|s| StatusCode::from_u16(s).ok())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut body = Problem::new(code, detail);
        body.status = Some(status.as_u16());
        Self {
            status,
            body: Box::new(body),
        }
    }

    /// A refusal that names the resources it is about.
    pub fn about(code: ServerCode, detail: impl Into<String>, dependents: Vec<String>) -> Self {
        let mut refusal = Self::new(code, detail);
        refusal.body.data.dependents = dependents;
        refusal
    }

    /// A deadline that fired: `code` names who did not answer, `after` how
    /// long they were given.
    pub fn silent(code: ServerCode, detail: impl Into<String>, after: Duration) -> Self {
        let mut refusal = Self::new(code, detail);
        refusal.body.data.after = Some(after.as_millis() as u64);
        refusal
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(ServerCode::RbacForbidden, message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ServerCode::RequestInvalid, message)
    }

    /// A refusal about one field of the request.
    pub fn field(code: ServerCode, field: &str, detail: impl Into<String>) -> Self {
        let mut refusal = Self::new(code, detail);
        refusal.body.data.field = Some(field.to_string());
        refusal
    }

    /// A field spelled in a way the request may not.
    pub fn invalid_field(field: &str, detail: impl Into<String>) -> Self {
        Self::field(ServerCode::RequestInvalid, field, detail)
    }

    /// A storage location that would share a prefix with `dependents`.
    pub fn overlaps(message: impl Into<String>, dependents: Vec<String>) -> Self {
        Self::about(ServerCode::ConnectionOverlaps, message, dependents)
    }

    /// A probe ran and did not pass: the store or provider answered, and did
    /// not accept what it was shown. A store that refused to answer at all is
    /// `store/refused`, a 502, not this.
    pub fn probe_failed(message: impl Into<String>, dependents: Vec<String>) -> Self {
        Self::about(ServerCode::ProbeFailed, message, dependents)
    }

    /// The server failed; what failed is logged, never sent.
    pub fn internal() -> Self {
        Self::new(ServerCode::ServerInternal, "An internal error occurred")
    }
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        (
            self.status,
            [(header::CONTENT_TYPE, PROBLEM_JSON)],
            Json(self.body),
        )
            .into_response()
    }
}

/// The backstop that makes every 4xx/5xx a [`Problem`], whoever produced it.
/// What the handlers refuse is one already, and passes untouched; what reaches
/// here bare is axum's own answer — no route (404), a method the route does not
/// take (405), a body over the limit (413), and the `Json`, `Path` and `Query`
/// rejections (400/415/422, all `request/malformed`) — whose plain-text message
/// becomes the `detail`, and whose status the problem keeps (RFC 9457 §3.1.2).
pub async fn as_problem(response: Response) -> Response {
    let status = response.status();
    if !(status.is_client_error() || status.is_server_error()) {
        return response;
    }
    let is_problem = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with(PROBLEM_JSON));
    if is_problem {
        return response;
    }
    let (parts, body) = response.into_parts();
    let code = match status {
        StatusCode::NOT_FOUND => ServerCode::RouteNotFound,
        StatusCode::METHOD_NOT_ALLOWED => ServerCode::RequestMethodNotAllowed,
        StatusCode::PAYLOAD_TOO_LARGE => ServerCode::RequestTooLarge,
        StatusCode::TOO_MANY_REQUESTS => ServerCode::RequestRateLimited,
        StatusCode::UNAUTHORIZED => ServerCode::AuthSessionRequired,
        s if s.is_server_error() => ServerCode::ServerInternal,
        _ => ServerCode::RequestMalformed,
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
    let mut refusal = Refusal::new(code, detail);
    refusal.status = status;
    refusal.body.status = Some(status.as_u16());
    let mut out = refusal.into_response();
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
                        PROBLEM_JSON,
                        ContentBuilder::new()
                            .schema(Some(Ref::from_schema_name("Problem")))
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

    /// The web reports `graph/interrupted` by its code: the title is the
    /// server's. A problem that carries a title, or whose code is not the
    /// server's, is kept as it came.
    #[test]
    fn a_reported_problem_of_the_servers_code_takes_its_title() {
        let filled = titled(serde_json::json!({ "code": "graph/interrupted", "detail": "d" }));
        assert_eq!(filled["title"], "The run was interrupted");
        for kept in [
            serde_json::json!({ "code": "graph/interrupted", "title": "Mine" }),
            serde_json::json!({ "code": "run/over-budget", "detail": "d" }),
        ] {
            assert_eq!(titled(kept.clone()), kept);
        }
    }
}
