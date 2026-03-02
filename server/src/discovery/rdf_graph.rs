use std::collections::BTreeMap;

use oxigraph::model::{GraphNameRef, NamedNodeRef, QuadRef};
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;
use oxrdf::{GraphName, NamedNode, Quad, Triple};

use oxrdfio::{RdfFormat, RdfParser, RdfSerializer};

use super::convert::{self, GraphData};
use super::graph_types::{KeasyTriple, SearchResult, TabularData, TermValue};
use super::rdf_format::RdfExportFormat;

pub struct RdfGraph {
    store: Store,
}

impl Default for RdfGraph {
    fn default() -> Self {
        Self {
            store: Store::new().expect("Failed to create in-memory oxigraph store"),
        }
    }
}

impl RdfGraph {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        Store::open(path)
            .map(|store| Self { store })
            .map_err(|e| e.to_string())
    }
}

fn to_oxrdf_triple(kt: &KeasyTriple) -> Triple {
    let subject = match &kt.subject {
        TermValue::Iri(iri) => oxrdf::NamedOrBlankNode::NamedNode(NamedNode::new_unchecked(iri)),
        TermValue::BlankNode(id) => {
            oxrdf::NamedOrBlankNode::BlankNode(oxrdf::BlankNode::new_unchecked(id))
        }
        TermValue::Literal { .. } => unreachable!("subject cannot be a literal"),
    };

    let predicate = NamedNode::new_unchecked(&kt.predicate);

    let object = match &kt.object {
        TermValue::Iri(iri) => oxrdf::Term::NamedNode(NamedNode::new_unchecked(iri)),
        TermValue::BlankNode(id) => {
            oxrdf::Term::BlankNode(oxrdf::BlankNode::new_unchecked(id))
        }
        TermValue::Literal {
            value,
            datatype,
            language,
        } => {
            if let Some(lang) = language {
                oxrdf::Term::Literal(oxrdf::Literal::new_language_tagged_literal_unchecked(
                    value, lang,
                ))
            } else if let Some(dt) = datatype {
                oxrdf::Term::Literal(oxrdf::Literal::new_typed_literal(
                    value,
                    NamedNode::new_unchecked(dt),
                ))
            } else {
                oxrdf::Term::Literal(oxrdf::Literal::new_simple_literal(value))
            }
        }
    };

    Triple::new(subject, predicate, object)
}

impl RdfGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn bulk_load_bytes(&self, graph_name: Option<&str>, bytes: &[u8], url: &str) -> Result<(), String> {
        let format = url
            .rsplit('.')
            .next()
            .and_then(RdfFormat::from_extension)
            .unwrap_or(RdfFormat::Turtle);
        let gn: GraphName = graph_name
            .map(|n| GraphName::NamedNode(NamedNode::new_unchecked(n)))
            .unwrap_or(GraphName::DefaultGraph);
        let quads: Result<Vec<Quad>, String> = RdfParser::from_format(format)
            .for_slice(bytes)
            .map(|r| r.map(|t| Quad::new(t.subject, t.predicate, t.object, gn.clone()))
                       .map_err(|e| e.to_string()))
            .collect();
        self.store
            .extend(quads?)
            .map_err(|e| e.to_string())
    }

    pub(crate) fn insert_oxrdf_triples(&self, graph_name: Option<&str>, triples: &[Triple]) {
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

    fn evaluate_query(&self, sparql: &str) -> Result<QueryResults<'_>, String> {
        SparqlEvaluator::new()
            .parse_query(sparql)
            .map_err(|e| format!("SPARQL parse error: {e}"))?
            .on_store(&self.store)
            .execute()
            .map_err(|e| format!("SPARQL evaluation error: {e}"))
    }
}

impl RdfGraph {
    pub fn insert_triples(&self, graph_name: Option<&str>, triples: &[KeasyTriple]) {
        let oxrdf_triples: Vec<Triple> = triples.iter().map(to_oxrdf_triple).collect();
        self.insert_oxrdf_triples(graph_name, &oxrdf_triples);
    }

    pub fn clear(&self) {
        let _ = self.store.clear();
    }

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

