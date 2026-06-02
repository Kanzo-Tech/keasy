use fossil_run_status::RunStatus;

use crate::settings::org::OrgSettings;

use super::generator::media_type_from_extension;
use super::types::{DatasetInfo, DcatInput, DistributionInfo, FieldInfo};

/// Build the transient [`DcatInput`] from the subprocess run manifest.
///
/// Host-boundary: the output *spec* (per-type RDF type IRI, per-column predicate
/// IRI + XSD datatype) is fossil's knowledge, carried in the `RunStatus`
/// manifest — keasy reads it from there instead of re-compiling the program and
/// walking the IR. keasy supplies only host-owned governance values (the `org`
/// settings) and the storage location: each vertex type's Parquet under
/// `dest_url` is a DCAT distribution. Column statistics are the browser's job
/// (DuckDB-WASM), so they are absent here.
pub fn extract_dcat_input(
    job_id: &str,
    job_name: Option<&str>,
    completed_at: &str,
    org: &OrgSettings,
    manifest: &RunStatus,
    dest_url: &str,
) -> DcatInput {
    let base = dest_url.trim_end_matches('/');
    let datasets = manifest
        .vertices
        .iter()
        .map(|vertex| {
            let fields = vertex
                .columns
                .iter()
                .map(|col| FieldInfo {
                    name: col.name.clone(),
                    rdf_uri: col.rdf_uri.clone(),
                    datatype: col.xsd_datatype.clone(),
                })
                .collect();

            let destination = format!("{base}/{}", vertex.file);
            let distributions = vec![DistributionInfo {
                media_type: media_type_from_extension(&destination),
                destination,
            }];

            DatasetInfo {
                type_name: vertex.vertex_type.clone(),
                // The source binding is keasy's data-plane detail, not part of
                // the output spec the manifest carries — omitted (the optional
                // dct:source triple is simply not emitted).
                source_name: None,
                rdf_type: vertex.rdf_type.clone(),
                fields,
                distributions,
                keywords: Vec::new(),
            }
        })
        .collect();

    DcatInput {
        job_id: job_id.to_string(),
        job_name: job_name.map(str::to_string),
        completed_at: completed_at.to_string(),
        org: org.clone(),
        datasets,
        language: None,
    }
}
