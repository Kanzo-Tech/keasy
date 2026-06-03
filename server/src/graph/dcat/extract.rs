use fossil_run_status::{CatalogDataset, CatalogDistribution, CatalogField, CatalogInput, RunStatus};

use crate::settings::org::OrgSettings;

/// Build the [`CatalogInput`] the `fossil catalog` subprocess consumes from the
/// run manifest plus host-owned governance.
///
/// Host-boundary: the output *spec* (per-type RDF type IRI, per-column predicate
/// IRI + XSD datatype) is fossil's knowledge, carried in the `RunStatus`
/// manifest — keasy reads it from there. keasy supplies only host-owned
/// governance values (the `org` settings) and the storage location: each vertex
/// type's Parquet under `dest_url` is a DCAT distribution. The DCAT-AP *shape*
/// lives in fossil (`fossil catalog`), not re-implemented here. Column
/// statistics are the browser's job (DuckDB-WASM), so they are absent.
pub fn build_catalog_input(
    job_id: &str,
    job_name: Option<&str>,
    completed_at: &str,
    org: &OrgSettings,
    manifest: &RunStatus,
    dest_url: &str,
) -> CatalogInput {
    let base = dest_url.trim_end_matches('/');
    let datasets = manifest
        .vertices
        .iter()
        .map(|vertex| {
            let fields = vertex
                .columns
                .iter()
                .map(|col| CatalogField {
                    name: col.name.clone(),
                    rdf_uri: col.rdf_uri.clone(),
                    datatype: col.xsd_datatype.clone(),
                })
                .collect();

            let destination = format!("{base}/{}", vertex.file);
            let distributions = vec![CatalogDistribution {
                media_type: media_type_from_extension(&destination),
                destination,
            }];

            CatalogDataset {
                type_name: vertex.vertex_type.clone(),
                // The source binding is keasy's data-plane detail, not part of
                // the output spec the manifest carries — omitted (the optional
                // dct:source triple is simply not emitted).
                source_name: None,
                rdf_type: vertex.rdf_type.clone(),
                keywords: Vec::new(),
                entity_count: vertex.count,
                fields,
                distributions,
            }
        })
        .collect();

    CatalogInput {
        job_id: job_id.to_string(),
        job_name: job_name.map(str::to_string),
        completed_at: completed_at.to_string(),
        language: None,
        publisher_name: org.publisher_name.clone(),
        publisher_uri: org.publisher_uri.clone(),
        catalog_description: org.catalog_description.clone(),
        license_uri: org.license_uri.clone(),
        contact_email: org.contact_email.clone(),
        datasets,
    }
}

/// Map a file extension to a DCAT `dcat:mediaType`.
fn media_type_from_extension(path: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "nq" => "application/n-quads",
        "ttl" => "text/turtle",
        "nt" => "application/n-triples",
        "csv" => "text/csv",
        "rdf" => "application/rdf+xml",
        "json" | "jsonld" => "application/ld+json",
        "parquet" => "application/x-parquet",
        _ => "application/octet-stream",
    }
    .to_string()
}
