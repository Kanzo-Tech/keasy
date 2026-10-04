use serde::Serialize;

use super::Provenance;

/// A graph's rules: one SHACL shapes graph, the Turtle document the web's
/// rules editor writes. keasy stores it and hands it back, and never parses
/// it: rudof reads it where the rules run, in the browser.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct Rules {
    /// The shapes graph, `text/turtle`.
    pub shapes: String,
    /// Who saved it first and when, and who saved it last.
    #[serde(flatten)]
    pub provenance: Provenance,
}
