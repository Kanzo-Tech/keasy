use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::AppState;
use crate::auth::role::Member;
use crate::cloud::reader;
use crate::discovery::routes::SIGNED_URL_EXPIRES;
use keasy_api::ErrorBody;
use keasy_api::cloud::FileEntry;
use keasy_api::connections::{
    Connection, ConnectionRefsResponse, CreateConnectionRequest, Direction, ListConnectionsQuery,
    LocationType, SignLocatorsRequest, SignLocatorsResponse,
};

use super::errors::ConnectionError;

/// A cloud connection and the credentials it signs with.
async fn resolve_cloud_connection(
    state: &AppState,
    id: &str,
) -> Result<(Connection, HashMap<String, String>), ConnectionError> {
    let connection = state
        .db
        .get_connection(id)
        .await?
        .ok_or(ConnectionError::NotFound)?;
    if connection.location_type == LocationType::Local || connection.cloud_account_id.is_none() {
        return Err(ConnectionError::InvalidConnection(
            "Operation not supported for a connection without a cloud account".to_string(),
        ));
    }
    let creds = state.db.connection_credentials(&connection).await?;
    Ok((connection, creds))
}

#[utoipa::path(get, path = "/v1/connections", tag = "Connections",
    params(ListConnectionsQuery),
    responses((status = 200, description = "List of connections", body = Vec<Connection>))
)]
pub async fn list_connections(
    _: Member,
    State(state): State<AppState>,
    Query(query): Query<ListConnectionsQuery>,
) -> Result<impl IntoResponse, ConnectionError> {
    Ok(Json(
        state
            .db
            .list_connections(query.kind.as_ref().map(AsRef::as_ref))
            .await?,
    ))
}

#[utoipa::path(post, path = "/v1/connections", tag = "Connections",
    request_body = CreateConnectionRequest,
    responses(
        (status = 201, description = "Connection created", body = Connection),
        (status = 400, description = "Invalid connection or container not found", body = ErrorBody),
    )
)]
pub async fn create_connection(
    _: Member,
    State(state): State<AppState>,
    Json(req): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    // The sink is the owner's, set on the catalog-storage page.
    if req.direction == Direction::Sink {
        return Err(ConnectionError::Forbidden(
            "only the owner can manage the workspace sink".to_string(),
        ));
    }

    if req.location_type == LocationType::Cloud
        && let Some(ref account_id) = req.cloud_account_id
    {
        let creds = state
            .db
            .build_storage_config(std::slice::from_ref(account_id))
            .await?;
        if let Err(msg) = reader::list_files(&req.url, &creds).await {
            return Err(ConnectionError::ContainerNotFound(format!(
                "Cannot access container '{}': {msg}",
                req.url
            )));
        }
    }

    let connection = state.db.create_connection(req).await?;
    Ok((StatusCode::CREATED, Json(connection)))
}

#[utoipa::path(get, path = "/v1/connections/{id}", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 200, description = "Connection details", body = Connection),
        (status = 404, description = "Connection not found", body = ErrorBody),
    )
)]
pub async fn get_connection(
    _: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    state
        .db
        .get_connection(&id)
        .await?
        .map(Json)
        .ok_or(ConnectionError::NotFound)
}

#[utoipa::path(delete, path = "/v1/connections/{id}", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 204, description = "Connection deleted"),
    )
)]
pub async fn delete_connection(
    _: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    if state
        .db
        .get_connection(&id)
        .await?
        .is_some_and(|c| c.direction == Direction::Sink)
    {
        return Err(ConnectionError::Forbidden(
            "only the owner can manage the workspace sink".to_string(),
        ));
    }
    state.db.remove_connection(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/v1/connections/{id}/files", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 200, description = "List of files in the connection", body = Vec<FileEntry>),
        (status = 400, description = "File listing not supported", body = ErrorBody),
        (status = 404, description = "Connection not found", body = ErrorBody),
    )
)]
pub async fn list_connection_files(
    _: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    let (connection, creds) = resolve_cloud_connection(&state, &id).await?;
    reader::list_files(&connection.url, &creds)
        .await
        .map(Json)
        .map_err(ConnectionError::ListFilesFailed)
}

