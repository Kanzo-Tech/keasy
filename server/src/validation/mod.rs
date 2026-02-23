pub mod types;

use std::collections::HashSet;
use std::io::Cursor;

use iri_s::IriS;
use rudof_rdf::rdf_core::{NeighsRDF, Rdf, RDFFormat};
use rudof_rdf::rdf_impl::{InMemoryGraph, ReaderMode};
use shacl_ir::compiled::schema_ir::SchemaIR as CompiledSchema;
use shacl_rdf::ShaclParser;
use shacl_validation::shacl_processor::{GraphValidation, ShaclProcessor, ShaclValidationMode};
use shacl_validation::store::graph::Graph;
use shex_ast::compact::ShExParser;
use shex_ast::ir::schema_ir::SchemaIR;
use shex_ast::shapemap::{NodeSelector, QueryShapeMap, ShapeSelector};
use shex_validation::{Validator, ValidatorConfig};

use types::{ValidationError, ValidationResult};

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

    pub fn validate_shex(self, shape_content: &str) -> Result<ValidationResult, String> {
        let source_iri = IriS::new_unchecked("http://example.org/shapes");
        let ast = ShExParser::from_reader(Cursor::new(shape_content.as_bytes()), None, &source_iri)
            .map_err(|e| format!("Failed to parse ShEx: {e}"))?;

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

        let errors: Vec<ValidationError> = result_map
            .iter()
            .filter(|(_, _, status)| status.is_non_conformant())
            .map(|(node, _, status)| ValidationError {
                node: node.to_string(),
                message: status.reason(),
            })
            .collect();

        let valid_nodes: Vec<String> = result_map
            .iter()
            .filter(|(_, _, status)| status.is_conformant())
            .map(|(node, _, _)| node.to_string())
            .collect();

        Ok(ValidationResult {
            valid: errors.is_empty(),
            errors,
            valid_nodes,
        })
    }

    pub fn validate_shacl(self, shape_content: &str) -> Result<ValidationResult, String> {
        let shapes_graph = InMemoryGraph::from_reader(
            &mut Cursor::new(shape_content.as_bytes()),
            "shapes",
            &RDFFormat::Turtle,
            None,
            &ReaderMode::default(),
        )
        .map_err(|e| format!("Failed to load shapes: {e}"))?;

        let ast = ShaclParser::new(shapes_graph)
            .parse()
            .map_err(|e| format!("Failed to parse SHACL shapes: {e}"))?;

        let compiled = CompiledSchema::compile(&ast)
            .map_err(|e| format!("Failed to compile SHACL shapes: {e}"))?;

        // Collect all subject IRIs before consuming the graph
        let all_subjects: HashSet<String> = self
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

        let mut validator = GraphValidation::from_graph(
            Graph::from_graph(self.0).map_err(|e| format!("Failed to create graph: {e}"))?,
            ShaclValidationMode::Native,
        );

        let report = ShaclProcessor::validate(&mut validator, &compiled)
            .map_err(|e| format!("SHACL validation failed: {e}"))?;

        let results = report.results();
        let error_nodes: HashSet<String> = results
            .iter()
            .map(|r| format!("{}", r.focus_node()))
            .collect();

        let errors: Vec<ValidationError> = results
            .iter()
            .map(|r| ValidationError {
                node: format!("{}", r.focus_node()),
                message: r
                    .message()
                    .map(|m| m.to_string())
                    .unwrap_or_else(|| format!("{r}")),
            })
            .collect();

        let valid_nodes: Vec<String> = all_subjects
            .into_iter()
            .filter(|s| !error_nodes.contains(s))
            .collect();

        Ok(ValidationResult {
            valid: report.conforms(),
            errors,
            valid_nodes,
        })
    }
}
