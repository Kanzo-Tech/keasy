use oxrdf::Triple;
use oxrdfio::{RdfFormat, RdfParser};

/// Detect RDF format from a file path extension.
fn rdf_format_from_path(path: &str) -> Option<RdfFormat> {
    let ext = path.rsplit('.').next()?;
    RdfFormat::from_extension(ext)
}

/// Parse RDF content bytes into triples.
///
/// The `path` is used only to detect the format from the file extension.
/// Returns the parsed triples or an error message.
pub fn parse_rdf_to_triples(content: &[u8], path: &str) -> Result<Vec<Triple>, String> {
    let format = rdf_format_from_path(path)
        .unwrap_or(RdfFormat::Turtle);

    let parser = RdfParser::from_format(format);
    let mut triples = Vec::new();

    for result in parser.for_slice(content) {
        let quad = result.map_err(|e| format!("RDF parse error: {e}"))?;
        triples.push(Triple::new(quad.subject, quad.predicate, quad.object));
    }

    Ok(triples)
}
