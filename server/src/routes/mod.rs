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
/// the store and a lapsed signature is never reused. Uncached, every range
/// read pays the proxy and a signing (~270 ms in dev against ~1 ms).
///
/// The one cost: a browser may answer a HEAD from the redirect it cached for a
/// GET, whose URL S3 refuses for HEAD. Chrome does so for a HEAD without
/// `Range` after a ranged GET, never for one with it — and DuckDB-WASM, the
/// only reader that sends HEAD, always sends `Range: bytes=0-`.
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
