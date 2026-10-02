//! A job's dataset, `{sink.url}/{folder}/`: the credential that writes it
//! while the job runs and reads it once it has completed.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::Member;
use crate::domain::{Access, JobStatus, VendedCredentials};
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::jobs::owned;
use crate::startup::AppState;
use crate::storage_client;
use crate::storage_client::vend::VendError;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CredentialsRequest {
    pub access: Access,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/credentials", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = CredentialsRequest,
    responses(
        (status = 200, description = "A credential that opens the job's dataset, and only it, for an hour", body = VendedCredentials),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "Read before the job completed, or write while it is not running", body = ErrorBody),
        (status = 502, description = "The store refused to vend", body = ErrorBody),
        (status = 504, description = "The store, or the identity service before it, did not answer in time", body = ErrorBody),
    )
)]
/// Vend a credential over the job's dataset, `{sink}/{folder}/`: to read it
/// once the job has completed, or to write it while the job runs. The store
/// holds the boundary, so the credential opens nothing else.
pub async fn vend_job_credentials(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<CredentialsRequest>,
) -> Result<Response, Refusal> {
    let job = owned(&state.db, &member.user_id, &id).await?;
    match (req.access, &job.status) {
        (Access::Read, JobStatus::Completed) | (Access::Write, JobStatus::Running) => {}
        (Access::Read, _) => {
            return Err(Refusal::new(
                StatusCode::CONFLICT,
                ErrorCode::NotCompleted,
                "The job has not completed, so it has no output to read",
            ));
        }
        (Access::Write, _) => {
            return Err(Refusal::new(
                StatusCode::CONFLICT,
                ErrorCode::NotRunning,
                "A job's output is written only while the job runs",
            ));
        }
    }
    let sink = crate::connections::persistence::get(&*state.db.read().await, &job.sink_connection)?
        .ok_or_else(|| {
            Refusal::new(
                StatusCode::BAD_REQUEST,
                ErrorCode::NoDestination,
                "The job's destination connection no longer exists",
            )
        })?;
    let (sink, credential) = crate::connections::storage(&state.db, &sink).await?;
    // Only a draft has no folder, and a draft is neither running nor completed.
    let output = job
        .output_under(&sink)
        .ok_or_else(|| Refusal::invalid("The job has no output folder"))?;
    vended(&credential, &output, req.access).await
}

/// The response every vending route answers with: never cached.
pub(crate) async fn vended(
    credential: &crate::domain::StorageCredentialInput,
    location: &crate::domain::StorageLocation,
    access: Access,
) -> Result<Response, Refusal> {
    let credential = storage_client::vend::vend(credential, location, access)
        .await
        .map_err(|e| match e {
            VendError::Refused(message) => {
                Refusal::new(StatusCode::BAD_GATEWAY, ErrorCode::StoreError, message)
            }
            silent @ VendError::Silent { after, .. } => Refusal::Body(
                StatusCode::GATEWAY_TIMEOUT,
                ErrorBody::silent(ErrorCode::StoreSilent, silent.to_string(), after),
            ),
        })?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(VendedCredentials {
            storage_credentials: vec![credential],
        }),
    )
        .into_response())
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(vend_job_credentials))
}
