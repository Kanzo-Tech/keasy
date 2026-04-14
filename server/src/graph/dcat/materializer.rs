//! DCAT-AP catalog materializer — pending DuckDB-based rewrite.

use crate::jobs::path_resolver::ResolvedPath;

use crate::graph::manifest::DataManifest;
use super::types::DcatInput;

/// Materialize DCAT-AP catalog as GraphAr parquets.
pub fn materialize_catalog(
    _input: &DcatInput,
    _data_manifest: &DataManifest,
    _dest: &ResolvedPath,
) -> Result<DataManifest, String> {
    Err("DCAT materialization not yet implemented with DuckDB".into())
}
