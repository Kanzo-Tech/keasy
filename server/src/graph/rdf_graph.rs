use std::collections::BTreeMap;
use std::fmt::Write as FmtWrite;
use std::io::Cursor;

use oxigraph::model::{GraphNameRef, NamedNodeRef, QuadRef};
use oxigraph::sparql::QueryResults;
use oxigraph::store::Store;
use oxrdf::Triple;
use rudof_lib::{
    RDFFormat, ReaderMode, Rudof, RudofConfig, ShaclFormat, ShaclValidationMode, ShExFormat,
    ShapesGraphSource,
    shapemap::{NodeSelector, ShapeSelector},
};
use serde::Serialize;

use oxrdfio::RdfSerializer;

use super::convert::{self, GraphData};
use crate::rdf::format::RdfExportFormat;
use crate::validation::types::{ShapeFormat, ValidationError, ValidationResult};

#[derive(Debug, Clone, Serialize)]
pub struct TabularData {
    pub columns: Vec<String>,
    pub rows: Vec<BTreeMap<String, serde_json::Value>>,
    pub column_types: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub label: String,
    pub group: String,
}

pub struct RdfGraph {
    store: Store,
}

impl RdfGraph {
    pub fn new() -> Self {
        Self {
            store: Store::new().expect("Failed to create in-memory oxigraph store"),
        }
    }

