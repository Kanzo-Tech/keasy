use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Deserialize;

use crate::AppState;
use crate::jobs::{PipelineSummary, ValidationResult};
use crate::jobs::script;
use crate::jobs::pipeline_extract::extract_summary_from_plan;
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
    _ctx: Require<IsParticipant>,
    State(_state): State<AppState>,
    Json(payload): Json<ValidateRequest>,
) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || {
        match script::compile_to_plan("validate", &payload.script) {
            Ok(plan) => extract_summary_from_plan(&plan),
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
