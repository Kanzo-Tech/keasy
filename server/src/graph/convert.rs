use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

use serde::Serialize;

use super::dataset::RdfTriple;
use super::vocab;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub group: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
    pub label: String,
}

const PREFIXES: &[(&str, &str)] = &[
    ("http://www.w3.org/2000/01/rdf-schema#", "rdfs:"),
    ("http://www.w3.org/2004/02/skos/core#", "skos:"),
    ("http://schema.org/", "schema:"),
    ("http://www.w3.org/ns/dcat#", "dcat:"),
    ("http://purl.org/dc/terms/", "dct:"),
    ("http://xmlns.com/foaf/0.1/", "foaf:"),
    ("http://www.w3.org/2006/vcard/ns#", "vcard:"),
    ("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:"),
    ("http://www.w3.org/2001/XMLSchema#", "xsd:"),
];

const LABEL_PROPERTIES: &[&str] = &[
    "http://www.w3.org/2000/01/rdf-schema#label",
    "http://www.w3.org/2004/02/skos/core#prefLabel",
    "http://purl.org/dc/terms/title",
    "http://xmlns.com/foaf/0.1/name",
    "http://schema.org/name",
];

pub fn shorten_iri(iri: &str) -> String {
    for (ns, prefix) in PREFIXES {
        if let Some(local) = iri.strip_prefix(ns) {
            return format!("{}{}", prefix, local);
        }
    }
    if let Some(local) = iri.strip_prefix("urn:keasy:") {
        return local.to_string();
    }
    if let Some((_, frag)) = iri.rsplit_once('#') {
        return frag.to_string();
    }
    if let Some((_, seg)) = iri.rsplit_once('/') {
        return seg.to_string();
    }
    iri.to_string()
}

/// Returns true if the object value looks like a named node (IRI).
fn is_iri(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://") || s.starts_with("urn:")
}

/// Returns true if the triple's object is a literal (not an IRI or blank node).
fn is_literal(triple: &RdfTriple) -> bool {
    !is_iri(&triple.object) && !triple.object.starts_with("_:")
}

fn build_label(id: &str, label_map: &HashMap<String, String>) -> String {
    if let Some(label) = label_map.get(id) {
        return label.clone();
    }
    shorten_iri(id)
}

fn ensure_node(
    nodes: &mut HashMap<String, GraphNode>,
    id: &str,
    label_map: &HashMap<String, String>,
    type_map: &HashMap<String, String>,
    props_map: &mut HashMap<String, BTreeMap<String, String>>,
) {
    nodes.entry(id.to_string()).or_insert_with(|| {
        let label = build_label(id, label_map);
        let group = type_map.get(id).cloned().unwrap_or_else(|| "resource".to_string());
        let properties = props_map.remove(id).unwrap_or_default();
        GraphNode { id: id.to_string(), label, group, properties }
    });
}

pub fn triples_to_graph_data(triples: &[RdfTriple]) -> GraphData {
    // Build type map
    let mut type_map: HashMap<String, String> = HashMap::new();
    for triple in triples {
        if triple.predicate == vocab::RDF_TYPE && is_iri(&triple.object) {
            type_map
                .entry(triple.subject.clone())
                .or_insert_with(|| shorten_iri(&triple.object));
        }
    }

    // Build label and property maps
    let mut label_map: HashMap<String, String> = HashMap::new();
    let mut props_map: HashMap<String, BTreeMap<String, String>> = HashMap::new();

    for triple in triples {
        if LABEL_PROPERTIES.contains(&triple.predicate.as_str()) && is_literal(triple) {
            label_map
                .entry(triple.subject.clone())
                .or_insert_with(|| triple.object.clone());
        }

        if is_literal(triple) {
            props_map
                .entry(triple.subject.clone())
                .or_default()
                .insert(shorten_iri(&triple.predicate), triple.object.clone());
        }
    }

    let mut all_nodes: HashMap<String, GraphNode> = HashMap::new();
    let mut all_links: HashMap<(String, String, String), GraphLink> = HashMap::new();

    for triple in triples {
        let pred = &triple.predicate;
        let subj = &triple.subject;

        if pred == vocab::RDF_TYPE {
            ensure_node(&mut all_nodes, subj, &label_map, &type_map, &mut props_map);
            continue;
        }

        if !is_literal(triple) {
            // Object is IRI or blank node → link
            let obj = &triple.object;
            ensure_node(&mut all_nodes, subj, &label_map, &type_map, &mut props_map);
            ensure_node(&mut all_nodes, obj, &label_map, &type_map, &mut props_map);
            let link_label = shorten_iri(pred);
            all_links
                .entry((subj.clone(), obj.clone(), link_label.clone()))
                .or_insert_with(|| GraphLink {
                    source: subj.clone(),
                    target: obj.clone(),
                    label: link_label,
                });
        } else {
            // Object is a literal → literal node
            ensure_node(&mut all_nodes, subj, &label_map, &type_map, &mut props_map);

            let value = &triple.object;

            let mut hasher = DefaultHasher::new();
            subj.hash(&mut hasher);
            pred.hash(&mut hasher);
            value.hash(&mut hasher);
            let literal_id = format!("literal:{:x}", hasher.finish());

            all_nodes.entry(literal_id.clone()).or_insert_with(|| {
                let label = if value.chars().count() > 40 {
                    let truncated: String = value.chars().take(40).collect();
                    format!("{truncated}...")
                } else {
                    value.clone()
                };

                let mut properties = BTreeMap::new();
                properties.insert("Value".to_string(), value.clone());
                if let Some(ref lang) = triple.object_lang {
                    properties.insert("Language".to_string(), lang.clone());
                }
                if let Some(ref dt) = triple.object_datatype {
                    if dt != "http://www.w3.org/2001/XMLSchema#string" {
                        properties.insert("Datatype".to_string(), shorten_iri(dt));
                    }
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
                    source: subj.clone(),
                    target: literal_id,
                    label: link_label,
                });
        }
    }

    let nodes: Vec<GraphNode> = all_nodes.into_values().collect();
    let links: Vec<GraphLink> = all_links.into_values().collect();

    GraphData { nodes, links }
}
