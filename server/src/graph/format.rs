use oxrdfio::RdfFormat;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RdfExportFormat {
    Turtle,
    RdfXml,
    NTriples,
    NQuads,
}

impl RdfExportFormat {
    pub fn from_name(name: &str) -> Result<Self, String> {
        match name.to_ascii_lowercase().as_str() {
            "turtle" | "ttl" => Ok(Self::Turtle),
            "rdfxml" | "rdf-xml" | "xml" => Ok(Self::RdfXml),
            "ntriples" | "nt" | "n-triples" => Ok(Self::NTriples),
            "nquads" | "nq" | "n-quads" => Ok(Self::NQuads),
            "jsonld" | "json-ld" => Err("JSON-LD serialization is not supported. Use turtle, rdfxml, ntriples, or nquads".into()),
            other => Err(format!(
                "Unknown RDF format: '{other}'. Supported: turtle, rdfxml, ntriples, nquads"
            )),
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Turtle => "text/turtle",
            Self::RdfXml => "application/rdf+xml",
            Self::NTriples => "application/n-triples",
            Self::NQuads => "application/n-quads",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            Self::Turtle => "ttl",
            Self::RdfXml => "rdf",
            Self::NTriples => "nt",
            Self::NQuads => "nq",
        }
    }

    pub fn to_rdf_format(self) -> RdfFormat {
        match self {
            Self::Turtle => RdfFormat::Turtle,
            Self::RdfXml => RdfFormat::RdfXml,
            Self::NTriples => RdfFormat::NTriples,
            Self::NQuads => RdfFormat::NQuads,
        }
    }
}
