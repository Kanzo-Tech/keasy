use crate::discovery::rdf_graph::RdfGraph;

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

impl GraphProfile {
    pub fn build(graph: &RdfGraph, graph_name: &str) -> Self {
        let triple_count = graph.triple_count(Some(graph_name));
        let subject_count = Self::query_subject_count(graph, graph_name);
        let type_distribution = Self::query_type_distribution(graph, graph_name);
        let predicate_inventory = Self::query_predicate_inventory(graph, graph_name);

        let mut predicates = Vec::new();
        for (pred, total, distinct, is_object) in predicate_inventory {
            let short = shorten_uri(&pred);

            let (min, max, avg) = if !is_object {
                Self::query_numeric_stats(graph, graph_name, &pred)
            } else {
                (None, None, None)
            };

            let is_numeric = min.is_some();

            let top_values = if !is_numeric && !is_object && distinct <= 50 {
                Some(Self::query_top_values(graph, graph_name, &pred))
            } else {
                None
            };

            let samples = if top_values.is_none() && !is_object && !is_numeric {
                Self::query_samples(graph, graph_name, &pred)
            } else {
                Vec::new()
            };

            predicates.push(PredicateStats {
                predicate: pred,
                short_name: short,
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

    fn query_subject_count(graph: &RdfGraph, graph_name: &str) -> usize {
        let sparql = "SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE { ?s ?p ?o }";
        if let Ok(rows) = graph.sparql_solutions_raw(sparql, Some(graph_name)) {
            for row in rows {
                for (var, term) in row {
                    if var == "count"
                        && let oxrdf::Term::Literal(lit) = term
                        && let Ok(n) = lit.value().parse::<usize>()
                    {
                        return n;
                    }
                }
            }
        }
        0
    }

    fn query_type_distribution(graph: &RdfGraph, graph_name: &str) -> Vec<(String, usize)> {
        let sparql = "\
            SELECT ?type (COUNT(DISTINCT ?s) AS ?count) \
            WHERE { ?s a ?type } \
            GROUP BY ?type \
            ORDER BY DESC(?count)";
        let mut result = Vec::new();
        if let Ok(rows) = graph.sparql_solutions_raw(sparql, Some(graph_name)) {
            for row in rows {
                let mut type_iri = String::new();
                let mut count: usize = 0;
                for (var, term) in row {
                    match var.as_str() {
                        "type" => {
                            if let oxrdf::Term::NamedNode(n) = term {
                                type_iri = n.as_str().to_string();
                            }
                        }
                        "count" => {
                            if let oxrdf::Term::Literal(lit) = term {
                                count = lit.value().parse().unwrap_or(0);
                            }
                        }
                        _ => {}
                    }
                }
                if !type_iri.is_empty() {
                    result.push((type_iri, count));
                }
            }
        }
        result
    }

    /// Returns (predicate_uri, total_count, distinct_count, is_object_property).
    fn query_predicate_inventory(
        graph: &RdfGraph,
        graph_name: &str,
    ) -> Vec<(String, usize, usize, bool)> {
        let sparql = "\
            SELECT ?p (COUNT(*) AS ?total) (COUNT(DISTINCT ?o) AS ?distinct) \
            WHERE { ?s ?p ?o \
            FILTER(?p != <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>) } \
            GROUP BY ?p \
            ORDER BY DESC(?total)";
        let mut result = Vec::new();
        if let Ok(rows) = graph.sparql_solutions_raw(sparql, Some(graph_name)) {
            for row in rows {
                let mut pred = String::new();
                let mut total: usize = 0;
                let mut distinct: usize = 0;
                for (var, term) in &row {
                    match var.as_str() {
                        "p" => {
                            if let oxrdf::Term::NamedNode(n) = term {
                                pred = n.as_str().to_string();
                            }
                        }
                        "total" => {
                            if let oxrdf::Term::Literal(lit) = term {
                                total = lit.value().parse().unwrap_or(0);
                            }
                        }
                        "distinct" => {
                            if let oxrdf::Term::Literal(lit) = term {
                                distinct = lit.value().parse().unwrap_or(0);
                            }
                        }
                        _ => {}
                    }
                }
                if !pred.is_empty() {
                    let is_object = Self::check_is_object_property(graph, graph_name, &pred);
                    result.push((pred, total, distinct, is_object));
                }
            }
        }
        result
    }

    fn check_is_object_property(graph: &RdfGraph, graph_name: &str, pred: &str) -> bool {
        let sparql = format!(
            "SELECT ?o WHERE {{ ?s <{pred}> ?o }} LIMIT 1"
        );
        if let Ok(rows) = graph.sparql_solutions_raw(&sparql, Some(graph_name))
            && let Some(row) = rows.into_iter().next()
            && let Some((_, term)) = row.into_iter().next()
        {
            return matches!(term, oxrdf::Term::NamedNode(_) | oxrdf::Term::BlankNode(_));
        }
        false
    }

    fn query_numeric_stats(
        graph: &RdfGraph,
        graph_name: &str,
        pred: &str,
    ) -> (Option<f64>, Option<f64>, Option<f64>) {
        let sparql = format!(
            "SELECT (MIN(xsd:double(?o)) AS ?min) (MAX(xsd:double(?o)) AS ?max) \
                    (AVG(xsd:double(?o)) AS ?avg) \
             WHERE {{ ?s <{pred}> ?o }}"
        );
        if let Ok(rows) = graph.sparql_solutions_raw(&sparql, Some(graph_name)) {
            for row in rows {
                let mut min = None;
                let mut max = None;
                let mut avg = None;
                for (var, term) in row {
                    if let oxrdf::Term::Literal(lit) = &term {
                        let val = lit.value().parse::<f64>().ok();
                        match var.as_str() {
                            "min" => min = val,
                            "max" => max = val,
                            "avg" => avg = val,
                            _ => {}
                        }
                    }
                }
                if min.is_some() || max.is_some() {
                    return (min, max, avg);
                }
            }
        }
        (None, None, None)
    }

    fn query_top_values(graph: &RdfGraph, graph_name: &str, pred: &str) -> Vec<(String, usize)> {
        let sparql = format!(
            "SELECT (STR(?o) AS ?val) (COUNT(*) AS ?cnt) \
             WHERE {{ ?s <{pred}> ?o }} \
             GROUP BY ?o \
             ORDER BY DESC(?cnt) \
             LIMIT 10"
        );
        let mut result = Vec::new();
        if let Ok(rows) = graph.sparql_solutions_raw(&sparql, Some(graph_name)) {
            for row in rows {
                let mut val = String::new();
                let mut cnt: usize = 0;
                for (var, term) in row {
                    match var.as_str() {
                        "val" => {
                            if let oxrdf::Term::Literal(lit) = term {
                                val = lit.value().to_string();
                            }
                        }
                        "cnt" => {
                            if let oxrdf::Term::Literal(lit) = term {
                                cnt = lit.value().parse().unwrap_or(0);
                            }
                        }
                        _ => {}
                    }
                }
                if !val.is_empty() {
                    result.push((val, cnt));
                }
            }
        }
        result
    }

    fn query_samples(graph: &RdfGraph, graph_name: &str, pred: &str) -> Vec<String> {
        let sparql = format!(
            "SELECT DISTINCT (STR(?o) AS ?val) \
             WHERE {{ ?s <{pred}> ?o }} \
             LIMIT 5"
        );
        let mut result = Vec::new();
        if let Ok(rows) = graph.sparql_solutions_raw(&sparql, Some(graph_name)) {
            for row in rows {
                for (var, term) in row {
                    if var == "val"
                        && let oxrdf::Term::Literal(lit) = term
                    {
                        result.push(lit.value().to_string());
                    }
                }
            }
        }
        result
    }
}

fn shorten_uri(uri: &str) -> String {
    const PREFIXES: &[(&str, &str)] = &[
        ("http://schema.org/", "schema:"),
        ("http://www.w3.org/ns/dcat#", "dcat:"),
        ("http://purl.org/dc/terms/", "dct:"),
        ("http://xmlns.com/foaf/0.1/", "foaf:"),
        ("http://www.w3.org/2006/vcard/ns#", "vcard:"),
        ("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:"),
        ("http://www.w3.org/2001/XMLSchema#", "xsd:"),
        ("http://www.w3.org/2000/01/rdf-schema#", "rdfs:"),
        ("http://www.w3.org/2002/07/owl#", "owl:"),
        ("http://www.w3.org/ns/org#", "org:"),
        ("http://www.w3.org/ns/adms#", "adms:"),
        ("http://www.w3.org/2004/02/skos/core#", "skos:"),
    ];
    for (full, short) in PREFIXES {
        if let Some(local) = uri.strip_prefix(full) {
            return format!("{short}{local}");
        }
    }
    // Fall back to last segment
    uri.rsplit_once('/').or_else(|| uri.rsplit_once('#'))
        .map(|(_, local)| local.to_string())
        .unwrap_or_else(|| uri.to_string())
}
