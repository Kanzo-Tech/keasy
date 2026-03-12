use std::collections::{BTreeMap, HashMap, HashSet};

use crate::graph::convert::shorten_iri;
use crate::graph::dataset::{Dataset, RdfTriple};
use crate::graph::vocab::RDF_TYPE;

#[derive(Debug, Clone)]
pub struct PredicateStats {
    pub predicate: String,
    pub short_name: String,
    pub count: usize,
    pub distinct: usize,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub avg: Option<f64>,
    pub samples: Vec<String>,
    pub top_values: Option<Vec<(String, usize)>>,
    pub is_object_property: bool,
}

#[derive(Debug, Clone)]
pub struct GraphProfile {
    pub graph_name: String,
    pub triple_count: usize,
    pub subject_count: usize,
    pub type_distribution: Vec<(String, usize)>,
    pub predicates: Vec<PredicateStats>,
}

/// Returns true if the object value looks like a named node (IRI) or blank node.
fn is_resource(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://") || s.starts_with("urn:") || s.starts_with("_:")
}

impl GraphProfile {
    /// Build a profile by scanning all triples in a dataset.
    pub fn build_from_dataset(ds: &dyn Dataset, graph_name: &str) -> Self {
        let all_triples: Vec<RdfTriple> = ds.triples(None, None, None).collect();
        Self::build_from_triples(&all_triples, graph_name)
    }

    pub fn build_from_triples(triples: &[RdfTriple], graph_name: &str) -> Self {
        let triple_count = triples.len();

        // Count unique subjects
        let subjects: HashSet<&str> = triples.iter().map(|t| t.subject.as_str()).collect();
        let subject_count = subjects.len();

        // Type distribution: count distinct subjects per rdf:type
        let mut type_counts: BTreeMap<String, HashSet<String>> = BTreeMap::new();
        for t in triples {
            if t.predicate == RDF_TYPE && is_resource(&t.object) {
                type_counts
                    .entry(t.object.clone())
                    .or_default()
                    .insert(t.subject.clone());
            }
        }
        let mut type_distribution: Vec<(String, usize)> = type_counts
            .into_iter()
            .map(|(ty, subs)| (ty, subs.len()))
            .collect();
        type_distribution.sort_by(|a, b| b.1.cmp(&a.1));

        // Predicate inventory: group triples by predicate (excluding rdf:type)
        let mut pred_triples: BTreeMap<String, Vec<&RdfTriple>> = BTreeMap::new();
        for t in triples {
            if t.predicate != RDF_TYPE {
                pred_triples.entry(t.predicate.clone()).or_default().push(t);
            }
        }

        let mut predicates = Vec::new();
        // Sort by count descending
        let mut pred_entries: Vec<_> = pred_triples.into_iter().collect();
        pred_entries.sort_by(|a, b| b.1.len().cmp(&a.1.len()));

        for (pred, group) in pred_entries {
            let total = group.len();
            let distinct_values: HashSet<&str> = group.iter().map(|t| t.object.as_str()).collect();
            let distinct = distinct_values.len();

            // Check if this is an object property (first value is IRI/blank node)
            let is_object = group.first().is_some_and(|t| is_resource(&t.object));

            // Numeric stats
            let (min, max, avg) = if !is_object {
                compute_numeric_stats(&group)
            } else {
                (None, None, None)
            };

            let is_numeric = min.is_some();

            // Top values (for categorical literals with <= 50 distinct values)
            let top_values = if !is_numeric && !is_object && distinct <= 50 {
                Some(compute_top_values(&group))
            } else {
                None
            };

            // Samples (for non-numeric, non-categorical literals)
            let samples = if top_values.is_none() && !is_object && !is_numeric {
                group.iter().map(|t| t.object.as_str()).collect::<HashSet<_>>()
                    .into_iter().take(5).map(String::from).collect()
            } else {
                Vec::new()
            };

            predicates.push(PredicateStats {
                short_name: shorten_iri(&pred),
                predicate: pred,
                count: total,
                distinct,
                min,
                max,
                avg,
                samples,
                top_values,
                is_object_property: is_object,
            });
        }

        GraphProfile {
            graph_name: graph_name.to_string(),
            triple_count,
            subject_count,
            type_distribution,
            predicates,
        }
    }
}

fn compute_numeric_stats(triples: &[&RdfTriple]) -> (Option<f64>, Option<f64>, Option<f64>) {
    let mut values = Vec::new();
    for t in triples {
        if let Ok(v) = t.object.parse::<f64>() {
            if v.is_finite() {
                values.push(v);
            }
        }
    }
    if values.is_empty() {
        return (None, None, None);
    }
    let min = values.iter().copied().reduce(f64::min);
    let max = values.iter().copied().reduce(f64::max);
    let avg = Some(values.iter().sum::<f64>() / values.len() as f64);
    (min, max, avg)
}

fn compute_top_values(triples: &[&RdfTriple]) -> Vec<(String, usize)> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for t in triples {
        *counts.entry(t.object.as_str()).or_default() += 1;
    }
    let mut sorted: Vec<(String, usize)> = counts
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted.truncate(10);
    sorted
}

