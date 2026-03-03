use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub enum TermValue {
    Iri(String),
    Literal {
        value: String,
        datatype: Option<String>,
        language: Option<String>,
    },
    BlankNode(String),
}

#[derive(Debug, Clone)]
pub struct KeasyTriple {
    pub subject: TermValue,
    pub predicate: String,
    pub object: TermValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TabularData {
    pub columns: Vec<String>,
    #[schema(value_type = Vec<Object>)]
    pub rows: Vec<BTreeMap<String, serde_json::Value>>,
    pub column_types: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SearchResult {
    pub id: String,
    pub label: String,
    pub group: String,
}
