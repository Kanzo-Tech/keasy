use oxrdfio::{JsonLdProfileSet, RdfFormat};

#[derive(Debug, Clone, Copy)]
pub enum RdfExportFormat {
    Turtle,
    JsonLd,
    RdfXml,
    NTriples,
    NQuads,
}

impl RdfExportFormat {
    pub fn from_name(name: &str) -> Result<Self, String> {
        match name.to_ascii_lowercase().as_str() {
            "turtle" | "ttl" => Ok(Self::Turtle),
            "jsonld" | "json-ld" => Ok(Self::JsonLd),
            "rdfxml" | "rdf-xml" | "xml" => Ok(Self::RdfXml),
            "ntriples" | "nt" | "n-triples" => Ok(Self::NTriples),
            "nquads" | "nq" | "n-quads" => Ok(Self::NQuads),
            other => Err(format!(
                "Unknown RDF format: '{other}'. Supported: turtle, jsonld, rdfxml, ntriples, nquads"
            )),
        }
    }

    pub fn to_rdf_format(self) -> RdfFormat {
        match self {
            Self::Turtle => RdfFormat::Turtle,
            Self::JsonLd => RdfFormat::JsonLd {
                profile: JsonLdProfileSet::empty(),
            },
            Self::RdfXml => RdfFormat::RdfXml,
            Self::NTriples => RdfFormat::NTriples,
            Self::NQuads => RdfFormat::NQuads,
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Turtle => "text/turtle",
            Self::JsonLd => "application/ld+json",
            Self::RdfXml => "application/rdf+xml",
            Self::NTriples => "application/n-triples",
            Self::NQuads => "application/n-quads",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            Self::Turtle => "ttl",
            Self::JsonLd => "jsonld",
            Self::RdfXml => "rdf",
            Self::NTriples => "nt",
            Self::NQuads => "nq",
        }
    }
}
