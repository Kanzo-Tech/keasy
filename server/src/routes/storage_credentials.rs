//! The one door a credential is vended through: fossil's `Host.credentials`
//! — a scope, an access — as an HTTP call. A scope is a source connection's
//! prefix or a job's dataset, `{sink}/{folder}/`; the store holds the
//! boundary, so the credential opens nothing else.

use axum::Json;
use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::AnyRole;
use crate::domain::{Access, VendedCredentials};
use crate::error::{ErrorBody, Refusal};
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
    let access = req.access;
    // Whether a job still runs is what the sweep decides: a write asks it.
    if matches!(req.scope, Scope::Job(_)) && access == Access::Write {
        crate::jobs::sweep(&state.db).await?;
    }
    // What the scope is and the secret that reaches it, read at once; the
    // store is asked after, with no database held.
    let (location, credential) = {
        let conn = state.db.read().await;
        let key = state.db.secret_key();
        match req.scope {
            Scope::Connection(name) => {
                if caller.is_owner() {
                    return Err(Refusal::forbidden("sources are the members'"));
                }
                if access != Access::Read {
                    return Err(Refusal::invalid("a source is read, never written"));
                }
                let source = crate::connections::source(&conn, &name)?;
                crate::connections::storage(&conn, key, &source)?
            }
            Scope::Job(id) => {
                let job = if caller.is_owner() {
                    if access != Access::Read {
                        return Err(Refusal::forbidden(
                            "the owner reads a job's dataset, and only its creator writes it",
                        ));
                    }
                    crate::jobs::any(&conn, &id)?
                } else {
                    crate::jobs::owned(&conn, &caller.user_id, &id)?
                };
                job.may(access)?;
                crate::jobs::output(&conn, key, &job)?
            }
        }
    };
    let vended = storage_client::vend::vend(&credential, &location, access).await?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(VendedCredentials {
            storage_credentials: vec![vended],
        }),
    )
        .into_response())
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(vend))
}
