//! The one door a credential is vended through: fossil's `Host.credentials`
//! — a scope, an access — as an HTTP call. A scope is a source connection's
//! prefix or a job's dataset, `{sink}/{folder}/`; the store holds the
//! boundary, so the credential opens nothing else.

use axum::Json;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::{AnyRole, RbacError};
use crate::domain::{
    Access, Direction, JobStatus, StorageCredentialInput, StorageLocation, VendedCredentials,
};
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::startup::AppState;
use crate::storage_client;

/// What a credential is asked for: fossil's `Scope`, verbatim.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    /// A source connection's prefix, by the connection's name.
    Connection(String),
    /// A job's dataset, by the job's id.
    Job(String),
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct StorageCredentialsRequest {
    pub scope: Scope,
    pub access: Access,
}

#[utoipa::path(post, path = "/v1/storage-credentials", tag = "Storage",
    request_body = StorageCredentialsRequest,
    responses(
        (status = 200, description = "A credential that opens the scope's prefix, and only it, for an hour", body = VendedCredentials),
        (status = 400, description = "Not a storage source, or an access the scope does not give", body = ErrorBody),
        (status = 403, description = "A source asked by the owner, or a job's dataset written by the owner", body = ErrorBody),
        (status = 404, description = "No such connection, or no such job of the caller's", body = ErrorBody),
        (status = 409, description = "A job read before it completed (`job/not-completed`), or written before it runs (`job/not-running`) or after it ended (`job/ended`)", body = ErrorBody),
        (status = 502, description = "The store refused to vend", body = ErrorBody),
        (status = 504, description = "The store, or the identity service before it, did not answer in time", body = ErrorBody),
    )
)]
/// Vend a credential over `scope` for `access`. A member reads a source
/// connection — Unity Catalog's temporary path credentials over an external
/// location — and reads a job of their own once it has completed, or writes
/// it while it runs. The owner reads any completed job of the workspace, which
/// is what the datasets view opens; the owner never touches a source.
pub async fn vend(
    caller: AnyRole,
    State(state): State<AppState>,
    Json(req): Json<StorageCredentialsRequest>,
) -> Result<Response, Refusal> {
    let (location, credential) = match req.scope {
        Scope::Connection(name) => source(&state, &caller, &name, req.access).await?,
        Scope::Job(id) => dataset(&state, &caller, &id, req.access).await?,
    };
    let vended = storage_client::vend::vend(&credential, &location, req.access).await?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(VendedCredentials {
            storage_credentials: vec![vended],
        }),
    )
        .into_response())
}

/// A source connection's prefix: a member's, to read. Sources are read, never
/// written; the sink is reached only through its jobs.
async fn source(
    state: &AppState,
    caller: &AnyRole,
    name: &str,
    access: Access,
) -> Result<(StorageLocation, StorageCredentialInput), Refusal> {
    if caller.is_owner() {
        return Err(RbacError::InsufficientRole.into());
    }
    let connection = crate::connections::named(&state.db, name).await?;
    if connection.target.direction != Direction::Source {
        return Err(Refusal::invalid(format!(
            "{name:?} is not a storage source"
        )));
    }
    if access != Access::Read {
        return Err(Refusal::invalid("a source is read, never written"));
    }
    crate::connections::storage(&state.db, &connection).await
}

/// A job's dataset, `{sink}/{folder}/`: its creator's, to read once the job has
/// completed and to write while it runs; the owner's, to read once completed.
async fn dataset(
    state: &AppState,
    caller: &AnyRole,
    id: &str,
    access: Access,
) -> Result<(StorageLocation, StorageCredentialInput), Refusal> {
    let job = if caller.is_owner() {
        if access != Access::Read {
            return Err(Refusal::forbidden(
                "the owner reads a job's dataset, and only its creator writes it",
            ));
        }
        crate::jobs::any(&state.db, id).await?
    } else {
        crate::jobs::owned(&state.db, &caller.user_id, id).await?
    };
    match (access, &job.status) {
        (Access::Read, JobStatus::Completed) | (Access::Write, JobStatus::Running) => {}
        (Access::Read, _) => {
            return Err(Refusal::conflict(
                ErrorCode::JobNotCompleted,
                "The job has not completed, so it has no output to read",
            ));
        }
        (Access::Write, status) => return Err(super::jobs::not_running(status)),
    }
    let sink = crate::connections::persistence::get(&*state.db.read().await, &job.sink_connection)?
        .ok_or_else(|| {
            Refusal::new(
                StatusCode::BAD_REQUEST,
                ErrorCode::JobNoDestination,
                "The job's destination connection no longer exists",
            )
        })?;
    let (sink, credential) = crate::connections::storage(&state.db, &sink).await?;
    // Only a draft has no folder, and a draft is neither running nor completed.
    let output = job
        .output_under(&sink)
        .ok_or_else(|| Refusal::invalid("The job has no output folder"))?;
    Ok((output, credential))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(vend))
}
