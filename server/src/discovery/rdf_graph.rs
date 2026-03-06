use std::collections::BTreeMap;
use std::num::NonZeroUsize;
use std::sync::Mutex;

use lru::LruCache;
use oxigraph::model::{GraphNameRef, NamedNodeRef, QuadRef};
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;
use oxrdf::{GraphName, NamedNode, Quad, Triple};

use oxrdfio::{RdfFormat, RdfParser, RdfSerializer};

use super::convert::{self, GraphData};
use super::graph_types::{SearchResult, TabularData};
use super::rdf_format::RdfExportFormat;
use super::vocab;
use crate::ai::profiler::GraphProfile;

const MAX_EXPAND_TRIPLES: usize = 500;

fn resolve_graph(name: Option<&str>) -> Option<GraphNameRef<'_>> {
    name.map(|n| GraphNameRef::NamedNode(NamedNodeRef::new_unchecked(n)))
}

pub struct RdfGraph {
    store: Store,
    profile_cache: Mutex<LruCache<String, GraphProfile>>,
}

impl Default for RdfGraph {
    fn default() -> Self {
        Self {
            store: Store::new().expect("Failed to create in-memory oxigraph store"),
            profile_cache: Mutex::new(LruCache::new(NonZeroUsize::new(32).unwrap())),
        }
    }
}

