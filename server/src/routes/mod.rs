pub mod ai;
pub mod connections;
pub mod credentials;
pub mod datasets;
pub mod health_check;
pub mod jobs;
pub mod workspaces;

use axum::http::StatusCode;
use axum::http::header::{CACHE_CONTROL, LOCATION};
use axum::response::{IntoResponse, Response};
use url::Url;

use crate::storage_client::SIGNED_URL_EXPIRES;

/// A read through keasy: the stable URL a reader holds answers with the
/// store's URL, signed now for the method asked. The browser keeps the redirect
/// for half the signature's life, so a reader's range requests go straight to
/// the store and a lapsed signature is never reused.
pub(crate) fn signed_redirect(url: Url) -> Response {
    (
        StatusCode::TEMPORARY_REDIRECT,
        [
            (LOCATION, url.to_string()),
            (
                CACHE_CONTROL,
                format!("private, max-age={}", SIGNED_URL_EXPIRES.as_secs() / 2),
            ),
        ],
    )
        .into_response()
}
