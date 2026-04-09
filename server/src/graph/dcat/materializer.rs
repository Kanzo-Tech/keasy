//! DCAT-AP catalog materializer.
//!
//! TODO: Rewrite without polars/fossil_rdf. Will use DuckDB for
//! DataFrame construction and parquet writing.

use fossil_lang::traits::resolver::ResolvedPath;

use crate::graph::manifest::DataManifest;
use super::types::DcatInput;

/// Materialize DCAT-AP catalog as GraphAr parquets.
///
/// TODO: Reimplement with DuckDB-based materializer.
pub fn materialize_catalog(
    _input: &DcatInput,
    _data_manifest: &DataManifest,
    _dest: &ResolvedPath,
) -> Result<DataManifest, String> {
    // TODO: Reimplement catalog materialization without polars/fossil_rdf.
    // Previously built DataFrames for each DCAT-AP type and delegated
    // to fossil_rdf::materialize_frames for streaming parquet I/O.
    Err("DCAT catalog materialization not yet reimplemented".into())
}
