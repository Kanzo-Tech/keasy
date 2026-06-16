// server/src/catalog/view.rs — the governance read surface over the catalog.
//
// This is the catalog's reader (W1b): unlike the discovery viewer (which needs
// fossil's GraphAr layout from the manifest YAMLs), governance asks SQL-shaped
// questions — what datasets exist, what types/columns/rows each holds. Those are
// exactly what the DuckLake catalog is the authority for, queried through plain
// information_schema, no GraphAr knowledge in the host.

use serde::Serialize;

use super::{Catalog, CatalogError};

/// One registered dataset (a completed job's output) as the catalog sees it.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogDataset {
    /// The job id (the `job_` schema suffix), the dataset's stable handle.
    pub job_id: String,
    /// One entry per registered vertex/edge type.
    pub tables: Vec<CatalogTable>,
}

/// A registered type within a dataset and its SQL shape.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogTable {
    /// Type / table name (e.g. `Person`, `knows_by_source`).
    pub name: String,
    /// Row count from the Parquet footers (cheap — no full scan).
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

impl Catalog {
    /// Every registered dataset with its types and columns — a PURE metadata
    /// query (`information_schema`, the catalog's own SQLite store), touching no
    /// remote Parquet and needing no credentials. Row counts are left `None`
    /// here: they are the job output's property (`RunStatus.count`), filled by
    /// [`fill_row_counts`] at the endpoint from the authoritative manifests,
    /// rather than re-counted over the (credentialed) remote Parquet.
    pub fn datasets(&self) -> Result<Vec<CatalogDataset>, CatalogError> {
        let conn = self.conn.lock().expect("catalog mutex poisoned");

        // (schema, table, column, type) for every catalog table, ordered so we
        // can group by schema→table in one pass.
        let mut stmt = conn.prepare(
            "SELECT table_schema, table_name, column_name, data_type
             FROM information_schema.columns
             WHERE table_catalog = 'lake' AND table_schema LIKE 'job\\_%' ESCAPE '\\'
             ORDER BY table_schema, table_name, ordinal_position",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;

        // Fold the flat (schema, table, column) rows into datasets→tables.
        let mut datasets: Vec<CatalogDataset> = Vec::new();
        for row in rows {
            let (schema, table, column, data_type) = row?;
            let job_id = schema.strip_prefix("job_").unwrap_or(&schema).to_string();

            let dataset = match datasets.last_mut() {
                Some(d) if d.job_id == job_id => d,
                _ => {
                    datasets.push(CatalogDataset { job_id, tables: Vec::new() });
                    datasets.last_mut().expect("just pushed")
                }
            };
            let tbl = match dataset.tables.last_mut() {
                Some(t) if t.name == table => t,
                _ => {
                    dataset.tables.push(CatalogTable { name: table.clone(), rows: None, columns: Vec::new() });
                    dataset.tables.last_mut().expect("just pushed")
                }
            };
            tbl.columns.push(CatalogColumn { name: column, data_type });
        }

        Ok(datasets)
    }
}

/// Fill in `rows` on each table from the jobs' output manifests — the
/// authoritative count source (`RunStatus.count`, recorded when the job
/// completed). Matches a dataset to its job by the `sanitize`d id, then a table
/// to a vertex by `sanitize(vertex_type)` or to an edge direction by
/// `sanitize(edge_type)_by_{source,target}`. Keeps `datasets()` a pure,
/// credential-free metadata read while still surfacing counts.
pub fn fill_row_counts(datasets: &mut [CatalogDataset], jobs: &[crate::jobs::models::Job]) {
    use crate::catalog::sanitize;

    for dataset in datasets {
        let Some(job) = jobs.iter().find(|j| sanitize(&j.id) == dataset.job_id) else {
            continue;
        };
        let Some(manifest) = &job.manifest else { continue };

        for table in &mut dataset.tables {
            table.rows = manifest
                .vertices
                .iter()
                .find(|v| sanitize(&v.vertex_type) == table.name)
                .and_then(|v| v.count)
                .or_else(|| {
                    manifest.edges.iter().find_map(|e| {
                        let name = sanitize(&format!("{}_{}_{}", e.src_type, e.edge_type, e.dst_type));
                        (table.name == name).then_some(e.count).flatten()
                    })
                });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::Catalog;
    use duckdb::Connection;
    use fossil_run_status::{ColumnStatus, RunStatus, VertexStatus};
    use std::collections::HashMap;

    #[test]
    fn datasets_lists_registered_types_with_columns_and_rows() {
        let dir = tempfile::tempdir().unwrap();
        let probe = Connection::open_in_memory().unwrap();
        let person = dir.path().join("Person.parquet");
        probe
            .execute_batch(&format!(
                "COPY (SELECT 1 AS id, 'a' AS name UNION ALL SELECT 2, 'b') TO '{}' (FORMAT parquet);",
                person.display(),
            ))
            .unwrap();

        let ds = RunStatus {
            version: 1,
            dest: dir.path().display().to_string(),
            vertices: vec![VertexStatus {
                vertex_type: "Person".into(),
                rdf_type: None,
                file: "Person.parquet".into(),
                count: Some(2),
                columns: vec![ColumnStatus {
                    name: "name".into(),
                    data_type: "string".into(),
                    rdf_uri: None,
                    xsd_datatype: None,
                }],
            }],
            edges: vec![],
        };

        let cat = Catalog::open(dir.path()).unwrap();
        assert!(cat.datasets().unwrap().is_empty(), "empty before any register");

        cat.register("j1", &ds, &HashMap::new()).unwrap();
        let got = cat.datasets().unwrap();

        assert_eq!(got.len(), 1, "one registered dataset");
        assert_eq!(got[0].job_id, "j1");
        assert_eq!(got[0].tables.len(), 1);
        let t = &got[0].tables[0];
        assert_eq!(t.name, "Person");
        assert_eq!(t.rows, None, "datasets() is pure-metadata — counts filled separately");
        let cols: Vec<&str> = t.columns.iter().map(|c| c.name.as_str()).collect();
        assert!(cols.contains(&"id") && cols.contains(&"name"), "columns surfaced: {cols:?}");
    }

    #[test]
    fn fill_row_counts_matches_jobs_to_datasets_by_sanitized_id() {
        use crate::jobs::models::{Job, JobStatus, RunMode};

        // A dataset as datasets() returns it: sanitized id, sanitized table name.
        let mut datasets = vec![CatalogDataset {
            job_id: "a_1".into(),
            tables: vec![
                CatalogTable { name: "Person".into(), rows: None, columns: vec![] },
                CatalogTable { name: "Orphan".into(), rows: None, columns: vec![] },
            ],
        }];

        let job = Job {
            id: "a-1".into(), // sanitizes to "a_1"
            status: JobStatus::Completed,
            name: None,
            created_at: "t".into(),
            started_at: None,
            completed_at: None,
            error: None,
            mode: RunMode::Integrated,
            connection_ids: vec![],
            created_by: String::new(),
            sink_connection_id: None,
            script: None,
            manifest: Some(RunStatus {
                version: 1,
                dest: "s3://b/x".into(),
                vertices: vec![VertexStatus {
                    vertex_type: "Person".into(),
                    rdf_type: None,
                    file: "Person.parquet".into(),
                    count: Some(42),
                    columns: vec![],
                }],
                edges: vec![],
            }),
            catalog_manifest: None,
        };

        fill_row_counts(&mut datasets, &[job]);
        assert_eq!(datasets[0].tables[0].rows, Some(42), "matched vertex count by sanitized id");
        assert_eq!(datasets[0].tables[1].rows, None, "no manifest entry → stays None");
    }
}
