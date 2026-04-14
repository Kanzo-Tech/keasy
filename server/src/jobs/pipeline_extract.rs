//! Pipeline summary extraction from compiled Fossil programs.

use super::pipeline_types::*;

/// Extract a pipeline summary from a FossilPlan.
///
/// Extracts outputs with field mappings from the plan's projections.
/// Inputs and operations require Salsa-based IR walking (Phase 4).
pub fn extract_summary_from_plan(
    plan: &fossil_lang::plan::FossilPlan,
) -> ValidationResult {
    let outputs: Vec<PipelineOutput> = plan.outputs.iter().flat_map(|o| {
        o.projections.iter().map(move |proj| {
            PipelineOutput {
                type_name: proj.type_name.clone(),
                fields: proj.fields.iter().map(|f| Field {
                    name: f.field_name.clone(),
                    // Type comes from the DuckDB result set at runtime;
                    // fossil-lang does not carry it in the compiled plan.
                    field_type: String::new(),
                    uri: None,
                    xsd_datatype: None,
                    optional: false,
                }).collect(),
                mappings: proj.fields.iter().map(|f| FieldMapping {
                    target: f.field_name.clone(),
                    source: f.sql_expr.clone(),
                }).collect(),
                source: None,
                destination: if o.path.is_empty() { None } else { Some(o.path.clone()) },
                rdf_type: None,
            }
        })
    }).collect();

    ValidationResult {
        valid: true,
        pipeline: PipelineSummary {
            inputs: vec![],
            operations: vec![],
            outputs,
        },
        errors: vec![],
    }
}