use oxrdf::{Literal, NamedNode, Triple, vocab::rdf};
use oxrdfio::RdfSerializer;

use super::dcat_types::{DatasetInfo, DcatInput, DistributionInfo};
use super::rdf_format::RdfExportFormat;

const DCAT_CATALOG: &str = "http://www.w3.org/ns/dcat#Catalog";
const DCAT_DATASET: &str = "http://www.w3.org/ns/dcat#Dataset";
const DCAT_DISTRIBUTION: &str = "http://www.w3.org/ns/dcat#Distribution";
const DCAT_DATASET_PROP: &str = "http://www.w3.org/ns/dcat#dataset";
const DCAT_DISTRIBUTION_PROP: &str = "http://www.w3.org/ns/dcat#distribution";
const DCAT_ACCESS_URL: &str = "http://www.w3.org/ns/dcat#accessURL";
const DCAT_MEDIA_TYPE: &str = "http://www.w3.org/ns/dcat#mediaType";
const DCAT_CONTACT_POINT: &str = "http://www.w3.org/ns/dcat#contactPoint";

const DCT_TITLE: &str = "http://purl.org/dc/terms/title";
const DCT_DESCRIPTION: &str = "http://purl.org/dc/terms/description";
const DCT_ISSUED: &str = "http://purl.org/dc/terms/issued";
const DCT_PUBLISHER: &str = "http://purl.org/dc/terms/publisher";
const DCT_LICENSE: &str = "http://purl.org/dc/terms/license";
const DCT_SOURCE: &str = "http://purl.org/dc/terms/source";
const DCT_CONFORMS_TO: &str = "http://purl.org/dc/terms/conformsTo";

const FOAF_AGENT: &str = "http://xmlns.com/foaf/0.1/Agent";
const FOAF_NAME: &str = "http://xmlns.com/foaf/0.1/name";
const FOAF_HOMEPAGE: &str = "http://xmlns.com/foaf/0.1/homepage";

const VCARD_KIND: &str = "http://www.w3.org/2006/vcard/ns#Kind";
const VCARD_HAS_EMAIL: &str = "http://www.w3.org/2006/vcard/ns#hasEmail";

const XSD_DATETIME: &str = "http://www.w3.org/2001/XMLSchema#dateTime";

fn nn(iri: &str) -> NamedNode {
    NamedNode::new_unchecked(iri)
}

fn job_urn(kind: &str, job_id: &str, name: &str) -> NamedNode {
    if name.is_empty() {
        nn(&format!("urn:keasy:{kind}:{job_id}"))
    } else {
        nn(&format!(
            "urn:keasy:{kind}:{job_id}/{}",
            encode_uri_component(name)
        ))
    }
}

fn shared_urn(kind: &str, identity: &str) -> NamedNode {
    nn(&format!("urn:keasy:{kind}:{}", slug(identity)))
}

