//! Local copy of GraphAr manifest types.
//!
//! Previously provided by `fossil_rdf`. Kept here so the server compiles
//! while the underlying storage layer is being rewritten.

use serde::{Deserialize, Serialize};

/// Per-column statistics for a vertex property.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ColumnStat {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub iri: String,
    pub datatype: String,
    pub count: u64,
    pub n_unique: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<String>,
}

/// Manifest for a vertex type (one Parquet file per type).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TypeManifest {
    pub name: String,
    pub iri: String,
    pub vertex_file: String,
    pub entity_count: u64,
    pub columns: Vec<ColumnStat>,
}

/// Manifest for an edge type (GraphAr v1 ordered adjacency lists).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct EdgeManifest {
    pub name: String,
    pub iri: String,
    pub source_type: String,
    pub target_type: String,
    pub by_source: String,
    pub by_target: String,
    pub count: u64,
}

/// GraphAr-compatible manifest describing a property graph stored as Parquet files.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct DataManifest {
    pub types: Vec<TypeManifest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edges: Vec<EdgeManifest>,
}
