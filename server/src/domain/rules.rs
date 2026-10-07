use serde::Serialize;

use super::Provenance;

/// A graph's rules: one SHACL shapes graph, the Turtle file a member dropped,
/// under the name it was dropped with. keasy hands it back as it was sent:
/// rudof reads it where the rules run, in the browser.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct Rules {
    /// The file's name, as it was dropped: what the rules are called, and what
    /// downloading them saves.
    pub name: String,
    /// The shapes graph, `text/turtle`.
    pub shapes: String,
    /// Who saved it first and when, and who saved it last.
    #[serde(flatten)]
    pub provenance: Provenance,
}
