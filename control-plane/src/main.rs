//! keasy control-plane — the workspace provisioner.
//!
//! A small service, separate from the tenant instances, that owns the Docker
//! socket and a Keycloak admin service account. It exposes a reconcile API:
//!
//!   POST   /workspaces  { name, owner_keycloak_sub }  → create (atomic)
//!   DELETE /workspaces/{id}                            → tear down
//!   GET    /workspaces                                 → list
//!   GET    /healthz                                    → liveness
//!
//! It replaces the old SQL-seed + manual-compose bootstrap: a workspace exists
//! if and only if the control-plane created it.

mod config;
mod docker;
mod provisioner;

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::config::ControlPlaneConfig;
use crate::provisioner::{ProvisionError, Provisioner};

#[derive(Deserialize)]
struct CreateWorkspaceRequest {
    name: String,
    owner_keycloak_sub: String,
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
    let provisioner = match Provisioner::new(config, stacks_dir) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("FATAL: failed to init provisioner: {e}");
            std::process::exit(1);
        }
    };

    let app = Router::new()
        .route("/healthz", get(|| async { StatusCode::OK }))
        .route("/workspaces", get(list_workspaces).post(create_workspace))
        .route("/workspaces/{id}", axum::routing::delete(delete_workspace))
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
    Json(req): Json<CreateWorkspaceRequest>,
) -> Response {
    match provisioner.provision(&req.name, &req.owner_keycloak_sub).await {
        Ok(info) => (StatusCode::CREATED, Json(info)).into_response(),
        Err(e) => error_response(&e),
    }
}

async fn delete_workspace(
    State(provisioner): State<Arc<Provisioner>>,
    Path(id): Path<String>,
) -> Response {
    match provisioner.deprovision(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response(&e),
    }
}

async fn list_workspaces(State(provisioner): State<Arc<Provisioner>>) -> Response {
    Json(provisioner.list().await).into_response()
}

fn error_response(e: &ProvisionError) -> Response {
    let status = match e {
        ProvisionError::NotFound(_) => StatusCode::NOT_FOUND,
        _ => StatusCode::BAD_GATEWAY,
    };
    tracing::error!(error = %e, "provisioning error");
    (status, Json(serde_json::json!({ "error": e.to_string() }))).into_response()
}
