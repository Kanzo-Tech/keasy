use oxrdfio::{RdfFormat, RdfParser};

use super::graph_types::{KeasyTriple, TermValue};

fn rdf_format_from_path(path: &str) -> Option<RdfFormat> {
    let ext = path.rsplit('.').next()?;
    RdfFormat::from_extension(ext)
}

fn oxrdf_term_to_term_value(term: oxrdf::Term) -> TermValue {
    match term {
        oxrdf::Term::NamedNode(n) => TermValue::Iri(n.into_string()),
        oxrdf::Term::BlankNode(b) => TermValue::BlankNode(b.into_string()),
        oxrdf::Term::Literal(lit) => {
            let language = lit.language().map(|l| l.to_string());
            let datatype = if language.is_none() {
                let dt = lit.datatype().as_str();
                if dt == "http://www.w3.org/2001/XMLSchema#string" {
                    None
                } else {
                    Some(dt.to_string())
                }
            } else {
                None
            };
            TermValue::Literal {
                value: lit.value().to_string(),
                datatype,
                language,
            }
        }
        #[allow(unreachable_patterns)]
        _ => TermValue::Iri(term.to_string()),
    }
}

fn oxrdf_subject_to_term_value(subject: oxrdf::NamedOrBlankNode) -> TermValue {
    match subject {
        oxrdf::NamedOrBlankNode::NamedNode(n) => TermValue::Iri(n.into_string()),
        oxrdf::NamedOrBlankNode::BlankNode(b) => TermValue::BlankNode(b.into_string()),
        #[allow(unreachable_patterns)]
        _ => TermValue::Iri(subject.to_string()),
    }
}

pub fn parse_rdf_to_triples(content: &[u8], path: &str) -> Result<Vec<KeasyTriple>, String> {
    let format = rdf_format_from_path(path)
        .unwrap_or(RdfFormat::Turtle);

    let parser = RdfParser::from_format(format);
    let mut triples = Vec::new();

    for result in parser.for_slice(content) {
        let quad = result.map_err(|e| format!("RDF parse error: {e}"))?;
        triples.push(KeasyTriple {
            subject: oxrdf_subject_to_term_value(quad.subject),
            predicate: quad.predicate.into_string(),
            object: oxrdf_term_to_term_value(quad.object),
        });
    }

    Ok(triples)
}
