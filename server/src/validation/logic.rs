use std::collections::HashSet;
use std::io::Cursor;

use iri_s::IriS;
use rudof_rdf::rdf_core::{NeighsRDF, Rdf, RDFFormat};
use rudof_rdf::rdf_impl::{InMemoryGraph, ReaderMode};
use shex_ast::ShExFormat;
use shex_ast::ast::Schema;
use shex_ast::compact::ShExParser;
use shex_ast::ir::schema_ir::SchemaIR;
use shex_ast::shapemap::{NodeSelector, QueryShapeMap, ShapeSelector};
use shex_validation::{Validator, ValidatorConfig};

use super::types::{ShapeValidationError, ShapeValidationResult};

pub struct ValidatableGraph(InMemoryGraph);

impl ValidatableGraph {
    pub fn from_bytes(bytes: &[u8], format: &RDFFormat) -> Result<Self, String> {
        let graph = InMemoryGraph::from_reader(
            &mut Cursor::new(bytes),
            "data",
            format,
            None,
            &ReaderMode::default(),
        )
        .map_err(|e| format!("Failed to load RDF: {e}"))?;
        Ok(Self(graph))
    }

    pub fn validate_shex(self, shape_content: &str, format: &ShExFormat) -> Result<ShapeValidationResult, String> {
        let ast = match format {
            ShExFormat::ShExC => {
                let source_iri = IriS::new_unchecked("http://example.org/shapes");
                ShExParser::from_reader(Cursor::new(shape_content.as_bytes()), None, &source_iri)
                    .map_err(|e| format!("Failed to parse ShEx: {e}"))
            }
            ShExFormat::ShExJ => {
                Schema::from_reader(shape_content.as_bytes())
                    .map_err(|e| format!("Failed to parse ShExJ: {e}"))
            }
            ShExFormat::RDFFormat(_) => {
                Err("RDF-based ShEx formats are not supported".to_string())
            }
        }?;

        // NOTE: rudof bug — StartDecl doesn't call .deref(), so BASE-relative shape
        // labels in `start = @<Foo>` are not resolved. Use PREFIX : instead of BASE.
        let base = ast.base();
        let mut ir = SchemaIR::new();
        ir.populate_from_schema_json(&ast, &Default::default(), &base)
            .map_err(|e| format!("Failed to compile ShEx schema: {e}"))?;

        let validator = Validator::new(ir.clone(), &ValidatorConfig::default())
            .map_err(|e| format!("Failed to create ShEx validator: {e}"))?;

        if ast.start().is_none() {
            return Err("ShEx schema has no 'start' declaration".into());
        }

        let subjects: HashSet<String> = self
            .0
            .triples()
            .map_err(|e| format!("Failed to read graph: {e}"))?
            .filter_map(|t| {
                let term = InMemoryGraph::subject_as_term(&t.subject);
                InMemoryGraph::term_as_iris(&term)
                    .ok()
                    .map(|iri| iri.to_string())
            })
            .collect();

        let mut shapemap = QueryShapeMap::new();
        for iri in &subjects {
            shapemap.add_association(
                NodeSelector::iri_unchecked(iri),
                ShapeSelector::start(),
            );
        }

        let result_map = validator
            .validate_shapemap2(&shapemap, &self.0, &ir, &None)
            .map_err(|e| format!("ShEx validation failed: {e}"))?;

        let errors: Vec<ShapeValidationError> = result_map
            .iter()
            .filter(|(_, _, status)| status.is_non_conformant())
            .map(|(node, _, status)| ShapeValidationError {
                node: node.to_string(),
                message: status.reason(),
            })
            .collect();

        let valid_nodes: Vec<String> = result_map
            .iter()
            .filter(|(_, _, status)| status.is_conformant())
            .map(|(node, _, _)| node.to_string())
            .collect();

        Ok(ShapeValidationResult {
            valid: errors.is_empty(),
            errors,
            valid_nodes,
        })
    }
}
