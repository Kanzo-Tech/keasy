//! The keasy HTTP contract, Rust side: every request, response and enum the
//! server puts on the wire, and the document they are published under. It
//! depends on no web framework and no store, so a type here cannot carry
//! storage along with it — the server maps its rows onto these.

pub mod ai;
pub mod auth;
pub mod connections;
pub mod credentials;
pub mod error;
pub mod health;
pub mod jobs;
pub mod validation;

pub use error::{ErrorBody, ErrorCode};

use utoipa::Modify;
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};

/// The document every route is collected into: its info, the bearer scheme, and
/// that scheme required by default. A public route opts out with `security(())`.
#[derive(utoipa::OpenApi)]
#[openapi(
    info(
        title = "Keasy API",
        version = "1.0.0",
        description = "Keasy host: identity, connections, signed URLs and the job record",
    ),
    components(schemas(ErrorBody, ErrorCode, credentials::Purpose)),
    modifiers(&Bearer),
    security(("bearer" = [])),
)]
pub struct ApiDoc;

pub const BEARER: &str = "bearer";

struct Bearer;

impl Modify for Bearer {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi
            .components
            .get_or_insert_with(Default::default)
            .add_security_scheme(
                BEARER,
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
    }
}