#[utoipa::path(get, path = "/v1/connections/refs", tag = "Connections",
    responses((status = 200, description = "Every source connection's base URL, by name", body = ConnectionRefsResponse))
)]
/// The connections a program may read, by the name it writes after `@`. No
/// credentials: signing is [`sign_locators`].
pub async fn connection_refs(
    _: Member,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ConnectionError> {
    let refs = state
        .db
        .list_connections(None)
        .await?
        .into_iter()
        .filter(|c| c.direction == Direction::Source)
        .map(|c| (c.name, c.url))
        .collect();
    Ok(Json(ConnectionRefsResponse { refs }))
}

#[utoipa::path(post, path = "/v1/connections/urls", tag = "Connections",
    request_body = SignLocatorsRequest,
    responses((status = 200, description = "Signed GET URLs for the locators the caller may read", body = SignLocatorsResponse))
)]
/// Sign GET URLs for locators, each with the credentials of the connection it
/// lies under. Serves the editor and a job's run alike: a member reads what
/// every source connection holds, and the sink only through the job that
/// wrote it. Public HTTP locators come back as they are.
pub async fn sign_locators(
    _: Member,
    State(state): State<AppState>,
    Json(req): Json<SignLocatorsRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    let connections = state.db.list_connections(None).await?;
    let mut signing: HashMap<&str, HashMap<String, String>> = HashMap::new();
    let mut urls = HashMap::with_capacity(req.locators.len());
    for locator in &req.locators {
        let Some(conn) = signer(locator, &connections) else {
            if is_public_http(locator) {
                urls.insert(locator.clone(), locator.clone());
            }
            continue;
        };
        let creds = match signing.entry(conn.id.as_str()) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(state.db.connection_credentials(conn).await?)
            }
        };
        let (store, path) = crate::cloud::build_store(locator, creds)
            .map_err(|e| ConnectionError::SignFailed(e.to_string()))?;
        let signed = store
            .sign_url(Method::GET, &path, SIGNED_URL_EXPIRES)
            .await
            .map_err(|e| ConnectionError::SignFailed(e.to_string()))?;
        urls.insert(locator.clone(), signed.to_string());
    }
    Ok(Json(SignLocatorsResponse { urls }))
}

fn is_public_http(locator: &str) -> bool {
    locator.starts_with("https://") || locator.starts_with("http://")
}

/// The object path `locator` names under `base`, when it names one.
fn object_under<'a>(locator: &'a str, base: &str) -> Option<&'a str> {
    let rest = locator
        .strip_prefix(base.trim_end_matches('/'))?
        .strip_prefix('/')?;
    crate::cloud::relative_path(rest).ok().map(|()| rest)
}

/// The deepest connection `locator` lies under.
fn owner<'a>(locator: &str, connections: &'a [Connection]) -> Option<&'a Connection> {
    connections
        .iter()
        .filter(|c| object_under(locator, &c.url).is_some())
        .max_by_key(|c| c.url.trim_end_matches('/').len())
}

/// The connection that signs `locator`: its owner, when that is a cloud source.
/// A source rooted above the sink does not reach into it.
fn signer<'a>(locator: &str, connections: &'a [Connection]) -> Option<&'a Connection> {
    owner(locator, connections).filter(|c| {
        c.direction == Direction::Source
            && c.location_type == LocationType::Cloud
            && c.cloud_account_id.is_some()
            && crate::cloud::is_cloud_url(locator)
    })
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_connections, create_connection))
        .routes(routes!(get_connection, delete_connection))
        .routes(routes!(list_connection_files))
        .routes(routes!(connection_refs))
        .routes(routes!(sign_locators))
}

#[cfg(test)]
mod tests {
    use super::*;
    use keasy_api::connections::ConnectionKind;

    fn conn(name: &str, url: &str, direction: Direction) -> Connection {
        Connection {
            id: name.into(),
            name: name.into(),
            kind: ConnectionKind::Data,
            location_type: LocationType::Cloud,
            direction,
            cloud_account_id: Some("acct".into()),
            url: url.into(),
        }
    }

    fn workspace() -> Vec<Connection> {
        vec![
            conn("bucket", "s3://b/", Direction::Source),
            conn("shapes", "s3://b/vocab/", Direction::Source),
            conn("data", "s3://b/data", Direction::Source),
            conn("sink", "s3://b/output/", Direction::Sink),
        ]
    }

    fn signed_by(locator: &str) -> Option<String> {
        signer(locator, &workspace()).map(|c| c.name.clone())
    }

    #[test]
    fn the_deepest_connection_signs() {
        assert_eq!(
            signed_by("s3://b/vocab/shop.shex").as_deref(),
            Some("shapes")
        );
        assert_eq!(signed_by("s3://b/people.csv").as_deref(), Some("bucket"));
        assert_eq!(signed_by("s3://b/data/x.csv").as_deref(), Some("data"));
    }

    #[test]
    fn a_connection_owns_a_locator_only_at_a_path_boundary() {
        let only_data = vec![conn("data", "s3://b/data", Direction::Source)];
        assert!(signer("s3://b/data/x.csv", &only_data).is_some());
        assert!(signer("s3://b/data-private/x.csv", &only_data).is_none());
        assert!(signer("s3://b/data", &only_data).is_none());
        assert!(signer("s3://b/data/", &only_data).is_none());
        assert_eq!(
            signed_by("s3://b/data-private/x.csv").as_deref(),
            Some("bucket")
        );
    }

    #[test]
    fn the_sink_is_not_signed_even_under_a_source_rooted_above_it() {
        assert_eq!(signed_by("s3://b/output/job/vertex/Person.parquet"), None);
    }

    #[test]
    fn a_locator_cannot_climb_out_of_its_connection() {
        assert_eq!(signed_by("s3://b/vocab/../output/job/x.parquet"), None);
        assert_eq!(signed_by("s3://other/x.csv"), None);
    }

    #[test]
    fn a_source_without_credentials_does_not_sign() {
        let mut local = conn("local", "s3://b/", Direction::Source);
        local.cloud_account_id = None;
        assert!(signer("s3://b/x.csv", &[local]).is_none());
    }
}