    /// Insert triples into a named graph (or default graph if None).
    pub fn insert_triples(&self, graph_name: Option<&str>, triples: &[Triple]) {
        let graph = graph_name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)));
        for triple in triples {
            let quad = QuadRef::new(
                triple.subject.as_ref(),
                triple.predicate.as_ref(),
                triple.object.as_ref(),
                graph.unwrap_or(GraphNameRef::DefaultGraph),
            );
            let _ = self.store.insert(quad);
        }
    }

    /// Clear everything.
    pub fn clear(&self) {
        let _ = self.store.clear();
    }

    /// Clear all quads in a specific named graph.
    pub fn clear_named_graph(&self, graph_name: &str) {
        let graph = GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(graph_name));
        let quads: Vec<_> = self
            .store
            .quads_for_pattern(None, None, None, Some(graph))
            .filter_map(|q| q.ok())
            .collect();
        for quad in quads {
            let _ = self.store.remove(QuadRef::new(
                quad.subject.as_ref(),
                quad.predicate.as_ref(),
                quad.object.as_ref(),
                graph,
            ));
        }
    }

    /// Count triples (optionally in a named graph).
    pub fn triple_count(&self, graph_name: Option<&str>) -> usize {
        let graph = graph_name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)));
        self.store
            .quads_for_pattern(None, None, None, graph)
            .count()
    }

    /// Get full graph visualization (optionally from a named graph).
    pub fn get_graph(&self, graph_name: Option<&str>) -> GraphData {
        let graph = graph_name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)));
        let quads: Vec<_> = self
            .store
            .quads_for_pattern(None, None, None, graph)
            .filter_map(|q| q.ok())
            .collect();
        convert::quads_to_graph_data(&quads)
    }

    /// Search nodes by label substring (case-insensitive SPARQL).
    #[allow(deprecated)]
    pub fn search_nodes(&self, query: &str, limit: usize) -> Vec<SearchResult> {
        let filter_clause = if query.trim().is_empty() {
            String::new()
        } else {
            let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
            format!(
                r#"FILTER(
                CONTAINS(LCASE(STR(?s)), LCASE("{escaped}"))
                || CONTAINS(LCASE(COALESCE(STR(?titleVal), "")), LCASE("{escaped}"))
                || CONTAINS(LCASE(COALESCE(STR(?nameVal), "")), LCASE("{escaped}"))
              )"#
            )
        };

        let sparql = format!(
            r#"
            PREFIX dct: <http://purl.org/dc/terms/>
            PREFIX foaf: <http://xmlns.com/foaf/0.1/>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            SELECT DISTINCT ?s (SAMPLE(?lbl) AS ?label) (SAMPLE(?t) AS ?type) WHERE {{
              ?s ?p ?o .
              OPTIONAL {{ ?s dct:title ?titleVal }}
              OPTIONAL {{ ?s foaf:name ?nameVal }}
              BIND(COALESCE(?titleVal, ?nameVal) AS ?lbl)
              OPTIONAL {{ ?s rdf:type ?t }}
              {filter_clause}
            }}
            GROUP BY ?s
            LIMIT {limit}
            "#
        );

        let mut results = Vec::new();
        if let Ok(QueryResults::Solutions(solutions)) = self.store.query(&sparql) {
            for solution in solutions.flatten() {
                let id = match solution.get("s") {
                    Some(oxrdf::Term::NamedNode(n)) => n.as_str().to_string(),
                    _ => continue,
                };
                let label = match solution.get("label") {
                    Some(oxrdf::Term::Literal(l)) => l.value().to_string(),
                    _ => convert::shorten_iri(&id),
                };
                let group = match solution.get("type") {
                    Some(oxrdf::Term::NamedNode(n)) => convert::shorten_iri(n.as_str()),
                    _ => "resource".to_string(),
                };
                results.push(SearchResult { id, label, group });
            }
        }
        results
    }

    /// Expand neighborhood: get direct connections of a node.
    #[allow(deprecated)]
    pub fn expand_node(&self, node_iri: &str) -> GraphData {
        let escaped = node_iri.replace('\\', "\\\\").replace('"', "\\\"");

        let sparql = format!(
            r#"
            SELECT ?s ?p ?o WHERE {{
              {{ BIND(<{escaped}> AS ?s) ?s ?p ?o }}
              UNION
              {{ ?s ?p <{escaped}> . BIND(<{escaped}> AS ?o) }}
            }}
            "#
        );

        let mut quads = Vec::new();
        if let Ok(QueryResults::Solutions(solutions)) = self.store.query(&sparql) {
            for solution in solutions.flatten() {
                let s = match solution.get("s") {
                    #[allow(deprecated)]
                    Some(oxrdf::Term::NamedNode(n)) => oxrdf::Subject::NamedNode(n.clone()),
                    _ => continue,
                };
                let p = match solution.get("p") {
                    Some(oxrdf::Term::NamedNode(n)) => n.clone(),
                    _ => continue,
                };
                let o = match solution.get("o") {
                    Some(t) => t.clone(),
                    None => continue,
                };
                quads.push(oxigraph::model::Quad::new(
                    s,
                    p,
                    o,
                    oxrdf::GraphName::DefaultGraph,
                ));
            }
        }
        convert::quads_to_graph_data(&quads)
    }

    /// Execute a SPARQL SELECT and return TabularData.
    pub fn sparql_select(&self, sparql: &str) -> Result<TabularData, String> {
        match self.store.query(sparql) {
            Ok(QueryResults::Solutions(solutions)) => {
                let vars: Vec<String> = solutions
                    .variables()
                    .iter()
                    .map(|v| v.as_str().to_string())
                    .collect();

                let mut rows: Vec<BTreeMap<String, serde_json::Value>> = Vec::new();
                let mut column_types: BTreeMap<String, String> = BTreeMap::new();
                for v in &vars {
                    column_types.insert(v.clone(), "numeric".to_string());
                }

                for solution in solutions.flatten() {
                    let mut row = BTreeMap::new();
                    for var in &vars {
                        if let Some(term) = solution.get(var.as_str()) {
                            match term {
                                oxrdf::Term::Literal(lit) => {
                                    let dt = lit.datatype().as_str();
                                    if dt.ends_with("integer")
                                        || dt.ends_with("int")
                                        || dt.ends_with("decimal")
                                        || dt.ends_with("float")
                                        || dt.ends_with("double")
                                    {
                                        if let Ok(n) = lit.value().parse::<f64>() {
                                            if let Some(num) = serde_json::Number::from_f64(n) {
                                                row.insert(
                                                    var.clone(),
                                                    serde_json::Value::Number(num),
                                                );
                                                continue;
                                            }
                                        }
                                    }
                                    column_types.insert(var.clone(), "string".to_string());
                                    row.insert(
                                        var.clone(),
                                        serde_json::Value::String(lit.value().to_string()),
                                    );
                                }
                                oxrdf::Term::NamedNode(n) => {
                                    column_types.insert(var.clone(), "string".to_string());
                                    row.insert(
                                        var.clone(),
                                        serde_json::Value::String(n.as_str().to_string()),
                                    );
                                }
                                _ => {
                                    column_types.insert(var.clone(), "string".to_string());
                                    row.insert(
                                        var.clone(),
                                        serde_json::Value::String(term.to_string()),
                                    );
                                }
                            }
                        }
                    }
                    rows.push(row);
                }

                Ok(TabularData {
                    columns: vars,
                    rows,
                    column_types,
                })
            }
            Ok(_) => Err("Expected SELECT query".into()),
            Err(e) => Err(format!("SPARQL error: {e}")),
        }
    }

    /// Validate data in this graph against shapes using the specified format.
    pub fn validate(
        &self,
        shape_content: &str,
        shape_map: Option<&str>,
        shape_format: ShapeFormat,
    ) -> Result<ValidationResult, String> {
        self.validate_graph(shape_content, shape_map, None, shape_format)
    }

    /// Validate data in a specific graph (or all graphs) against shapes.
    pub fn validate_graph(
        &self,
        shape_content: &str,
        shape_map: Option<&str>,
        graph_name: Option<&str>,
        shape_format: ShapeFormat,
    ) -> Result<ValidationResult, String> {
        let data_ntriples = self.serialize_to_ntriples(graph_name);

        let config =
            RudofConfig::new().map_err(|e| format!("Failed to create rudof config: {e}"))?;
        let mut rudof =
            Rudof::new(&config).map_err(|e| format!("Failed to create rudof: {e}"))?;

        // Load RDF data as N-Triples
        let mut data_reader = Cursor::new(data_ntriples.as_bytes());
        rudof
            .read_data(
                &mut data_reader,
                "data",
                &RDFFormat::NTriples,
                None,
                &ReaderMode::default(),
                false,
            )
            .map_err(|e| format!("Failed to load RDF data: {e}"))?;

        match shape_format {
            ShapeFormat::ShEx => {
                let shape_reader = Cursor::new(shape_content.as_bytes());
                rudof
                    .read_shex(
                        shape_reader,
                        &ShExFormat::ShExC,
                        None,
                        &ReaderMode::default(),
                        Some("shapes"),
                    )
                    .map_err(|e| format!("Failed to parse ShEx shapes: {e}"))?;
                self.validate_shex(&mut rudof, shape_map)
            }
            ShapeFormat::Shacl => self.validate_shacl(&mut rudof, shape_content),
        }
    }

    fn validate_shex(
        &self,
        rudof: &mut Rudof,
        shape_map: Option<&str>,
    ) -> Result<ValidationResult, String> {
        if let Some(sm) = shape_map {
            let sm_reader = Cursor::new(sm.as_bytes());
            rudof
                .read_shapemap(
                    sm_reader,
                    "shapemap",
                    &rudof_lib::ShapeMapFormat::Compact,
                )
                .map_err(|e| format!("Failed to parse shapemap: {e}"))?;
        } else {
            let has_start = rudof.get_shex().and_then(|s| s.start()).is_some();

            if has_start {
                let node = NodeSelector::sparql("SELECT ?focus WHERE { ?focus ?p ?o }");
                let shape = ShapeSelector::start();
                rudof.shapemap_add_node_shape_selectors(node, shape);
            } else {
                return Err(
                    "ShEx schema has no 'start' declaration. Please provide a ShapeMap.".into(),
                );
            }
        }

        let result_map = rudof
            .validate_shex()
            .map_err(|e| format!("ShEx validation failed: {e}"))?;

        // Use typed API instead of parsing Debug strings
        let mut conformant = 0usize;
        let mut non_conformant = 0usize;
        let mut errors = Vec::new();

        for (node, _shape_label, status) in result_map.iter() {
            if status.is_conformant() {
                conformant += 1;
            } else if status.is_non_conformant() {
                non_conformant += 1;
                errors.push(ValidationError {
                    node: node.to_string(),
                    message: status.reason(),
                });
            }
        }

        Ok(ValidationResult {
            valid: non_conformant == 0,
            conformant,
            non_conformant,
            errors,
        })
    }

    fn validate_shacl(
        &self,
        rudof: &mut Rudof,
        shape_content: &str,
    ) -> Result<ValidationResult, String> {
        let mut shape_reader = Cursor::new(shape_content.as_bytes());
        rudof
            .read_shacl(
                &mut shape_reader,
                "shapes",
                &ShaclFormat::Turtle,
                None,
                &ReaderMode::default(),
            )
            .map_err(|e| format!("Failed to parse SHACL shapes: {e}"))?;

        let report = rudof
            .validate_shacl(
                &ShaclValidationMode::Native,
                &ShapesGraphSource::CurrentSchema,
            )
            .map_err(|e| format!("SHACL validation failed: {e}"))?;

        let valid = report.conforms();
        let results = report.results();
        let non_conformant = results.len();
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

        Ok(ValidationResult {
            valid,
            conformant: 0,
            non_conformant,
            errors,
        })
    }

    pub fn serialize_to_format(&self, format: RdfExportFormat) -> Result<String, String> {
        let mut buf = Vec::new();
        let mut serializer = RdfSerializer::from_format(format.to_rdf_format())
            .for_writer(&mut buf);

        for quad in self.store.quads_for_pattern(None, None, None, None).flatten() {
            let triple = Triple::new(quad.subject, quad.predicate, quad.object);
            serializer
                .serialize_triple(&triple)
                .map_err(|e| format!("serialization error: {e}"))?;
        }

        serializer.finish().map_err(|e| format!("finalize error: {e}"))?;
        String::from_utf8(buf).map_err(|e| format!("encoding error: {e}"))
    }

    fn serialize_to_ntriples(&self, graph_name: Option<&str>) -> String {
        let graph = graph_name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)));
        let mut output = String::new();
        for quad in self
            .store
            .quads_for_pattern(None, None, None, graph)
            .flatten()
        {
            let _ = writeln!(output, "{} {} {} .", quad.subject, quad.predicate, quad.object);
        }
        output
    }
}

