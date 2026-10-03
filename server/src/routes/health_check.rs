use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::startup::AppState;

/// How long readiness waits on the database before it says not ready.
const READY_WITHIN: Duration = Duration::from_secs(2);

#[utoipa::path(get, path = "/healthz/live", tag = "Health", security(()),
    responses((status = 200, description = "The process is serving"))
)]
pub async fn liveness() -> StatusCode {
    StatusCode::OK
}

#[utoipa::path(get, path = "/healthz/ready", tag = "Health", security(()),
    responses(
        (status = 200, description = "The database answers"),
        (status = 503, description = "The database did not answer in time", body = ErrorBody),
    )
)]
/// Ready when the database answers. The identity provider's keys are not a
/// condition: a realm outage would otherwise restart every instance at once,
/// and requests already say `auth/keys-unavailable` on their own.
pub async fn readiness(State(state): State<AppState>) -> Result<StatusCode, Refusal> {
    let answer = tokio::time::timeout(READY_WITHIN, async {
        state.db.read().await.query_row("SELECT 1", [], |_| Ok(()))
    })
    .await;
    match answer {
        Ok(Ok(())) => Ok(StatusCode::OK),
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "readiness: the database refused");
            Err(not_ready())
        }
        Err(_) => {
            tracing::warn!("readiness: the database did not answer within {READY_WITHIN:?}");
            Err(not_ready())
        }
    }
}

fn not_ready() -> Refusal {
    Refusal::new(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorCode::ServerNotReady,
        "the database did not answer",
    )
}

/// Public: the probes.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(liveness))
        .routes(routes!(readiness))
}
