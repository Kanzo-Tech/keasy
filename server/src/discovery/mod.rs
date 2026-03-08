pub mod convert;
pub mod graph_types;
pub mod rdf_graph;
pub mod routes;
pub mod dcat_extract;
pub mod dcat_generator;
pub mod dcat_types;
pub mod rdf_format;
pub mod validation;
pub mod validation_routes;
pub mod validation_types;

/// Well-known RDF vocabulary IRIs shared across the discovery module.
pub(crate) mod vocab {
    pub const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    pub const RDFS_LABEL: &str = "http://www.w3.org/2000/01/rdf-schema#label";
    pub const RDFS_COMMENT: &str = "http://www.w3.org/2000/01/rdf-schema#comment";
}
