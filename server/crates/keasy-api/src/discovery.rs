use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct DatasetUrlsRequest {
    /// Paths relative to the dataset (or connection). The caller names them —
    /// the executor's output, the corpus reader's enumeration — and keasy signs
    /// the list it is handed.
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ResolveResponse {
    /// Dataset-relative path → signed URL.
    pub files: HashMap<String, String>,
}
