//! Who else may manage an object, who may use a secret, and who owns it:
//! the Share dialog's two calls, on a secret, a connection and a graph.
//!
//! `PUT …/grants` replaces the object's grants whole, as Google Drive's
//! dialog applies its changes on *Save*: whoever manages the object shares it.
//! `PUT …/owner` gives it away: only its owner or an admin, as only a Unity
//! Catalog securable's owner or a metastore admin changes its owner.

use std::collections::HashSet;

use axum::Json;
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::permission::{Action, Kind, Securable};
use crate::authentication::role::{Caller, Editor};
use crate::credentials::persistence as credentials;
use crate::domain::{
    Actor, ConnectionView, Graph, Principal, PrincipalKind, Relation, SecretView, WORKSPACE,
};
use crate::error::{ErrorBody, Refusal};
use crate::grants::{self, Object};
use crate::startup::AppState;

/// The most grants one object holds: a share list people read, not a
/// directory. Past it, grant to a group.
pub const MAX_GRANTS: usize = 100;

/// The longest name a grantee or an owner is kept under.
const MAX_NAME: usize = 200;

/// One grant, as the Share dialog asks for it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GrantRequest {
    /// A person, by `sub`, or one of the organization's groups, by its
    /// Keycloak id — and the name the directory gave it, kept for people to
    /// read and never compared.
    pub principal: Principal,
    /// `manager` on anything but the sink; `user` on a secret only.
    pub relation: Relation,
}

/// The object's grants, all of them: what is left out is revoked.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GrantsRequest {
    pub grants: Vec<GrantRequest>,
}

/// Who is to own the object: a person, by `sub` and name, or the workspace
/// (`{ "id": "workspace" }`).
#[derive(Debug, Deserialize, ToSchema)]
pub struct TransferRequest {
    pub owner: OwnerRequest,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OwnerRequest {
    pub id: String,
    /// Required for a person; ignored for the workspace.
    #[serde(default)]
    pub name: Option<String>,
}

/// `name`, trimmed, or why it cannot be kept.
fn kept_name(name: &str, field: &str) -> Result<String, Refusal> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(Refusal::invalid_field(
            field,
            format!("a name of 1 to {MAX_NAME} characters"),
        ));
    }
    Ok(name.to_string())
}

/// The request's grants, checked against what `object` may be granted:
/// one of each, no more than [`MAX_GRANTS`], a `user` only of a secret, none
/// on the sink and none to whom already owns it.
fn checked(
    object: &impl Securable,
    request: GrantsRequest,
) -> Result<Vec<(Principal, Relation)>, Refusal> {
    let kind = object.kind();
    if kind == Kind::Sink && !request.grants.is_empty() {
        return Err(Refusal::invalid_field(
            "grants",
            "the sink is the workspace's, and only an admin manages it: it is not shared",
        ));
    }
    let mut seen = HashSet::new();
    let mut grants = Vec::new();
    for GrantRequest {
        principal,
        relation,
    } in request.grants
    {
        if relation == Relation::User && kind != Kind::Secret {
            return Err(Refusal::invalid_field(
                "grants",
                "only a secret is used by a grant: every editor uses what else there is",
            ));
        }
        let id = principal.id.trim().to_string();
        if id.is_empty() || (principal.kind == PrincipalKind::User && id == WORKSPACE) {
            return Err(Refusal::invalid_field(
                "grants",
                "a grant names a person or a group by id",
            ));
        }
        if principal.kind == PrincipalKind::User && id == object.owner().id {
            return Err(Refusal::invalid_field(
                "grants",
                "its owner holds every grant already",
            ));
        }
        if !seen.insert((principal.kind, id.clone(), relation)) {
            continue;
        }
        let name = kept_name(&principal.name, "grants")?;
        grants.push((
            Principal {
                kind: principal.kind,
                id,
                name,
            },
            relation,
        ));
    }
    if grants.len() > MAX_GRANTS {
        return Err(Refusal::invalid_field(
            "grants",
            format!("at most {MAX_GRANTS} grants: past that, grant to a group"),
        ));
    }
    Ok(grants)
}

/// The owner a transfer names.
fn new_owner(request: TransferRequest) -> Result<Actor, Refusal> {
    let OwnerRequest { id, name } = request.owner;
    if id == WORKSPACE {
        return Ok(Actor::workspace());
    }
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err(Refusal::invalid_field(
            "owner",
            "an owner names a person by id",
        ));
    }
    let name = kept_name(name.as_deref().unwrap_or_default(), "owner")?;
    Ok(Actor { id, name })
}

async fn secret_seen(state: &AppState, caller: &Caller, name: &str) -> Result<SecretView, Refusal> {
    let credential = crate::credentials::named(&state.db, name).await?;
    let used_by = credentials::users_of(&*state.db.read().await, name)?;
    Ok(credential.view(used_by).seen_by(caller))
}

async fn connection_seen(
    state: &AppState,
    caller: &Caller,
    name: &str,
) -> Result<ConnectionView, Refusal> {
    Ok(crate::connections::named(&state.db, name)
        .await?
        .seen_by(caller))
}

async fn graph_seen(state: &AppState, caller: &Caller, id: &str) -> Result<Graph, Refusal> {
    let conn = state.db.read().await;
    crate::graphs::present(&conn, caller, crate::graphs::any(&conn, id)?)
}

