use std::sync::Arc;

use super::convert::GraphData;
use super::types::{SearchResult, TabularData};

/// A single RDF triple with all components as owned strings.
pub struct RdfTriple {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    pub object_datatype: Option<String>,
    pub object_lang: Option<String>,
}

/// Aggregate root: a queryable RDF dataset.
///
/// Abstracts the underlying storage (fragments, HDT, …)
/// so that read-path consumers are backend-agnostic.
pub trait Dataset: Send + Sync {
    /// Pattern match triples. `None` for a component means "any".
    fn triples(
        &self,
        s: Option<&str>,
        p: Option<&str>,
        o: Option<&str>,
    ) -> Box<dyn Iterator<Item = RdfTriple> + '_>;

    /// Execute a SPARQL SELECT query and return tabular results.
    fn sparql_select(&self, sparql: &str) -> Result<TabularData, String>;

    /// Count all triples in the dataset.
    fn triple_count(&self) -> usize;

    /// Check if the dataset has any triples.
    fn is_empty(&self) -> bool {
        self.triple_count() == 0
    }
}

/// Resolves a graph name to a queryable Dataset.
pub trait DatasetResolver: Send + Sync {
    fn resolve(&self, graph_name: &str) -> Result<Arc<dyn Dataset>, String>;
}

/// Search nodes by label text.
pub fn search_nodes(ds: &dyn Dataset, query: &str, limit: usize) -> Vec<SearchResult> {
    let query_lower = query.trim().to_lowercase();
    let mut results = Vec::new();

    // Scan all rdfs:label triples
    for triple in ds.triples(None, Some(super::vocab::RDFS_LABEL), None) {
        if !query_lower.is_empty()
            && !triple.object.to_lowercase().contains(&query_lower)
        {
            continue;
        }

        // Find the rdf:type for this subject
        let group = ds
            .triples(Some(&triple.subject), Some(super::vocab::RDF_TYPE), None)
            .next()
            .map(|t| super::convert::shorten_iri(&t.object))
            .unwrap_or_else(|| "resource".to_string());

        // Find rdfs:comment for description
        let description = ds
            .triples(Some(&triple.subject), Some(super::vocab::RDFS_COMMENT), None)
            .next()
            .map(|t| t.object);

        results.push(SearchResult {
            id: triple.subject,
            label: triple.object,
            group,
            description,
        });
        if results.len() >= limit {
            break;
        }
    }

    results
}

/// Expand a node: get all outgoing and incoming triples as a graph.
pub fn expand_node(ds: &dyn Dataset, iri: &str) -> GraphData {
    const MAX_TRIPLES: usize = 500;
    let mut collected = Vec::new();

    // Outgoing triples
    for triple in ds.triples(Some(iri), None, None) {
        collected.push(triple);
        if collected.len() >= MAX_TRIPLES {
            break;
        }
    }

    // Incoming triples
    let remaining = MAX_TRIPLES.saturating_sub(collected.len());
    if remaining > 0 {
        for triple in ds.triples(None, None, Some(iri)) {
            collected.push(triple);
            if collected.len() >= MAX_TRIPLES {
                break;
            }
        }
    }

    super::convert::triples_to_graph_data(&collected)
}

/// Get the full graph as GraphData.
pub fn get_graph(ds: &dyn Dataset) -> GraphData {
    let collected: Vec<_> = ds.triples(None, None, None).collect();
    super::convert::triples_to_graph_data(&collected)
}