impl RdfGraph {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        Store::open(path)
            .map(|store| Self {
                store,
                profile_cache: Mutex::new(LruCache::new(NonZeroUsize::new(32).unwrap())),
            })
            .map_err(|e| e.to_string())
    }
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

        // Lazy streaming via bulk_loader: parses and inserts quads on-the-fly
        // without materializing an intermediate Vec (avoids doubling memory).
        let mut loader = self.store.bulk_loader();
        let skipped = std::cell::Cell::new(0usize);
        loader
            .load_quads(
                RdfParser::from_format(format)
                    .for_slice(bytes)
                    .filter_map(|r| match r {
                        Ok(q) => Some(q),
                        Err(_) => {
                            skipped.set(skipped.get() + 1);
                            None
                        }
                    })
                    .map(|t| Quad::new(t.subject, t.predicate, t.object, gn.clone())),
            )
            .map_err(|e| e.to_string())?;
        let n = skipped.get();
        if n > 0 {
            tracing::warn!("Skipped {n} malformed triple(s) during RDF load from {url}");
        }
        loader.commit().map_err(|e| e.to_string())
    }

    pub fn insert_triples(&self, graph_name: Option<&str>, triples: &[Triple]) {
        let graph = resolve_graph(graph_name);
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
        if let Ok(mut cache) = self.profile_cache.lock() {
            cache.pop(graph_name);
        }
    }

    pub fn triple_count(&self, graph_name: Option<&str>) -> usize {
        let graph = resolve_graph(graph_name);
        self.store
            .quads_for_pattern(None, None, None, graph)
            .count()
    }

    pub fn get_graph(&self, graph_name: Option<&str>) -> GraphData {
        let graph = resolve_graph(graph_name);
        let triples: Vec<_> = self
            .store
            .quads_for_pattern(None, None, None, graph)
            .filter_map(|q| q.ok())
            .map(|q| Triple::new(q.subject, q.predicate, q.object))
            .collect();
        convert::triples_to_graph_data(&triples)
    }

    fn first_literal(
        &self,
        subj: &NamedNode,
        pred_iri: &str,
        graph: Option<GraphNameRef<'_>>,
    ) -> Option<String> {
        let pred = NamedNodeRef::new_unchecked(pred_iri);
        self.store
            .quads_for_pattern(Some(subj.as_ref().into()), Some(pred), None, graph)
            .flatten()
            .find_map(|q| match q.object {
                oxrdf::Term::Literal(l) => Some(l.value().to_string()),
                _ => None,
            })
    }

    fn first_type(
        &self,
        subj: &NamedNode,
        graph: Option<GraphNameRef<'_>>,
    ) -> String {
        let type_pred = NamedNodeRef::new_unchecked(vocab::RDF_TYPE);
        self.store
            .quads_for_pattern(Some(subj.as_ref().into()), Some(type_pred), None, graph)
            .flatten()
            .find_map(|q| match q.object {
                oxrdf::Term::NamedNode(n) => Some(convert::shorten_iri(n.as_str())),
                _ => None,
            })
            .unwrap_or_else(|| "resource".to_string())
    }

    pub fn search_nodes(&self, graph_name: Option<&str>, query: &str, limit: usize) -> Vec<SearchResult> {
        let graph = resolve_graph(graph_name);
        let label_pred = NamedNodeRef::new_unchecked(vocab::RDFS_LABEL);
        let query_lower = query.trim().to_lowercase();

        let mut results = Vec::new();

        for quad in self.store.quads_for_pattern(None, Some(label_pred), None, graph).flatten() {
            let oxrdf::NamedOrBlankNode::NamedNode(ref subj) = quad.subject else { continue };
            let oxrdf::Term::Literal(ref lit) = quad.object else { continue };

            if !query_lower.is_empty() && !lit.value().to_lowercase().contains(&query_lower) {
                continue;
            }

            results.push(SearchResult {
                id: subj.as_str().to_string(),
                label: lit.value().to_string(),
                group: self.first_type(subj, graph),
                description: self.first_literal(subj, vocab::RDFS_COMMENT, graph),
            });
            if results.len() >= limit { break; }
        }
        results
    }

    pub fn expand_node(&self, graph_name: Option<&str>, node_iri: &str) -> GraphData {
        let graph = resolve_graph(graph_name);
        let node = NamedNodeRef::new_unchecked(node_iri);
        let mut triples = Vec::new();

        // Outgoing — GSPO range scan
        for quad in self.store
            .quads_for_pattern(Some(node.into()), None, None, graph)
            .flatten()
            .take(MAX_EXPAND_TRIPLES)
        {
            triples.push(Triple::new(quad.subject, quad.predicate, quad.object));
        }

        // Incoming — GOSP range scan
        let remaining = MAX_EXPAND_TRIPLES.saturating_sub(triples.len());
        if remaining > 0 {
            for quad in self.store
                .quads_for_pattern(None, None, Some(node.into()), graph)
                .flatten()
                .take(remaining)
            {
                triples.push(Triple::new(quad.subject, quad.predicate, quad.object));
            }
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

    /// Execute a SPARQL SELECT and return raw `oxrdf::Term` values.
    /// Unlike `sparql_select` which stringifies everything into `TabularData`,
    /// this preserves IRIs, typed literals, and datatypes for programmatic use.
    pub(crate) fn sparql_solutions_raw(
        &self,
        sparql: &str,
        graph_name: Option<&str>,
    ) -> Result<Vec<Vec<(String, oxrdf::Term)>>, String> {
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
                let mut rows = Vec::new();
                for solution in solutions.flatten() {
                    let row: Vec<(String, oxrdf::Term)> = vars
                        .iter()
                        .filter_map(|var| {
                            solution.get(var.as_str()).map(|t| (var.clone(), t.clone()))
                        })
                        .collect();
                    rows.push(row);
                }
                Ok(rows)
            }
            Ok(_) => Err("Expected SELECT query".into()),
            Err(e) => Err(format!("SPARQL error: {e}")),
        }
    }

    pub fn get_profile(&self, graph_name: &str) -> GraphProfile {
        if let Ok(mut cache) = self.profile_cache.lock() {
            if let Some(cached) = cache.get(graph_name) {
                return cached.clone();
            }
        }
        let profile = GraphProfile::build(self, graph_name);
        if let Ok(mut cache) = self.profile_cache.lock() {
            cache.put(graph_name.to_string(), profile.clone());
        }
        profile
    }

    pub fn serialize_to_format(&self, format: RdfExportFormat) -> Result<String, String> {
        self.serialize_graph(None, format)
    }

    pub fn serialize_graph(&self, graph_name: Option<&str>, format: RdfExportFormat) -> Result<String, String> {
        let graph = resolve_graph(graph_name);

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
