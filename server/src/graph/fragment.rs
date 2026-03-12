use std::collections::HashMap;

use fossil_stdlib::rdf::fragment_writer::{FragmentManifest, FragmentProfile};
use oxrdf::{LiteralRef, NamedOrBlankNodeRef, Quad, TermRef};
use oxrdfio::{RdfFormat, RdfParser};

use super::dataset::{Dataset, RdfTriple};
use super::types::TabularData;

/// Async resolver that fetches manifest + .nt fragments from blob storage.
/// Stateless — no caching, downloads fresh each time.
pub struct FragmentResolver;

impl FragmentResolver {
    pub fn new() -> Self {
        Self
    }

    /// Load the manifest for a job's fragment base URL.
    pub async fn load_manifest(
        &self,
        base_url: &str,
        creds: &HashMap<String, String>,
    ) -> Result<FragmentManifest, String> {
        let url = format!("{base_url}/manifest.json");
        let bytes = crate::cloud::reader::download(&url, creds).await?;
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid manifest: {e}"))
    }

    /// Load the profile for a job's fragment base URL.
    pub async fn load_profile(
        &self,
        base_url: &str,
        creds: &HashMap<String, String>,
    ) -> Result<FragmentProfile, String> {
        let url = format!("{base_url}/profile.json");
        let bytes = crate::cloud::reader::download(&url, creds).await?;
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid profile: {e}"))
    }

    /// Load all fragments for a job and return a queryable in-memory dataset.
    pub async fn resolve_dataset(
        &self,
        base_url: &str,
        creds: &HashMap<String, String>,
    ) -> Result<FragmentDataset, String> {
        let manifest = self.load_manifest(base_url, creds).await?;

        // Build all fragment URLs upfront, then download in parallel
        let urls: Vec<String> = manifest
            .types
            .values()
            .flat_map(|tm| {
                (0..tm.fragments).map(move |idx| format!("{base_url}/{}/{:06}.nt", tm.dir, idx))
            })
            .collect();

        let futures: Vec<_> = urls
            .iter()
            .map(|url| crate::cloud::reader::download(url, creds))
            .collect();

        let results = futures::future::join_all(futures).await;

        let mut dataset = oxrdf::Dataset::new();
        for (i, result) in results.into_iter().enumerate() {
            let bytes = result.map_err(|e| format!("fragment {}: {e}", urls[i]))?;
            parse_ntriples_into(&bytes, &mut dataset)
                .map_err(|e| format!("parse error in fragment {}: {e}", urls[i]))?;
        }

        Ok(FragmentDataset { dataset })
    }
}

/// In-memory dataset loaded from fragments. Implements the `Dataset` trait
/// so it can be used by discovery routes (search, expand, SPARQL).
pub struct FragmentDataset {
    dataset: oxrdf::Dataset,
}

impl FragmentDataset {
    pub fn empty() -> Self {
        Self {
            dataset: oxrdf::Dataset::new(),
        }
    }

    /// Build from N-Triples text (used by Promotor path and job graph view).
    pub fn from_ntriples(text: &str) -> Self {
        let mut dataset = oxrdf::Dataset::new();
        // Best-effort: ignore parse errors for individual lines
        let _ = parse_ntriples_into(text.as_bytes(), &mut dataset);
        Self { dataset }
    }

    /// Serialize the entire dataset in the requested RDF format.
    /// Works directly on oxrdf quads — no RdfTriple round-trip.
    pub fn serialize(&self, format: super::format::RdfExportFormat) -> Result<String, String> {
        use oxrdfio::RdfSerializer;

        let rdf_format = format.to_rdf_format();
        let mut writer = RdfSerializer::from_format(rdf_format).for_writer(Vec::new());
        for quad in self.dataset.iter() {
            writer.serialize_quad(quad).map_err(|e| e.to_string())?;
        }
        let bytes = writer.finish().map_err(|e| e.to_string())?;
        String::from_utf8(bytes).map_err(|e| format!("non-UTF8 output: {e}"))
    }
}

impl Dataset for FragmentDataset {
    fn triples(
        &self,
        s: Option<&str>,
        p: Option<&str>,
        o: Option<&str>,
    ) -> Box<dyn Iterator<Item = RdfTriple> + '_> {
        // Collect all matching quads into a Vec to avoid lifetime issues
        // with borrowed filter values. The dataset is in-memory so this is fine.
        let s_filter = s.map(|v| v.to_string());
        let p_filter = p.map(|v| v.to_string());
        let o_filter = o.map(|v| v.to_string());

