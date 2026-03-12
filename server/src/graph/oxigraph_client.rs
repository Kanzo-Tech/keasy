use tracing::warn;

/// Thin HTTP wrapper for the Oxigraph SPARQL endpoint.
pub struct OxigraphClient {
    url: String,
    client: reqwest::Client,
}

impl OxigraphClient {
    pub fn new(url: String) -> Self {
        Self {
            url,
            client: reqwest::Client::new(),
        }
    }

    /// Named graph IRI for a job's DCAT catalog.
    pub fn job_graph_iri(job_id: &str) -> String {
        format!("urn:keasy:job:{job_id}")
    }

    /// Insert N-Triples data into a named graph.
    /// Adds an org-ownership metadata triple.
    pub async fn insert_ntriples(
        &self,
        graph_iri: &str,
        ntriples: &str,
        org_id: &str,
    ) -> Result<(), String> {
        let org_triple = format!(
            "<{graph_iri}> <urn:keasy:vocab#orgId> \"{org_id}\" .\n"
        );
        let body = format!(
            "INSERT DATA {{ GRAPH <{graph_iri}> {{ {org_triple}{ntriples} }} }}"
        );
        self.client
            .post(format!("{}/update", self.url))
            .header("Content-Type", "application/sparql-update")
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Oxigraph insert failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Oxigraph insert rejected: {e}"))?;
        Ok(())
    }

    /// Drop an entire named graph.
    pub async fn drop_graph(&self, graph_iri: &str) -> Result<(), String> {
        let body = format!("DROP SILENT GRAPH <{graph_iri}>");
        self.client
            .post(format!("{}/update", self.url))
            .header("Content-Type", "application/sparql-update")
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Oxigraph drop failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Oxigraph drop rejected: {e}"))?;
        Ok(())
    }

    /// Execute a CONSTRUCT query, return N-Triples bytes.
    pub async fn construct(&self, sparql: &str) -> Result<String, String> {
        let resp = self
            .client
            .post(format!("{}/query", self.url))
            .header("Content-Type", "application/sparql-query")
            .header("Accept", "application/n-triples")
            .body(sparql.to_string())
            .send()
            .await
            .map_err(|e| format!("Oxigraph query failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Oxigraph query rejected: {e}"))?;
        resp.text()
            .await
            .map_err(|e| format!("Oxigraph response read failed: {e}"))
    }

    /// Construct all triples for an organization across all job graphs.
    pub async fn construct_org_catalog(&self, org_id: &str) -> Result<String, String> {
        let sparql = format!(
            "CONSTRUCT {{ ?s ?p ?o }} WHERE {{ \
             GRAPH ?g {{ ?s ?p ?o . ?g <urn:keasy:vocab#orgId> \"{org_id}\" }} }}"
        );
        self.construct(&sparql).await
    }

    /// Non-blocking insert that logs errors instead of propagating them.
    pub async fn try_insert_ntriples(
        &self,
        graph_iri: &str,
        ntriples: &str,
        org_id: &str,
    ) {
        if let Err(e) = self.insert_ntriples(graph_iri, ntriples, org_id).await {
            warn!(graph_iri, error = %e, "Failed to insert catalog into Oxigraph (non-fatal)");
        }
    }
}
