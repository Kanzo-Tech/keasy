use crate::jobs::pipeline_types::PipelineOutput;
use crate::settings::org::OrgSettings;

use super::generator::media_type_from_extension;
use super::types::{DatasetInfo, DcatInput, DistributionInfo, FieldInfo};

/// Build the transient [`DcatInput`] from the job's persisted pipeline spec.
///
/// Host-boundary: keasy derives the DCAT catalog from what it authored
/// (`PipelineOutput`), not from fossil's IR. `rdf_type` rides the output spec;
/// the executed graph's row counts come separately from the subprocess
/// `RunStatus` (consumed by the materializer), and column statistics are the
/// browser's job (DuckDB-WASM).
pub fn extract_dcat_input(
    job_id: &str,
    job_name: Option<&str>,
    completed_at: &str,
    org: &OrgSettings,
    outputs: &[PipelineOutput],
) -> DcatInput {
    let datasets = outputs
        .iter()
        .map(|output| {
            let fields = output
                .fields
                .iter()
                .map(|field| FieldInfo {
                    name: field.name.clone(),
                    rdf_uri: field.uri.clone(),
                    datatype: field.xsd_datatype.clone(),
                })
                .collect();

            let distributions = output
                .destination
                .as_ref()
                .map(|dest| {
                    vec![DistributionInfo {
                        destination: dest.clone(),
                        media_type: media_type_from_extension(dest),
                    }]
                })
                .unwrap_or_default();

            DatasetInfo {
                type_name: output.type_name.clone(),
                source_name: output.source.clone(),
                rdf_type: output.rdf_type.clone(),
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
