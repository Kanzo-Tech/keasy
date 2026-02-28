use super::dcat_types::{DatasetInfo, DcatInput, DistributionInfo};
use super::graph_store::GraphStore;
use super::graph_types::{KeasyTriple, TermValue};
use super::rdf_format::RdfExportFormat;
use super::rdf_graph::RdfGraph;

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

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

fn iri(s: &str) -> TermValue {
    TermValue::Iri(s.to_string())
}

fn literal(s: &str) -> TermValue {
    TermValue::Literal {
        value: s.to_string(),
        datatype: None,
        language: None,
    }
}

fn typed_literal(value: &str, datatype: &str) -> TermValue {
    TermValue::Literal {
        value: value.to_string(),
        datatype: Some(datatype.to_string()),
        language: None,
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

pub fn build_catalog_triples(input: &DcatInput) -> Vec<KeasyTriple> {
    let mut triples = Vec::new();

    let catalog = job_urn("catalog", &input.job_id, "");
    let catalog_title = input
        .job_name
        .as_deref()
        .unwrap_or("Keasy Pipeline Output");

    triples.push(KeasyTriple {
        subject: iri(&catalog),
        predicate: RDF_TYPE.to_string(),
        object: iri(DCAT_CATALOG),
    });
    triples.push(KeasyTriple {
        subject: iri(&catalog),
        predicate: DCT_TITLE.to_string(),
        object: literal(catalog_title),
    });

    if let Some(desc) = &input.org.catalog_description {
        triples.push(KeasyTriple {
            subject: iri(&catalog),
            predicate: DCT_DESCRIPTION.to_string(),
            object: literal(desc),
        });
    }

    triples.push(KeasyTriple {
        subject: iri(&catalog),
        predicate: DCT_ISSUED.to_string(),
        object: typed_literal(&input.completed_at, XSD_DATETIME),
    });

    let publisher = match &input.org.publisher_uri {
        Some(uri) => uri.clone(),
        None => shared_urn("publisher", &input.org.publisher_name),
    };
    triples.push(KeasyTriple {
        subject: iri(&catalog),
        predicate: DCT_PUBLISHER.to_string(),
        object: iri(&publisher),
    });
    triples.push(KeasyTriple {
        subject: iri(&publisher),
        predicate: RDF_TYPE.to_string(),
        object: iri(FOAF_AGENT),
    });
    triples.push(KeasyTriple {
        subject: iri(&publisher),
        predicate: FOAF_NAME.to_string(),
        object: literal(&input.org.publisher_name),
    });
    if let Some(uri) = &input.org.publisher_uri {
        triples.push(KeasyTriple {
            subject: iri(&publisher),
            predicate: FOAF_HOMEPAGE.to_string(),
            object: iri(uri),
        });
    }

    if let Some(email) = &input.org.contact_email {
        let contact = shared_urn("contact", email);
        triples.push(KeasyTriple {
            subject: iri(&catalog),
            predicate: DCAT_CONTACT_POINT.to_string(),
            object: iri(&contact),
        });
        triples.push(KeasyTriple {
            subject: iri(&contact),
            predicate: RDF_TYPE.to_string(),
            object: iri(VCARD_KIND),
        });
        triples.push(KeasyTriple {
            subject: iri(&contact),
            predicate: VCARD_HAS_EMAIL.to_string(),
            object: iri(&format!("mailto:{email}")),
        });
    }

    if let Some(license) = &input.org.license_uri {
        triples.push(KeasyTriple {
            subject: iri(&catalog),
            predicate: DCT_LICENSE.to_string(),
            object: iri(license),
        });
    }

    for dataset in &input.datasets {
        let dataset_uri = job_urn("dataset", &input.job_id, &dataset.type_name);
        triples.push(KeasyTriple {
            subject: iri(&catalog),
            predicate: DCAT_DATASET_PROP.to_string(),
            object: iri(&dataset_uri),
        });
        build_dataset_triples(&mut triples, dataset, &input.job_id, &dataset_uri);
    }

    triples
}

fn build_dataset_triples(
    triples: &mut Vec<KeasyTriple>,
    dataset: &DatasetInfo,
    job_id: &str,
    dataset_uri: &str,
) {
    triples.push(KeasyTriple {
        subject: iri(dataset_uri),
        predicate: RDF_TYPE.to_string(),
        object: iri(DCAT_DATASET),
    });
    triples.push(KeasyTriple {
        subject: iri(dataset_uri),
        predicate: DCT_TITLE.to_string(),
        object: literal(&dataset.type_name),
    });

    if let Some(source) = &dataset.source_name {
        triples.push(KeasyTriple {
            subject: iri(dataset_uri),
            predicate: DCT_SOURCE.to_string(),
            object: literal(source),
        });
    }

    if let Some(rdf_type) = &dataset.rdf_type {
        triples.push(KeasyTriple {
            subject: iri(dataset_uri),
            predicate: DCT_CONFORMS_TO.to_string(),
            object: iri(rdf_type),
        });
    }

    for dist in &dataset.distributions {
        let filename = dist.destination.rsplit('/').next().unwrap_or(&dist.destination);
        let dist_uri = job_urn("dist", job_id, filename);
        triples.push(KeasyTriple {
            subject: iri(dataset_uri),
            predicate: DCAT_DISTRIBUTION_PROP.to_string(),
            object: iri(&dist_uri),
        });
        build_distribution_triples(triples, dist, &dist_uri);
    }
}

fn build_distribution_triples(
    triples: &mut Vec<KeasyTriple>,
    dist: &DistributionInfo,
    dist_uri: &str,
) {
    triples.push(KeasyTriple {
        subject: iri(dist_uri),
        predicate: RDF_TYPE.to_string(),
        object: iri(DCAT_DISTRIBUTION),
    });
    triples.push(KeasyTriple {
        subject: iri(dist_uri),
        predicate: DCAT_ACCESS_URL.to_string(),
        object: iri(&dist.destination),
    });
    triples.push(KeasyTriple {
        subject: iri(dist_uri),
        predicate: DCAT_MEDIA_TYPE.to_string(),
        object: literal(&dist.media_type),
    });
}

fn serialize_triples(triples: &[KeasyTriple], format: RdfExportFormat) -> Result<String, String> {
    let graph = RdfGraph::new();
    graph.insert_triples(None, triples);
    graph.serialize_to_format(format)
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
