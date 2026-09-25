use serde::Serialize;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DatasetsResponse {
    /// Every registered dataset in the workspace catalog.
    pub datasets: Vec<CatalogDataset>,
}

/// One registered dataset (a completed job's output) as the catalog sees it.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogDataset {
    /// The job id (the `job_` schema suffix), the dataset's stable handle.
    pub job_id: String,
    /// One entry per registered relation.
    pub tables: Vec<CatalogTable>,
}

/// A registered type within a dataset and its SQL shape.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogTable {
    /// The relation's name, as fossil named it (`Person`, `Person_knows_Person`).
    pub name: String,
    /// Row count, as the corpus reported it when the relation was published.
    pub rows: Option<i64>,
    /// Property columns, in declaration order.
    pub columns: Vec<CatalogColumn>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogColumn {
    pub name: String,
    /// DuckDB type spelling (`VARCHAR`, `BIGINT`, …).
    pub data_type: String,
}
