//! keasy control-plane — the workspace provisioner.
//!
//! A small service, separate from the tenant instances, that owns the Docker
//! socket and a Keycloak admin service account. It exposes a reconcile API:
//!
//!   POST   /workspaces  { name, handle, owner_keycloak_sub }  → create (atomic, keyed)
//!   DELETE /workspaces/{id}                                    → tear down (keyed)
//!   GET    /workspaces                                         → list
//!   GET    /workspaces/by-owner?sub=…                          → a user's workspaces
//!   GET    /workspaces/by-handle?h=…                           → handle availability
//!   GET    /healthz                                            → liveness
//!
//! Mutating endpoints require `Authorization: Bearer <CP_API_KEY>`. The service is
//! internal-only (the keasy-edge overlay), reached only by the trusted central
//! server, which derives the owner sub from a fully-verified OIDC token.

mod config;
mod docker;
mod manifest;
mod provisioner;
mod store;

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::config::ControlPlaneConfig;
use crate::provisioner::{ProvisionError, Provisioner};

#[derive(Deserialize)]
struct CreateWorkspaceRequest {
    /// Display label.
    name: String,
    /// Unique routing identity (subdomain + Keycloak org alias); slugified server-side.
    handle: String,
    owner_keycloak_sub: String,
}

#[derive(Deserialize)]
struct OwnerQuery {
    sub: String,
}

#[derive(Deserialize)]
struct HandleQuery {
    h: String,
}

/// Extract the `Authorization: Bearer <key>` value, if present.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "control_plane=info,warn".into()),
        )
        .init();

    let config = match ControlPlaneConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("FATAL: {e}");
            std::process::exit(1);
        }
    };
    let bind_addr = config.bind_addr.clone();

    let stacks_dir = std::env::var("CP_STACKS_DIR").unwrap_or_else(|_| "/var/lib/keasy/stacks".into());
    let db_path = std::env::var("CP_DB_PATH").unwrap_or_else(|_| "/var/lib/keasy/control-plane.db".into());
    let provisioner = match Provisioner::new(config, stacks_dir, db_path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("FATAL: failed to init provisioner: {e}");
            std::process::exit(1);
        }
    };

    spawn_reconcile_loop(provisioner.clone());

    let app = Router::new()
        .route("/healthz", get(|| async { StatusCode::OK }))
        .route("/workspaces", get(list_workspaces).post(create_workspace))
        .route("/workspaces/by-owner", get(workspaces_by_owner))
        .route("/workspaces/by-handle", get(handle_available))
        .route("/workspaces/{id}", axum::routing::delete(delete_workspace))
        .route("/reconcile", axum::routing::post(reconcile))
        .with_state(provisioner);

    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("FATAL: failed to bind {bind_addr}: {e}");
            std::process::exit(1);
        }
    };
    tracing::info!(%bind_addr, "control-plane listening");
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("FATAL: server error: {e}");
        std::process::exit(1);
    }
}

async fn create_workspace(
    State(provisioner): State<Arc<Provisioner>>,
    headers: HeaderMap,
    Json(req): Json<CreateWorkspaceRequest>,
) -> Response {
    if !provisioner.verify_api_key(bearer(&headers)) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match provisioner
        .provision(&req.name, &req.handle, &req.owner_keycloak_sub)
        .await
    {
        Ok(info) => (StatusCode::CREATED, Json(info)).into_response(),
        Err(e) => error_response(&e),
    }
}

async fn delete_workspace(
    State(provisioner): State<Arc<Provisioner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if !provisioner.verify_api_key(bearer(&headers)) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match provisioner.deprovision(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response(&e),
    }
}

async fn list_workspaces(State(provisioner): State<Arc<Provisioner>>) -> Response {
    match provisioner.list() {
        Ok(workspaces) => Json(workspaces).into_response(),
        Err(e) => error_response(&e),
    }
}

/// A user's workspaces (list their projects). Internal read on the overlay.
async fn workspaces_by_owner(
    State(provisioner): State<Arc<Provisioner>>,
    Query(q): Query<OwnerQuery>,
) -> Response {
    match provisioner.list_by_owner(&q.sub) {
        Ok(workspaces) => Json(workspaces).into_response(),
        Err(e) => error_response(&e),
    }
}

/// Whether a workspace handle is available (+ its normalized form). Internal read.
async fn handle_available(
    State(provisioner): State<Arc<Provisioner>>,
    Query(q): Query<HandleQuery>,
) -> Response {
    match provisioner.handle_status(&q.h) {
        Ok((available, handle)) => {
            Json(serde_json::json!({ "available": available, "handle": handle })).into_response()
        }
        Err(e) => error_response(&e),
    }
}

/// Reconcile the live registry against the declarative manifest at `CP_DEPLOY_DIR`.
async fn reconcile(State(provisioner): State<Arc<Provisioner>>) -> Response {
    let Ok(dir) = std::env::var("CP_DEPLOY_DIR") else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "CP_DEPLOY_DIR not set" })),
        )
            .into_response();
    };
    match manifest::load_environment(std::path::Path::new(&dir)) {
        Ok(desired) => match provisioner.reconcile(&desired).await {
            Ok(summary) => Json(summary).into_response(),
            Err(e) => error_response(&e),
        },
        Err(e) => {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))).into_response()
        }
    }
}

/// Pull-based reconcile: every `CP_RECONCILE_INTERVAL_SECS` (0 = disabled, the
/// default) re-read the manifest and converge. Self-healing — a control-plane
/// restart rebuilds nothing; the next tick reconciles git against the SQLite registry.
fn spawn_reconcile_loop(provisioner: Arc<Provisioner>) {
    let secs: u64 = std::env::var("CP_RECONCILE_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if secs == 0 {
        tracing::info!("pull-based reconcile disabled (set CP_RECONCILE_INTERVAL_SECS > 0)");
        return;
    }
    let Ok(dir) = std::env::var("CP_DEPLOY_DIR") else {
        tracing::warn!("CP_RECONCILE_INTERVAL_SECS set but CP_DEPLOY_DIR missing — loop not started");
        return;
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(secs));
        loop {
            tick.tick().await;
            match manifest::load_environment(std::path::Path::new(&dir)) {
                Ok(desired) => match provisioner.reconcile(&desired).await {
                    Ok(s) => tracing::info!(summary = ?s, "reconcile complete"),
                    Err(e) => tracing::error!(error = %e, "reconcile failed"),
                },
                Err(e) => tracing::error!(error = %e, "reconcile: load manifest failed"),
            }
        }
    });
}

fn error_response(e: &ProvisionError) -> Response {
    let status = match e {
        ProvisionError::NotFound(_) => StatusCode::NOT_FOUND,
        ProvisionError::Invalid(_) => StatusCode::BAD_REQUEST,
        _ => StatusCode::BAD_GATEWAY,
    };
    tracing::error!(error = %e, "provisioning error");
    (status, Json(serde_json::json!({ "error": e.to_string() }))).into_response()
}
