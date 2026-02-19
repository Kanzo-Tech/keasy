use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

use oxigraph::model::Quad;
use oxrdf::Term;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub group: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
    pub label: String,
}

/// Namespace prefixes for shortening IRIs in labels.
const PREFIXES: &[(&str, &str)] = &[
    ("http://www.w3.org/2000/01/rdf-schema#", "rdfs:"),
    ("http://www.w3.org/2004/02/skos/core#", "skos:"),
    ("http://schema.org/", "schema:"),
    ("http://www.w3.org/ns/dcat#", "dcat:"),
    ("http://purl.org/dc/terms/", "dct:"),
    ("http://xmlns.com/foaf/0.1/", "foaf:"),
    ("http://www.w3.org/2006/vcard/ns#", "vcard:"),
    ("http://www.w3.org/ns/shacl#", "sh:"),
    ("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:"),
    ("http://www.w3.org/2001/XMLSchema#", "xsd:"),
];

/// Properties whose literal values become the node label.
const LABEL_PROPERTIES: &[&str] = &[
    "http://www.w3.org/2000/01/rdf-schema#label",
    "http://www.w3.org/2004/02/skos/core#prefLabel",
    "http://purl.org/dc/terms/title",
    "http://xmlns.com/foaf/0.1/name",
    "http://schema.org/name",
];

/// Strip `<>` brackets from oxrdf `Display` output (e.g. `<urn:foo>` → `urn:foo`).
fn clean_id(s: &str) -> String {
    s.strip_prefix('<')
        .and_then(|inner| inner.strip_suffix('>'))
        .unwrap_or(s)
        .to_string()
}

pub fn shorten_iri(iri: &str) -> String {
    for (ns, prefix) in PREFIXES {
        if let Some(local) = iri.strip_prefix(ns) {
            return format!("{}{}", prefix, local);
        }
    }
    // Shorten keasy URNs: urn:keasy:catalog:abc → catalog:abc
    if let Some(local) = iri.strip_prefix("urn:keasy:") {
        return local.to_string();
    }
    // Fallback: take the fragment or last path segment
    if let Some((_, frag)) = iri.rsplit_once('#') {
        return frag.to_string();
    }
    if let Some((_, seg)) = iri.rsplit_once('/') {
        return seg.to_string();
    }
    iri.to_string()
}

