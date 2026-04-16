//! DCAT-AP catalog materializer — pending DuckDB-based rewrite.

use crate::graph::manifest::DataManifest;
use super::types::DcatInput;

/// Materialize DCAT-AP catalog as GraphAr parquets.
///
/// `dest` is a base URL like `s3://bucket/prefix/<org>/<job>` produced by
/// the runner from the promotor catalog connector. Once implemented the
/// writer will use DuckDB `COPY ... TO '<dest>/...'` with the SECRET
/// already installed for that connector.
pub fn materialize_catalog(
    _input: &DcatInput,
    _data_manifest: &DataManifest,
    _dest: &str,
) -> Result<DataManifest, String> {
    Err("DCAT materialization not yet implemented with DuckDB".into())
}
