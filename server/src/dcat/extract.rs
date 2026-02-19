use fossil_lang::context::DefKind;
use fossil_lang::passes::IrProgram;
use fossil_stdlib::rdf::metadata::RdfMetadata;

use crate::routes::scripts::OutputInfo;
use crate::settings::org::OrgSettings;

use super::generator::media_type_from_extension;
use super::types::{DatasetInfo, DcatInput, DistributionInfo, FieldInfo};

/// Extract DCAT input from a compiled program and job metadata.
///
/// Must be called BEFORE `execute()` since execution consumes the program.
pub fn extract_dcat_input(
    program: &IrProgram,
    job_id: &str,
    job_name: Option<&str>,
    completed_at: &str,
    org: &OrgSettings,
    outputs: &[OutputInfo],
) -> DcatInput {
    let interner = &program.gcx.interner;
    let mut datasets = Vec::new();

    for output in outputs {
        let type_name = &output.type_name;

        // Resolve the type's DefId via the definitions index
        let type_sym = interner.lookup(type_name);
        let def = type_sym.and_then(|sym| {
            program
                .gcx
                .definitions
                .find_by_symbol(sym, |k| matches!(k, DefKind::Type))
        });

        let rdf_meta = def
            .and_then(|d| program.gcx.type_metadata.get(&d.id()))
            .and_then(|type_meta| RdfMetadata::from_type_metadata(type_meta, interner));

        let rdf_base = rdf_meta.as_ref().and_then(|m| m.base.clone());
        let rdf_type = rdf_meta.as_ref().and_then(|m| m.rdf_type.clone());

        let mut field_infos: Vec<FieldInfo> = if let Some(ref meta) = rdf_meta {
            output.fields.iter().map(|field_name| {
                let rdf_uri = interner.lookup(field_name)
                    .and_then(|sym| meta.fields.get(&sym).map(|f| f.uri.clone()));
                FieldInfo { name: field_name.clone(), rdf_uri }
            }).collect()
        } else {
            Vec::new()
        };

        // If we didn't get field infos from RDF metadata, build basic ones
        if field_infos.is_empty() {
            field_infos = output
                .fields
                .iter()
                .map(|name| FieldInfo {
                    name: name.clone(),
                    rdf_uri: None,
                })
                .collect();
        }

        // Build distributions from destination
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
            rdf_base,
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
