//! Extract DCAT input from pipeline outputs.
//!
//! TODO: RdfTypeAttrs lookup was removed with fossil_stdlib. Re-add once
//! type metadata is exposed through the new Salsa queries.

use crate::jobs::pipeline_types::PipelineOutput;
use crate::settings::org::OrgSettings;

use super::generator::media_type_from_extension;
use super::types::{DatasetInfo, DcatInput, DistributionInfo, FieldInfo};

pub fn extract_dcat_input(
    job_id: &str,
    job_name: Option<&str>,
    completed_at: &str,
    org: &OrgSettings,
    outputs: &[PipelineOutput],
) -> DcatInput {
    let mut datasets = Vec::new();

    for output in outputs {
        let type_name = &output.type_name;

        // TODO: RdfTypeAttrs lookup removed with fossil_stdlib.
        // Previously used RdfTypeAttrs::from_def_id to get rdf_subject/rdf_type.
        let rdf_subject: Option<String> = None;
        let rdf_type = output.rdf_type.clone();

        let field_infos: Vec<FieldInfo> = output
            .fields
            .iter()
            .map(|field| FieldInfo {
                name: field.name.clone(),
                rdf_uri: field.uri.clone(),
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

        datasets.push(DatasetInfo {
            type_name: type_name.clone(),
            source_name: output.source.clone(),
            rdf_subject,
            rdf_type,
            fields: field_infos,
            distributions,
            keywords: Vec::new(),
        });
    }

    DcatInput {
        job_id: job_id.to_string(),
        job_name: job_name.map(|s| s.to_string()),
        completed_at: completed_at.to_string(),
        org: org.clone(),
        datasets,
        language: None,
    }
}
