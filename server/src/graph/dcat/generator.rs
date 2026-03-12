use crate::graph::dataset::RdfTriple;
use crate::graph::format::RdfExportFormat;
use crate::graph::vocab;

use super::types::{DatasetInfo, DcatInput, DistributionInfo};

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

pub fn build_catalog_triples(input: &DcatInput) -> Vec<RdfTriple> {
    let mut triples = Vec::new();

    let catalog = job_urn("catalog", &input.job_id, "");
    let catalog_title = input
        .job_name
        .as_deref()
        .unwrap_or("Keasy Pipeline Output");

    triples.push(triple_ii(&catalog, vocab::RDF_TYPE, DCAT_CATALOG));
    triples.push(triple_il(&catalog, DCT_TITLE, catalog_title));

    if let Some(desc) = &input.org.catalog_description {
        triples.push(triple_il(&catalog, DCT_DESCRIPTION, desc));
    }

    triples.push(triple_ilt(&catalog, DCT_ISSUED, &input.completed_at, XSD_DATETIME));

    let publisher = match &input.org.publisher_uri {
        Some(uri) => uri.clone(),
        None => shared_urn("publisher", &input.org.publisher_name),
    };
    triples.push(triple_ii(&catalog, DCT_PUBLISHER, &publisher));
    triples.push(triple_ii(&publisher, vocab::RDF_TYPE, FOAF_AGENT));
    triples.push(triple_il(&publisher, FOAF_NAME, &input.org.publisher_name));
    if let Some(uri) = &input.org.publisher_uri {
        triples.push(triple_ii(&publisher, FOAF_HOMEPAGE, uri));
    }

    if let Some(email) = &input.org.contact_email {
        let contact = shared_urn("contact", email);
        triples.push(triple_ii(&catalog, DCAT_CONTACT_POINT, &contact));
        triples.push(triple_ii(&contact, vocab::RDF_TYPE, VCARD_KIND));
        triples.push(triple_ii(&contact, VCARD_HAS_EMAIL, &format!("mailto:{email}")));
    }

    if let Some(license) = &input.org.license_uri {
        triples.push(triple_ii(&catalog, DCT_LICENSE, license));
    }

    for dataset in &input.datasets {
        let dataset_uri = job_urn("dataset", &input.job_id, &dataset.type_name);
        triples.push(triple_ii(&catalog, DCAT_DATASET_PROP, &dataset_uri));
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
    triples.push(triple_ii(dataset_uri, vocab::RDF_TYPE, DCAT_DATASET));
    triples.push(triple_il(dataset_uri, DCT_TITLE, &dataset.type_name));

    if let Some(source) = &dataset.source_name {
        triples.push(triple_il(dataset_uri, DCT_SOURCE, source));
    }

    if let Some(rdf_type) = &dataset.rdf_type {
        triples.push(triple_ii(dataset_uri, DCT_CONFORMS_TO, rdf_type));
    }

    for dist in &dataset.distributions {
        let filename = dist.destination.rsplit('/').next().unwrap_or(&dist.destination);
        let dist_uri = job_urn("dist", job_id, filename);
        triples.push(triple_ii(dataset_uri, DCAT_DISTRIBUTION_PROP, &dist_uri));
        build_distribution_triples(triples, dist, &dist_uri);
    }
}

fn build_distribution_triples(
    triples: &mut Vec<RdfTriple>,
    dist: &DistributionInfo,
    dist_uri: &str,
) {
    triples.push(triple_ii(dist_uri, vocab::RDF_TYPE, DCAT_DISTRIBUTION));
    triples.push(triple_ii(dist_uri, DCAT_ACCESS_URL, &dist.destination));
    triples.push(triple_il(dist_uri, DCAT_MEDIA_TYPE, &dist.media_type));
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