/// Convert a set of quads into a graph visualization structure.
///
/// - rdf:type triples determine the node group (shortened IRI, e.g. "dcat:Catalog")
/// - Label properties set the display label but still generate literal nodes
/// - ALL literals become visible literal nodes with links (no suppression)
/// - ALL URI-to-URI triples become links between nodes
pub fn quads_to_graph_data(quads: &[Quad]) -> GraphData {
    let rdf_type = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

    // Pass 1: classify nodes via rdf:type
    let mut type_map: HashMap<String, String> = HashMap::new();
    for quad in quads {
        if quad.predicate.as_str() == rdf_type {
            if let Term::NamedNode(obj) = &quad.object {
                let subj = clean_id(&quad.subject.to_string());
                type_map
                    .entry(subj)
                    .or_insert_with(|| shorten_iri(obj.as_str()));
            }
        }
    }

    // Pass 2: collect labels and all literal properties
    let mut label_map: HashMap<String, String> = HashMap::new();
    let mut props_map: HashMap<String, BTreeMap<String, String>> = HashMap::new();

    for quad in quads {
        let pred = quad.predicate.as_str();
        let subj = clean_id(&quad.subject.to_string());

        // Label properties
        if LABEL_PROPERTIES.contains(&pred) {
            if let Term::Literal(lit) = &quad.object {
                label_map
                    .entry(subj.clone())
                    .or_insert_with(|| lit.value().to_string());
            }
        }

        // ALL literals go into properties for tooltip display
        if let Term::Literal(lit) = &quad.object {
            props_map
                .entry(subj)
                .or_default()
                .insert(shorten_iri(pred), lit.value().to_string());
        }
    }

    // Pass 3: build nodes and links (deduplicated via HashMaps)
    let mut all_nodes: HashMap<String, GraphNode> = HashMap::new();
    let mut all_links: HashMap<(String, String, String), GraphLink> = HashMap::new();

    for quad in quads {
        let pred = quad.predicate.as_str();
        let subj = clean_id(&quad.subject.to_string());

        // rdf:type — already handled in pass 1, just register node
        if pred == rdf_type {
            all_nodes.entry(subj.clone()).or_insert_with(|| {
                let label = label_map
                    .get(&subj)
                    .cloned()
                    .unwrap_or_else(|| shorten_iri(&subj));
                let group = type_map
                    .get(&subj)
                    .cloned()
                    .unwrap_or_else(|| "resource".to_string());
                let properties = props_map.remove(&subj).unwrap_or_default();
                GraphNode { id: subj.clone(), label, group, properties }
            });
            continue;
        }

        match &quad.object {
            Term::NamedNode(obj) => {
                let obj_iri = obj.as_str().to_string();
                // Ensure both resource nodes exist
                all_nodes.entry(subj.clone()).or_insert_with(|| {
                    let label = label_map
                        .get(&subj)
                        .cloned()
                        .unwrap_or_else(|| shorten_iri(&subj));
                    let group = type_map
                        .get(&subj)
                        .cloned()
                        .unwrap_or_else(|| "resource".to_string());
                    let properties = props_map.remove(&subj).unwrap_or_default();
                    GraphNode { id: subj.clone(), label, group, properties }
                });
                all_nodes.entry(obj_iri.clone()).or_insert_with(|| {
                    let label = label_map
                        .get(&obj_iri)
                        .cloned()
                        .unwrap_or_else(|| shorten_iri(&obj_iri));
                    let group = type_map
                        .get(&obj_iri)
                        .cloned()
                        .unwrap_or_else(|| "resource".to_string());
                    let properties = props_map.remove(&obj_iri).unwrap_or_default();
                    GraphNode { id: obj_iri.clone(), label, group, properties }
                });
                let link_label = shorten_iri(pred);
                all_links
                    .entry((subj.clone(), obj_iri.clone(), link_label.clone()))
                    .or_insert_with(|| GraphLink {
                        source: subj,
                        target: obj_iri,
                        label: link_label,
                    });
            }
            Term::Literal(lit) => {
                // Ensure subject node exists
                all_nodes.entry(subj.clone()).or_insert_with(|| {
                    let label = label_map
                        .get(&subj)
                        .cloned()
                        .unwrap_or_else(|| shorten_iri(&subj));
                    let group = type_map
                        .get(&subj)
                        .cloned()
                        .unwrap_or_else(|| "resource".to_string());
                    let properties = props_map.remove(&subj).unwrap_or_default();
                    GraphNode { id: subj.clone(), label, group, properties }
                });

                let value = lit.value().to_string();

                let mut hasher = DefaultHasher::new();
                subj.hash(&mut hasher);
                pred.hash(&mut hasher);
                value.hash(&mut hasher);
                let literal_id = format!("literal:{:x}", hasher.finish());

                // Deduplicated literal node
                all_nodes.entry(literal_id.clone()).or_insert_with(|| {
                    let label = if value.chars().count() > 40 {
                        let truncated: String = value.chars().take(40).collect();
                        format!("{truncated}...")
                    } else {
                        value.clone()
                    };

                    let mut properties = BTreeMap::new();
                    properties.insert("Value".to_string(), value.clone());
                    if let Some(lang) = lit.language() {
                        properties.insert("Language".to_string(), lang.to_string());
                    }
                    let datatype = lit.datatype().as_str();
                    if datatype != "http://www.w3.org/2001/XMLSchema#string" {
                        properties.insert("Datatype".to_string(), shorten_iri(datatype));
                    }

                    GraphNode {
                        id: literal_id.clone(),
                        label,
                        group: "literal".to_string(),
                        properties,
                    }
                });

                let link_label = shorten_iri(pred);
                all_links
                    .entry((subj.clone(), literal_id.clone(), link_label.clone()))
                    .or_insert_with(|| GraphLink {
                        source: subj,
                        target: literal_id,
                        label: link_label,
                    });
            }
            _ => {}
        }
    }

    let nodes: Vec<GraphNode> = all_nodes.into_values().collect();
    let links: Vec<GraphLink> = all_links.into_values().collect();

    GraphData { nodes, links }
}
