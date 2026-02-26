use fossil_lang::context::DefKind;
use fossil_lang::passes::IrProgram;
use fossil_stdlib::rdf::metadata::RdfTypeAttrs;

use crate::jobs::pipeline_types::PipelineOutput;
use crate::settings::org::OrgSettings;

use super::dcat_generator::media_type_from_extension;
use super::dcat_types::{DatasetInfo, DcatInput, DistributionInfo, FieldInfo};

pub fn extract_dcat_input(
    program: &IrProgram,
    job_id: &str,
    job_name: Option<&str>,
    completed_at: &str,
    org: &OrgSettings,
    outputs: &[PipelineOutput],
) -> DcatInput {
    let interner = &program.gcx.interner;
    let mut datasets = Vec::new();

    for output in outputs {
        let type_name = &output.type_name;

        let type_sym = interner.lookup(type_name);
        let def = type_sym.and_then(|sym| {
            program
                .gcx
                .definitions
                .find_by_symbol(sym, |k| matches!(k, DefKind::Type))
        });

        let rdf_attrs = def.and_then(|d| RdfTypeAttrs::from_def_id(d.id(), &program.gcx));
        let rdf_subject = rdf_attrs.as_ref().and_then(|a| a.subject.clone());
        let rdf_type = rdf_attrs.as_ref().and_then(|a| a.rdf_type.clone());

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
        });
    }

    DcatInput {
        job_id: job_id.to_string(),
        job_name: job_name.map(|s| s.to_string()),
        completed_at: completed_at.to_string(),
        org: org.clone(),
        datasets,
    }
}