fn slug(s: &str) -> String {
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

pub fn build_catalog_triples(input: &DcatInput) -> Vec<Triple> {
    let mut triples = Vec::new();

    let catalog = job_urn("catalog", &input.job_id, "");
    let catalog_title = input
        .job_name
        .as_deref()
        .unwrap_or("Keasy Pipeline Output");

    triples.push(Triple::new(catalog.clone(), rdf::TYPE, nn(DCAT_CATALOG)));
    triples.push(Triple::new(
        catalog.clone(),
        nn(DCT_TITLE),
        Literal::new_simple_literal(catalog_title),
    ));

    if let Some(desc) = &input.org.catalog_description {
        triples.push(Triple::new(
            catalog.clone(),
            nn(DCT_DESCRIPTION),
            Literal::new_simple_literal(desc.as_str()),
        ));
    }

    triples.push(Triple::new(
        catalog.clone(),
        nn(DCT_ISSUED),
        Literal::new_typed_literal(&input.completed_at, nn(XSD_DATETIME)),
    ));

    let publisher = match &input.org.publisher_uri {
        Some(uri) => nn(uri),
        None => shared_urn("publisher", &input.org.publisher_name),
    };
    triples.push(Triple::new(catalog.clone(), nn(DCT_PUBLISHER), publisher.clone()));
    triples.push(Triple::new(publisher.clone(), rdf::TYPE, nn(FOAF_AGENT)));
    triples.push(Triple::new(
        publisher.clone(),
        nn(FOAF_NAME),
        Literal::new_simple_literal(input.org.publisher_name.as_str()),
    ));
    if let Some(uri) = &input.org.publisher_uri {
        triples.push(Triple::new(publisher, nn(FOAF_HOMEPAGE), nn(uri)));
    }

    if let Some(email) = &input.org.contact_email {
        let contact = shared_urn("contact", email);
        triples.push(Triple::new(catalog.clone(), nn(DCAT_CONTACT_POINT), contact.clone()));
        triples.push(Triple::new(contact.clone(), rdf::TYPE, nn(VCARD_KIND)));
        triples.push(Triple::new(
            contact,
            nn(VCARD_HAS_EMAIL),
            nn(&format!("mailto:{}", email)),
        ));
    }

    if let Some(license) = &input.org.license_uri {
        triples.push(Triple::new(catalog.clone(), nn(DCT_LICENSE), nn(license)));
    }

    for dataset in &input.datasets {
        let dataset_uri = job_urn("dataset", &input.job_id, &dataset.type_name);
        triples.push(Triple::new(
            catalog.clone(),
            nn(DCAT_DATASET_PROP),
            dataset_uri.clone(),
        ));
        build_dataset_triples(&mut triples, dataset, &input.job_id, &dataset_uri);
    }

    triples
}

fn build_dataset_triples(
    triples: &mut Vec<Triple>,
    dataset: &DatasetInfo,
    job_id: &str,
    dataset_uri: &NamedNode,
) {
    triples.push(Triple::new(dataset_uri.clone(), rdf::TYPE, nn(DCAT_DATASET)));
    triples.push(Triple::new(
        dataset_uri.clone(),
        nn(DCT_TITLE),
        Literal::new_simple_literal(dataset.type_name.as_str()),
    ));

    if let Some(source) = &dataset.source_name {
        triples.push(Triple::new(
            dataset_uri.clone(),
            nn(DCT_SOURCE),
            Literal::new_simple_literal(source.as_str()),
        ));
    }

    if let Some(rdf_type) = &dataset.rdf_type {
        triples.push(Triple::new(
            dataset_uri.clone(),
            nn(DCT_CONFORMS_TO),
            nn(rdf_type),
        ));
    }

    for dist in &dataset.distributions {
        let filename = dist.destination.rsplit('/').next().unwrap_or(&dist.destination);
        let dist_uri = job_urn("dist", job_id, filename);
        triples.push(Triple::new(
            dataset_uri.clone(),
            nn(DCAT_DISTRIBUTION_PROP),
            dist_uri.clone(),
        ));
        build_distribution_triples(triples, dist, &dist_uri);
    }
}

fn build_distribution_triples(
    triples: &mut Vec<Triple>,
    dist: &DistributionInfo,
    dist_uri: &NamedNode,
) {
    triples.push(Triple::new(dist_uri.clone(), rdf::TYPE, nn(DCAT_DISTRIBUTION)));
    triples.push(Triple::new(
        dist_uri.clone(),
        nn(DCAT_ACCESS_URL),
        nn(&dist.destination),
    ));
    triples.push(Triple::new(
        dist_uri.clone(),
        nn(DCAT_MEDIA_TYPE),
        Literal::new_simple_literal(dist.media_type.as_str()),
    ));
}

fn serialize_triples(triples: &[Triple], format: RdfExportFormat) -> Result<String, String> {
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
        ser = ser.with_prefix(name, iri).map_err(|e| format!("DCAT prefix error: {e}"))?;
    }
    let mut serializer = ser.for_writer(&mut buf);

    for triple in triples {
        serializer
            .serialize_triple(triple)
            .map_err(|e| format!("DCAT serialization error: {e}"))?;
    }

    serializer
        .finish()
        .map_err(|e| format!("DCAT finalize error: {e}"))?;

    let raw = String::from_utf8(buf).map_err(|e| format!("DCAT encoding error: {e}"))?;

    match format {
        RdfExportFormat::Turtle => Ok(raw.replace(".\n<", ".\n\n<")),
        RdfExportFormat::JsonLd => {
            let value: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| format!("DCAT JSON parse error: {e}"))?;
            serde_json::to_string_pretty(&value)
                .map_err(|e| format!("DCAT JSON format error: {e}"))
        }
        _ => Ok(raw),
    }
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

fn encode_uri_component(s: &str) -> String {
    s.replace(' ', "%20")
        .replace('<', "%3C")
        .replace('>', "%3E")
}
