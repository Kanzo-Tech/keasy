//! Pipeline summary extraction from compiled Fossil programs.
//!
//! TODO: Rewrite to work with the new Salsa-based compilation pipeline.
//! Previously used ProgramQuery to walk the IR and extract inputs/outputs/operations.
//! The new path should extract this from FossilPlan or RelationalQuery.

use super::pipeline_types::*;

/// Extract a pipeline summary from a FossilPlan.
///
/// TODO: Reimplement. Previously walked the IrProgram AST to extract
/// inputs, operations (joins), and outputs with field mappings.
/// For now returns a minimal valid result.
pub fn extract_summary_from_plan(
    plan: &fossil_lang::plan::FossilPlan,
) -> ValidationResult {
    // TODO: Extract inputs/outputs/operations from the plan's RQ or SQL.
    let outputs: Vec<PipelineOutput> = plan.outputs.iter().flat_map(|o| {
        o.projections.iter().map(move |proj| {
            PipelineOutput {
                type_name: proj.type_name.clone(),
                fields: proj.fields.iter().map(|f| Field {
                    name: f.field_name.clone(),
                    field_type: f.data_type.clone(),
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

/// Legacy entry point — kept for API compatibility.
/// TODO: Remove once all callers migrate to extract_summary_from_plan.
pub fn extract_summary(_program: &fossil_lang::passes::IrProgram) -> ValidationResult {
    // IrProgram is still available from fossil_lang but ProgramQuery helpers
    // that walked it relied on fossil_stdlib types (RdfTypeAttrs, FunctionEffect).
    // Return empty until reimplemented.
    ValidationResult {
        valid: true,
        pipeline: PipelineSummary::default(),
        errors: vec![],
    }
}