        let results: Vec<RdfTriple> = self
            .dataset
            .iter()
            .filter(move |quad| quad.graph_name.is_default_graph())
            .map(|quad| quad_to_rdf_triple(quad))
            .filter(|t| {
                s_filter.as_deref().is_none_or(|s| t.subject == s)
                    && p_filter.as_deref().is_none_or(|p| t.predicate == p)
                    && o_filter.as_deref().is_none_or(|o| t.object == o)
            })
            .collect();

        Box::new(results.into_iter())
    }

    fn sparql_select(&self, sparql: &str) -> Result<TabularData, String> {
        use spareval::{QueryEvaluator, QueryResults};
        use spargebra::SparqlParser;
        use std::collections::BTreeMap;

        let query = SparqlParser::new()
            .parse_query(sparql)
            .map_err(|e| e.to_string())?;
        let results = QueryEvaluator::new()
            .prepare(&query)
            .execute(&self.dataset)
            .map_err(|e| e.to_string())?;

        match results {
            QueryResults::Solutions(solutions) => {
                let variables: Vec<String> = solutions
                    .variables()
                    .iter()
                    .map(|v| v.as_str().to_string())
                    .collect();

                let mut rows = Vec::new();
                let mut column_types: BTreeMap<String, String> = BTreeMap::new();
                for col in &variables {
                    column_types.insert(col.clone(), "numeric".to_string());
                }

                for solution_result in solutions {
                    let solution = solution_result.map_err(|e| e.to_string())?;
                    let mut row = BTreeMap::new();
                    for var in &variables {
                        if let Some(term) = solution.get(var.as_str()) {
                            let val = term_to_string(term.as_ref());
                            if let Ok(n) = val.parse::<f64>() {
                                if let Some(num) = serde_json::Number::from_f64(n) {
                                    row.insert(var.clone(), serde_json::Value::Number(num));
                                    continue;
                                }
                            }
                            column_types.insert(var.clone(), "string".to_string());
                            row.insert(var.clone(), serde_json::Value::String(val));
                        }
                    }
                    rows.push(row);
                }

                Ok(TabularData {
                    columns: variables,
                    rows,
                    column_types,
                })
            }
            _ => Err("Expected SELECT query results".to_string()),
        }
    }

    fn triple_count(&self) -> usize {
        self.dataset.len()
    }
}

// ── oxrdf helpers ────────────────────────────────────────────────────────

/// Parse N-Triples bytes into an oxrdf Dataset (default graph).
fn parse_ntriples_into(bytes: &[u8], dataset: &mut oxrdf::Dataset) -> Result<(), String> {
    let parser = RdfParser::from_format(RdfFormat::NTriples);
    for quad_result in parser.for_reader(bytes) {
        let quad: Quad = quad_result.map_err(|e| e.to_string())?;
        dataset.insert(quad.as_ref());
    }
    Ok(())
}

/// Convert an oxrdf QuadRef to our RdfTriple type.
fn quad_to_rdf_triple(quad: oxrdf::QuadRef<'_>) -> RdfTriple {
    let subject = match quad.subject {
        NamedOrBlankNodeRef::NamedNode(n) => n.as_str().to_string(),
        NamedOrBlankNodeRef::BlankNode(b) => format!("_:{}", b.as_str()),
    };

    let predicate = quad.predicate.as_str().to_string();

    let (object, object_datatype, object_lang) = match quad.object {
        TermRef::NamedNode(n) => (n.as_str().to_string(), None, None),
        TermRef::BlankNode(b) => (format!("_:{}", b.as_str()), None, None),
        TermRef::Literal(lit) => literal_to_parts(lit),
        _ => (String::new(), None, None),
    };

    RdfTriple {
        subject,
        predicate,
        object,
        object_datatype,
        object_lang,
    }
}

/// Extract value, datatype, and language from an oxrdf literal.
fn literal_to_parts(lit: LiteralRef<'_>) -> (String, Option<String>, Option<String>) {
    let value = lit.value().to_string();
    if let Some(lang) = lit.language() {
        (value, None, Some(lang.to_string()))
    } else {
        let dt = lit.datatype().as_str();
        // Omit xsd:string as it's the default
        if dt == "http://www.w3.org/2001/XMLSchema#string" {
            (value, None, None)
        } else {
            (value, Some(dt.to_string()), None)
        }
    }
}

/// Convert an oxrdf Term to a display string.
fn term_to_string(term: TermRef<'_>) -> String {
    match term {
        TermRef::NamedNode(n) => n.as_str().to_string(),
        TermRef::BlankNode(b) => format!("_:{}", b.as_str()),
        TermRef::Literal(lit) => lit.value().to_string(),
        _ => String::new(),
    }
}
