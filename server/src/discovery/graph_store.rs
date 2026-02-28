use super::convert::GraphData;
use super::graph_types::{KeasyTriple, SearchResult, TabularData};
use super::rdf_format::RdfExportFormat;

pub trait GraphStore: Send + Sync {
    fn insert_triples(&self, graph_name: Option<&str>, triples: &[KeasyTriple]);
    fn clear(&self);
    fn clear_named_graph(&self, graph_name: &str);
    fn triple_count(&self, graph_name: Option<&str>) -> usize;
    fn subject_count(&self) -> usize;
    fn get_graph(&self, graph_name: Option<&str>) -> GraphData;
    fn get_merged_graphs(&self, graph_names: &[String]) -> GraphData;
    fn search_nodes(&self, query: &str, limit: usize) -> Vec<SearchResult>;
    fn expand_node(&self, node_iri: &str) -> GraphData;
    fn sparql_select(&self, sparql: &str) -> Result<TabularData, String>;
    fn serialize_to_format(&self, format: RdfExportFormat) -> Result<String, String>;
    fn serialize_graph(
        &self,
        graph_name: Option<&str>,
        format: RdfExportFormat,
    ) -> Result<String, String>;
}
