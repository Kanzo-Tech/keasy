use crate::graph::dataset::RdfTriple;
use crate::graph::format::RdfExportFormat;
use crate::graph::vocab;

use super::types::{DatasetInfo, DcatInput, DistributionInfo};

fn triple_ii(s: &str, p: &str, o: &str) -> RdfTriple {
    RdfTriple {
        subject: s.to_string(),
        predicate: p.to_string(),
        object: o.to_string(),
        object_datatype: None,
        object_lang: None,
    }
}

fn triple_il(s: &str, p: &str, value: &str) -> RdfTriple {
    RdfTriple {
        subject: s.to_string(),
        predicate: p.to_string(),
        object: value.to_string(),
        object_datatype: None,
        object_lang: None,
    }
}

fn triple_ilt(s: &str, p: &str, value: &str, datatype: &str) -> RdfTriple {
    RdfTriple {
        subject: s.to_string(),
        predicate: p.to_string(),
        object: value.to_string(),
        object_datatype: Some(datatype.to_string()),
        object_lang: None,
    }
}

fn job_urn(kind: &str, job_id: &str, name: &str) -> String {
    if name.is_empty() {
        format!("urn:keasy:{kind}:{job_id}")
    } else {
        format!(
            "urn:keasy:{kind}:{job_id}/{}",
            encode_uri_component(name)
        )
    }
}

fn shared_urn(kind: &str, identity: &str) -> String {
    format!("urn:keasy:{kind}:{}", slug(identity))
}

pub(crate) fn slug(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .replace(
            |c: char| !c.is_alphanumeric() && c != '-' && c != '.',
            "-",
        )
        .trim_matches('-')
        .to_string()
}

pub fn generate_dcat_catalog(input: &DcatInput, format: RdfExportFormat) -> Result<String, String> {
    let triples = build_catalog_triples(input);
    serialize_triples(&triples, format)
}

pub fn build_catalog_triples(input: &DcatInput) -> Vec<RdfTriple> {
    let mut triples = Vec::new();

    let catalog = job_urn("catalog", &input.job_id, "");
    let catalog_title = input
        .job_name
        .as_deref()
        .unwrap_or("Keasy Pipeline Output");

    triples.push(triple_ii(&catalog, vocab::RDF_TYPE, vocab::DCAT_CATALOG));
    triples.push(triple_il(&catalog, vocab::DCT_TITLE, catalog_title));

    if let Some(desc) = &input.org.catalog_description {
        triples.push(triple_il(&catalog, vocab::DCT_DESCRIPTION, desc));
    }

    triples.push(triple_ilt(&catalog, vocab::DCT_ISSUED, &input.completed_at, vocab::XSD_DATETIME));

    let publisher = match &input.org.publisher_uri {
        Some(uri) => uri.clone(),
        None => shared_urn("publisher", &input.org.publisher_name),
    };
    triples.push(triple_ii(&catalog, vocab::DCT_PUBLISHER, &publisher));
    triples.push(triple_ii(&publisher, vocab::RDF_TYPE, vocab::FOAF_AGENT));
    triples.push(triple_il(&publisher, vocab::FOAF_NAME, &input.org.publisher_name));
    if let Some(uri) = &input.org.publisher_uri {
        triples.push(triple_ii(&publisher, vocab::FOAF_HOMEPAGE, uri));
    }

    if let Some(email) = &input.org.contact_email {
        let contact = shared_urn("contact", email);
        triples.push(triple_ii(&catalog, vocab::DCAT_CONTACT_POINT, &contact));
        triples.push(triple_ii(&contact, vocab::RDF_TYPE, vocab::VCARD_KIND));
        triples.push(triple_ii(&contact, vocab::VCARD_HAS_EMAIL, &format!("mailto:{email}")));
    }

    if let Some(license) = &input.org.license_uri {
        triples.push(triple_ii(&catalog, vocab::DCT_LICENSE, license));
    }

    // Catalog language
    let lang = input.language.as_deref().unwrap_or("en");
    triples.push(triple_il(&catalog, vocab::DCT_LANGUAGE, lang));

    for dataset in &input.datasets {
        let dataset_uri = job_urn("dataset", &input.job_id, &dataset.type_name);
        triples.push(triple_ii(&catalog, vocab::DCAT_DATASET_PROP, &dataset_uri));
        build_dataset_triples(&mut triples, dataset, &input.job_id, &dataset_uri);
    }

    triples
}

