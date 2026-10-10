//! The one door a credential is vended through: fossil's `Host.credentials`
//! — a scope, an access — as an HTTP call. A scope is a source connection's
//! prefix or a graph's dataset, `{sink}/{folder}/`; the store holds the
//! boundary, so the credential opens nothing else.

use axum::Json;
use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::permission::Action;
use crate::authentication::role::Reader;
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
    /// A graph's dataset, by the graph's id. `job` on the wire: the scope is
    /// fossil's, passed through verbatim, and fossil calls it that.
    #[serde(rename = "job")]
    Graph(String),
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct StorageCredentialsRequest {
    pub scope: Scope,
    pub access: Access,
}

#[utoipa::path(post, path = "/v1/storage-credentials", tag = "Storage", security(("bearer" = ["reader"])),
    request_body = StorageCredentialsRequest,
    responses(
        (status = 200, description = "A credential that opens the scope's prefix, and only it, for an hour", body = VendedCredentials),
        (status = 400, description = "Not a storage source, or an access the scope does not give", body = ErrorBody),
        (status = 403, description = "A source read below editor; a graph written below editor, or by anyone but its runner", body = ErrorBody),
        (status = 404, description = "No such connection, or no such graph", body = ErrorBody),
        (status = 409, description = "A graph read before it completed (`graph/not-completed`), or written before it runs (`graph/not-running`) or after it ended (`graph/ended`)", body = ErrorBody),
        (status = 502, description = "The store refused to vend", body = ErrorBody),
        (status = 504, description = "The store, or the identity service before it, did not answer in time", body = ErrorBody),
    )
)]
/// Vend a credential over `scope` for `access`. Anyone in the workspace reads a
/// completed graph's dataset. An editor reads a source connection — Unity
/// Catalog's temporary path credentials over an external location — to build
/// a graph, and writes a graph's dataset while it runs, if they are its runner.
pub async fn vend(
    caller: Reader,
    State(state): State<AppState>,
    Json(req): Json<StorageCredentialsRequest>,
) -> Result<Response, Refusal> {
    let access = req.access;
    // Whether a graph still runs is what the sweep decides: a write asks it.
    if matches!(req.scope, Scope::Graph(_)) && access == Access::Write {
        crate::graphs::sweep(&state.db).await?;
    }
    // What the scope is and the secret that reaches it, read at once; the
    // store is asked after, with no database held.
    let (location, credential) = {
        let conn = state.db.read().await;
        let key = state.db.secret_key();
        match req.scope {
            Scope::Connection(name) => {
                let source = crate::connections::source(&conn, &name)?;
                caller.ensure(Action::Use, &source)?;
                if access != Access::Read {
                    return Err(Refusal::invalid("a source is read, never written"));
                }
                crate::connections::storage(&conn, key, &source)?
            }
            Scope::Graph(id) => {
                let graph = crate::graphs::any(&conn, &id)?;
                // Reading a completed output uses the graph; writing one is
                // its run, operated by its runner alone.
                let action = match access {
                    Access::Read => Action::Use,
                    Access::Write => Action::Operate,
                };
                caller.ensure(action, &graph)?;
                graph.may(access, &caller)?;
                crate::graphs::output(&conn, key, &graph)?
            }
        }
    };
    let vended =
        storage_client::vend::vend(&credential, &location, &state.endpoints, access).await?;
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
