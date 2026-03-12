use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Deserialize;

use crate::AppState;
use crate::jobs::{PipelineSummary, ValidationResult, extract_summary};
use crate::jobs::script;
use crate::jobs::rewrite;
use crate::middleware::tenant::{IsParticipant, Require};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ValidateRequest {
    pub script: String,
}

#[utoipa::path(post, path = "/v1/scripts/validate", tag = "Scripts",
    request_body = ValidateRequest,
    responses((status = 200, description = "Validation result", body = ValidationResult))
)]
pub async fn validate_script(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(payload): Json<ValidateRequest>,
) -> impl IntoResponse {
    let resolved = match rewrite::resolve(&payload.script, &ctx.org_id.0, &state.db).await {
        Ok(r) => r,
        Err(err) => {
            return (
                StatusCode::OK,
                Json(ValidationResult {
                    valid: false,
                    pipeline: PipelineSummary::default(),
                    errors: vec![err.message],
                }),
            );
        }
    };

    let result = tokio::task::spawn_blocking(move || {
        match script::compile("validate", &resolved.script, resolved.storage) {
            Ok(result) => extract_summary(&result.program),
            Err(errors) => ValidationResult {
                valid: false,
                pipeline: PipelineSummary::default(),
                errors,
            },
        }
    })
    .await;

    match result {
        Ok(validation) => (StatusCode::OK, Json(validation)),
        Err(join_err) => (
            StatusCode::OK,
            Json(ValidationResult {
                valid: false,
                pipeline: PipelineSummary::default(),
                errors: vec![format!("Internal error: {}", join_err)],
            }),
        ),
    }
}