fn build_dataset_triples(
    triples: &mut Vec<RdfTriple>,
    dataset: &DatasetInfo,
    job_id: &str,
    dataset_uri: &str,
) {
    triples.push(triple_ii(dataset_uri, vocab::RDF_TYPE, vocab::DCAT_DATASET));
    triples.push(triple_il(dataset_uri, vocab::DCT_TITLE, &dataset.type_name));

    if let Some(source) = &dataset.source_name {
        triples.push(triple_il(dataset_uri, vocab::DCT_SOURCE, source));
    }

    if let Some(rdf_type) = &dataset.rdf_type {
        triples.push(triple_ii(dataset_uri, vocab::DCT_CONFORMS_TO, rdf_type));
    }

    for keyword in &dataset.keywords {
        triples.push(triple_il(dataset_uri, vocab::DCAT_KEYWORD, keyword));
    }

    for dist in &dataset.distributions {
        let filename = dist.destination.rsplit('/').next().unwrap_or(&dist.destination);
        let dist_uri = job_urn("dist", job_id, filename);
        triples.push(triple_ii(dataset_uri, vocab::DCAT_DISTRIBUTION_PROP, &dist_uri));
        build_distribution_triples(triples, dist, &dist_uri);
    }
}

fn build_distribution_triples(
    triples: &mut Vec<RdfTriple>,
    dist: &DistributionInfo,
    dist_uri: &str,
) {
    triples.push(triple_ii(dist_uri, vocab::RDF_TYPE, vocab::DCAT_DISTRIBUTION));
    triples.push(triple_ii(dist_uri, vocab::DCAT_ACCESS_URL, &dist.destination));
    triples.push(triple_il(dist_uri, vocab::DCAT_MEDIA_TYPE, &dist.media_type));
}

pub fn media_type_from_extension(path: &str) -> String {
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

pub(crate) fn encode_uri_component(s: &str) -> String {
    s.replace(' ', "%20")
        .replace('<', "%3C")
        .replace('>', "%3E")
}

/// Serialize a list of RdfTriple in the given format using oxrdfio.
pub fn serialize_triples(triples: &[RdfTriple], format: RdfExportFormat) -> Result<String, String> {
    use oxrdf::{GraphNameRef, Literal, LiteralRef, NamedNodeRef, QuadRef};
    use oxrdfio::RdfSerializer;

    let rdf_format = format.to_rdf_format();
    let mut writer = RdfSerializer::from_format(rdf_format).for_writer(Vec::new());

    for t in triples {
        let subject = NamedNodeRef::new(&t.subject).map_err(|e| format!("bad subject IRI: {e}"))?;
        let predicate =
            NamedNodeRef::new(&t.predicate).map_err(|e| format!("bad predicate IRI: {e}"))?;

        let object_is_iri = t.object.starts_with("http://")
            || t.object.starts_with("https://")
            || t.object.starts_with("urn:")
            || t.object.starts_with("mailto:");

        if object_is_iri {
            let object =
                NamedNodeRef::new(&t.object).map_err(|e| format!("bad object IRI: {e}"))?;
            writer
                .serialize_quad(QuadRef::new(
                    subject,
                    predicate,
                    object,
                    GraphNameRef::DefaultGraph,
                ))
                .map_err(|e| e.to_string())?;
        } else {
            let literal: Literal = if let Some(ref lang) = t.object_lang {
                Literal::new_language_tagged_literal(&t.object, lang)
                    .map_err(|e| format!("bad language tag: {e}"))?
            } else if let Some(ref dt) = t.object_datatype {
                let dt_node =
                    NamedNodeRef::new(dt).map_err(|e| format!("bad datatype IRI: {e}"))?;
                Literal::new_typed_literal(&t.object, dt_node)
            } else {
                Literal::new_simple_literal(&t.object)
            };
            writer
                .serialize_quad(QuadRef::new(
                    subject,
                    predicate,
                    LiteralRef::from(&literal),
                    GraphNameRef::DefaultGraph,
                ))
                .map_err(|e| e.to_string())?;
        }
    }

    let bytes = writer.finish().map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| format!("non-UTF8 output: {e}"))
}

/// Serialize a list of RdfTriple as N-Triples text (convenience wrapper).
pub fn serialize_ntriples(triples: &[RdfTriple]) -> String {
    serialize_triples(triples, RdfExportFormat::NTriples).unwrap_or_default()
}

// ── Turtle export from parquets ─────────────────────────────────────────

