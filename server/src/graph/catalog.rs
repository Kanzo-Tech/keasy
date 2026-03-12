use std::sync::Arc;

use tracing::warn;

use super::fragment::FragmentDataset;
use super::oxigraph_client::OxigraphClient;

/// Domain service for DCAT catalog persistence.
///
/// Oxigraph is the single source of truth for catalogs.
/// When Oxigraph is not configured, catalog operations are no-ops.
#[derive(Clone)]
pub struct CatalogStore {
    oxigraph: Option<Arc<OxigraphClient>>,
}

impl CatalogStore {
    pub fn new(oxigraph: Option<Arc<OxigraphClient>>) -> Self {
        Self { oxigraph }
    }

    /// Persist a catalog for a completed job.
    pub async fn store(&self, job_id: &str, org_id: &str, catalog_nt: &str) {
        if let Some(ref oxigraph) = self.oxigraph {
            let graph_iri = OxigraphClient::job_graph_iri(job_id);
            oxigraph.try_insert_ntriples(&graph_iri, catalog_nt, org_id).await;
        }
    }

    /// Load a single job's catalog as a `FragmentDataset`.
    pub async fn get_dataset(&self, job_id: &str) -> Option<FragmentDataset> {
        let nt = self.get_raw(job_id).await?;
        Some(FragmentDataset::from_ntriples(&nt))
    }

    /// Load a single job's catalog as raw N-Triples string.
    pub async fn get_raw(&self, job_id: &str) -> Option<String> {
        let oxigraph = self.oxigraph.as_ref()?;
        let graph_iri = OxigraphClient::job_graph_iri(job_id);
        let sparql = format!(
            "CONSTRUCT {{ ?s ?p ?o }} WHERE {{ GRAPH <{graph_iri}> {{ ?s ?p ?o }} }}"
        );
        match oxigraph.construct(&sparql).await {
            Ok(nt) if !nt.trim().is_empty() => Some(nt),
            Ok(_) => None,
            Err(e) => {
                warn!(job_id, error = %e, "Oxigraph CONSTRUCT failed");
                None
            }
        }
    }

    /// Remove a job's catalog from Oxigraph.
    pub async fn remove(&self, job_id: &str) {
        if let Some(ref oxigraph) = self.oxigraph {
            let graph_iri = OxigraphClient::job_graph_iri(job_id);
            if let Err(e) = oxigraph.drop_graph(&graph_iri).await {
                warn!(job_id, error = %e, "Failed to drop Oxigraph graph (non-fatal)");
            }
        }
    }
}