#[utoipa::path(put, path = "/v1/secrets/{name}/grants", tag = "Secrets", security(("bearer" = ["editor"])),
    params(("name" = String, Path, description = "Secret name")),
    request_body = GrantsRequest,
    responses(
        (status = 200, description = "Shared as asked: the secret with its grants", body = SecretView),
        (status = 400, description = "A grant the secret cannot hold (`data.field` = `grants`)", body = ErrorBody),
        (status = 403, description = "Neither its owner, a manager nor an admin", body = ErrorBody),
        (status = 404, description = "No such secret", body = ErrorBody),
    )
)]
/// Who else manages the secret, and who may build a connection on it.
pub async fn share_secret(
    caller: Editor,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<GrantsRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let current = crate::credentials::named(&state.db, &name).await?;
    caller.ensure(Action::Manage, &current)?;
    let grants = checked(&current, request)?;
    grants::replace(
        &*state.db.write().await,
        Object::Secret(&name),
        &grants,
        &caller.actor(),
    )?;
    Ok(Json(secret_seen(&state, &caller, &name).await?))
}

#[utoipa::path(put, path = "/v1/connections/{name}/grants", tag = "Connections", security(("bearer" = ["editor"])),
    params(("name" = String, Path, description = "Connection name")),
    request_body = GrantsRequest,
    responses(
        (status = 200, description = "Shared as asked: the connection with its grants", body = ConnectionView),
        (status = 400, description = "A grant the connection cannot hold — any on the sink (`data.field` = `grants`)", body = ErrorBody),
        (status = 403, description = "Neither its owner, a manager nor an admin", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
    )
)]
/// Who else manages the connection. Every editor already uses it.
pub async fn share_connection(
    caller: Editor,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<GrantsRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let current = crate::connections::named(&state.db, &name).await?;
    caller.ensure(Action::Manage, &current)?;
    let grants = checked(&current, request)?;
    grants::replace(
        &*state.db.write().await,
        Object::Connection(&name),
        &grants,
        &caller.actor(),
    )?;
    Ok(Json(connection_seen(&state, &caller, &name).await?))
}

#[utoipa::path(put, path = "/v1/graphs/{id}/grants", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    request_body = GrantsRequest,
    responses(
        (status = 200, description = "Shared as asked: the graph with its grants", body = Graph),
        (status = 400, description = "A grant the graph cannot hold (`data.field` = `grants`)", body = ErrorBody),
        (status = 403, description = "Neither its owner, a manager nor an admin", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
    )
)]
/// Who else manages the graph, its rules and its dashboard. Every reader
/// already reads it, and every editor runs it.
pub async fn share_graph(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<GrantsRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let current = crate::graphs::permitted(&*state.db.read().await, &caller, &id, Action::Manage)?;
    let grants = checked(&current, request)?;
    grants::replace(
        &*state.db.write().await,
        Object::Graph(&id),
        &grants,
        &caller.actor(),
    )?;
    Ok(Json(graph_seen(&state, &caller, &id).await?))
}

#[utoipa::path(put, path = "/v1/secrets/{name}/owner", tag = "Secrets", security(("bearer" = ["editor"])),
    params(("name" = String, Path, description = "Secret name")),
    request_body = TransferRequest,
    responses(
        (status = 200, description = "Given away: the secret under its new owner", body = SecretView),
        (status = 400, description = "No owner named (`data.field` = `owner`)", body = ErrorBody),
        (status = 403, description = "Neither its owner nor an admin", body = ErrorBody),
        (status = 404, description = "No such secret", body = ErrorBody),
    )
)]
/// Its previous owner keeps nothing by having owned it, as in Unity Catalog:
/// what they still need, the new owner grants them.
pub async fn transfer_secret(
    caller: Editor,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<TransferRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let current = crate::credentials::named(&state.db, &name).await?;
    caller.ensure(Action::Transfer, &current)?;
    let owner = new_owner(request)?;
    grants::transfer(&*state.db.write().await, Object::Secret(&name), &owner)?;
    Ok(Json(secret_seen(&state, &caller, &name).await?))
}

#[utoipa::path(put, path = "/v1/connections/{name}/owner", tag = "Connections", security(("bearer" = ["editor"])),
    params(("name" = String, Path, description = "Connection name")),
    request_body = TransferRequest,
    responses(
        (status = 200, description = "Given away: the connection under its new owner", body = ConnectionView),
        (status = 400, description = "No owner named (`data.field` = `owner`)", body = ErrorBody),
        (status = 403, description = "Neither its owner nor an admin; the sink, no one", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
    )
)]
pub async fn transfer_connection(
    caller: Editor,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<TransferRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let current = crate::connections::named(&state.db, &name).await?;
    caller.ensure(Action::Transfer, &current)?;
    let owner = new_owner(request)?;
    grants::transfer(&*state.db.write().await, Object::Connection(&name), &owner)?;
    Ok(Json(connection_seen(&state, &caller, &name).await?))
}

#[utoipa::path(put, path = "/v1/graphs/{id}/owner", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    request_body = TransferRequest,
    responses(
        (status = 200, description = "Given away: the graph under its new owner", body = Graph),
        (status = 400, description = "No owner named (`data.field` = `owner`)", body = ErrorBody),
        (status = 403, description = "Neither its owner nor an admin", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
    )
)]
pub async fn transfer_graph(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<TransferRequest>,
) -> Result<impl IntoResponse, Refusal> {
    crate::graphs::permitted(&*state.db.read().await, &caller, &id, Action::Transfer)?;
    let owner = new_owner(request)?;
    grants::transfer(&*state.db.write().await, Object::Graph(&id), &owner)?;
    Ok(Json(graph_seen(&state, &caller, &id).await?))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(share_secret))
        .routes(routes!(share_connection))
        .routes(routes!(share_graph))
        .routes(routes!(transfer_secret))
        .routes(routes!(transfer_connection))
        .routes(routes!(transfer_graph))
}