/// Generate DCAT-AP Turtle by reading catalog parquets.
///
/// The parquets are the **single source of truth** — this function
/// reconstructs RDF triples from vertex properties + edge joins,
/// producing output identical to the interactive graph visualization.
pub fn parquets_to_turtle(
    catalog_base: &str,
    manifest: &fossil_lang::runtime::executor::DataManifest,
    cloud_config: &std::collections::HashMap<String, String>,
) -> Result<String, String> {
    use polars::prelude::*;
    use fossil_lang::traits::resolver::ResolvedPath;

    let resolved = ResolvedPath::with_config(catalog_base, None, cloud_config.clone());

    // Helper: read a parquet file relative to catalog_base
    let read_parquet = |rel_path: &str| -> Result<DataFrame, String> {
        let full = resolved.join(rel_path);
        LazyFrame::scan_parquet(full.pl_path().clone(), ScanArgsParquet::default())
            .map_err(|e| format!("scan {rel_path}: {e}"))?
            .collect()
            .map_err(|e| format!("collect {rel_path}: {e}"))
    };

    let mut triples = Vec::new();

    // ── Read all vertex parquets once (avoid N+1 re-reads in edge loop) ─
    let mut vertex_dfs: std::collections::HashMap<&str, DataFrame> = std::collections::HashMap::new();
    for tm in &manifest.types {
        vertex_dfs.insert(tm.name.as_str(), read_parquet(&tm.vertex_file)?);
    }

    // ── Vertex triples ──────────────────────────────────────────────────
    for tm in &manifest.types {
        let df = &vertex_dfs[tm.name.as_str()];

        let col_iris: std::collections::HashMap<&str, &str> = tm.columns.iter()
            .filter(|c| !c.iri.is_empty())
            .map(|c| (c.name.as_str(), c.iri.as_str()))
            .collect();

        let subjects = df.column("subject").map_err(|e| e.to_string())?
            .str().map_err(|e| e.to_string())?;

        // Pre-cast property columns to string once (not per-row)
        let prop_cols: Vec<(&str, polars::prelude::StringChunked)> = tm.columns.iter()
            .filter_map(|cs| {
                col_iris.get(cs.name.as_str())?; // only columns with IRIs
                let col = df.column(&cs.name).ok()?;
                let str_col = col.cast(&DataType::String).ok()?;
                Some((cs.name.as_str(), str_col.str().ok()?.clone()))
            })
            .collect();

        for row_idx in 0..df.height() {
            let subject = subjects.get(row_idx).unwrap_or_default();
            if subject.is_empty() { continue; }

            if !tm.iri.is_empty() {
                triples.push(triple_ii(subject, crate::graph::vocab::RDF_TYPE, &tm.iri));
            }

            for (col_name, str_ca) in &prop_cols {
                let predicate = col_iris[col_name];
                let Some(value) = str_ca.get(row_idx) else { continue };
                if value.is_empty() { continue; }

                if value.starts_with("http://") || value.starts_with("https://")
                    || value.starts_with("urn:") || value.starts_with("mailto:")
                {
                    triples.push(triple_ii(subject, predicate, value));
                } else {
                    triples.push(triple_il(subject, predicate, value));
                }
            }
        }
    }

    // ── Edge triples (vertex DFs already cached above) ──────────────────
    for em in &manifest.edges {
        if em.iri.is_empty() { continue; }

        let edge_df = read_parquet(&em.by_source)?;
        let Some(src_df) = vertex_dfs.get(em.source_type.as_str()) else { continue };
        let Some(tgt_df) = vertex_dfs.get(em.target_type.as_str()) else { continue };

        let source_ca = edge_df.column("source").map_err(|e| e.to_string())?
            .u64().map_err(|e| e.to_string())?;
        let target_ca = edge_df.column("target").map_err(|e| e.to_string())?
            .u64().map_err(|e| e.to_string())?;
        let src_subjects = src_df.column("subject").map_err(|e| e.to_string())?
            .str().map_err(|e| e.to_string())?;
        let tgt_subjects = tgt_df.column("subject").map_err(|e| e.to_string())?
            .str().map_err(|e| e.to_string())?;

        for row_idx in 0..edge_df.height() {
            let src_id = source_ca.get(row_idx).unwrap_or(0) as usize;
            let tgt_id = target_ca.get(row_idx).unwrap_or(0) as usize;

            let src_subj = src_subjects.get(src_id).unwrap_or_default();
            let tgt_subj = tgt_subjects.get(tgt_id).unwrap_or_default();

            if !src_subj.is_empty() && !tgt_subj.is_empty() {
                triples.push(triple_ii(src_subj, &em.iri, tgt_subj));
            }
        }
    }

    serialize_triples(&triples, RdfExportFormat::Turtle)
}