    pub fn triple_count(&self, graph_name: Option<&str>) -> usize {
        let graph = graph_name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)));
        self.store
            .quads_for_pattern(None, None, None, graph)
            .count()
    }

    pub fn subject_count(&self) -> usize {
        let sparql = "SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE { ?s ?p ?o }";
        if let Ok(QueryResults::Solutions(solutions)) = self.evaluate_query(sparql) {
            for solution in solutions.flatten() {
                if let Some(oxrdf::Term::Literal(lit)) = solution.get("count")
                    && let Ok(n) = lit.value().parse::<usize>() {
                        return n;
                    }
            }
        }
        0
    }

    pub fn get_graph(&self, graph_name: Option<&str>) -> GraphData {
        let graph = graph_name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)));
        let triples: Vec<_> = self
            .store
            .quads_for_pattern(None, None, None, graph)
            .filter_map(|q| q.ok())
            .map(|q| Triple::new(q.subject, q.predicate, q.object))
            .collect();
        convert::triples_to_graph_data(&triples)
    }

    pub fn get_merged_graphs(&self, graph_names: &[String]) -> GraphData {
        let mut all_triples = Vec::new();
        for name in graph_names {
            let graph = GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(name));
            let triples = self
                .store
                .quads_for_pattern(None, None, None, Some(graph))
                .filter_map(|q| q.ok())
                .map(|q| Triple::new(q.subject, q.predicate, q.object));
            all_triples.extend(triples);
        }
        convert::triples_to_graph_data(&all_triples)
    }

    pub fn search_nodes(&self, graph_name: Option<&str>, query: &str, limit: usize) -> Vec<SearchResult> {
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

        let graph_clause = match graph_name {
            Some(g) => format!("GRAPH <{g}>"),
            None => "GRAPH ?g".to_string(),
        };

        let sparql = format!(
            r#"
            PREFIX dct: <http://purl.org/dc/terms/>
            PREFIX foaf: <http://xmlns.com/foaf/0.1/>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            SELECT DISTINCT ?s (SAMPLE(?lbl) AS ?label) (SAMPLE(?t) AS ?type) WHERE {{
              {graph_clause} {{
                ?s ?p ?o .
                OPTIONAL {{ ?s dct:title ?titleVal }}
                OPTIONAL {{ ?s foaf:name ?nameVal }}
                BIND(COALESCE(?titleVal, ?nameVal) AS ?lbl)
                OPTIONAL {{ ?s rdf:type ?t }}
                {filter_clause}
              }}
            }}
            GROUP BY ?s
            LIMIT {limit}
            "#
        );

        let mut results = Vec::new();
        if let Ok(QueryResults::Solutions(solutions)) = self.evaluate_query(&sparql) {
            for solution in solutions.flatten() {
                let id = match solution.get("s") {
                    Some(oxrdf::Term::NamedNode(n)) => n.as_str().to_string(),
                    _ => continue,
                };
                let group = match solution.get("type") {
                    Some(oxrdf::Term::NamedNode(n)) => convert::shorten_iri(n.as_str()),
                    _ => "resource".to_string(),
                };
                let label = match solution.get("label") {
                    Some(oxrdf::Term::Literal(l)) => l.value().to_string(),
                    _ => convert::shorten_iri(&id),
                };
                results.push(SearchResult { id, label, group });
            }
        }
        results
    }

    pub fn expand_node(&self, graph_name: Option<&str>, node_iri: &str) -> GraphData {
        let escaped = node_iri.replace('\\', "\\\\").replace('"', "\\\"");

        let graph_clause = match graph_name {
            Some(g) => format!("GRAPH <{g}>"),
            None => "GRAPH ?g".to_string(),
        };

        let sparql = format!(
            "CONSTRUCT {{ ?s ?p ?o }} WHERE {{ \
               {graph_clause} {{ \
                 {{ BIND(<{escaped}> AS ?s) ?s ?p ?o }} \
                 UNION \
                 {{ BIND(<{escaped}> AS ?o) ?s ?p ?o }} \
               }} \
             }} LIMIT 500"
        );

        let mut triples = Vec::new();
        if let Ok(QueryResults::Graph(iter)) = self.evaluate_query(&sparql) {
            triples.extend(iter.flatten());
        }
        convert::triples_to_graph_data(&triples)
    }

    pub fn graph_exists(&self, graph_name: &str) -> bool {
        self.triple_count(Some(graph_name)) > 0
    }

    pub fn sparql_select(&self, sparql: &str, graph_name: Option<&str>) -> Result<TabularData, String> {
        let query = match graph_name {
            Some(g) => sparql.replacen("WHERE", &format!("FROM <{g}> WHERE"), 1),
            None => sparql.to_string(),
        };
        match self.evaluate_query(&query) {
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
                                    if (dt.ends_with("integer")
                                        || dt.ends_with("int")
                                        || dt.ends_with("decimal")
                                        || dt.ends_with("float")
                                        || dt.ends_with("double"))
                                        && let Ok(n) = lit.value().parse::<f64>()
                                        && let Some(num) = serde_json::Number::from_f64(n)
                                    {
                                        row.insert(
                                            var.clone(),
                                            serde_json::Value::Number(num),
                                        );
                                        continue;
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

    pub fn serialize_to_format(&self, format: RdfExportFormat) -> Result<String, String> {
        self.serialize_graph(None, format)
    }

    pub fn serialize_graph(&self, graph_name: Option<&str>, format: RdfExportFormat) -> Result<String, String> {
        let graph = graph_name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)));

        const PREFIXES: &[(&str, &str)] = &[
            ("dcat", "http://www.w3.org/ns/dcat#"),
            ("dct", "http://purl.org/dc/terms/"),
            ("foaf", "http://xmlns.com/foaf/0.1/"),
            ("vcard", "http://www.w3.org/2006/vcard/ns#"),
            ("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
            ("xsd", "http://www.w3.org/2001/XMLSchema#"),
        ];

        let mut buf = Vec::new();
        let mut ser = RdfSerializer::from_format(format.to_rdf_format());
        for &(name, iri) in PREFIXES {
            ser = ser.with_prefix(name, iri).map_err(|e| format!("prefix error: {e}"))?;
        }
        let mut serializer = ser.for_writer(&mut buf);

        for quad in self.store.quads_for_pattern(None, None, None, graph).flatten() {
            let triple = Triple::new(quad.subject, quad.predicate, quad.object);
            serializer
                .serialize_triple(&triple)
                .map_err(|e| format!("serialization error: {e}"))?;
        }

        serializer.finish().map_err(|e| format!("finalize error: {e}"))?;
        let raw = String::from_utf8(buf).map_err(|e| format!("encoding error: {e}"))?;

        match format {
            RdfExportFormat::Turtle => Ok(raw.replace(".\n<", ".\n\n<")),
            RdfExportFormat::JsonLd => {
                let value: serde_json::Value =
                    serde_json::from_str(&raw).map_err(|e| format!("JSON parse error: {e}"))?;
                serde_json::to_string_pretty(&value)
                    .map_err(|e| format!("JSON format error: {e}"))
            }
            _ => Ok(raw),
        }
    }
}
