use std::fmt::Write;

use crate::ai::profiler::GraphProfile;
use crate::jobs::PipelineSummary;

const MAX_CHARS: usize = 24_000;

pub fn build_semantic_context(pipeline: &PipelineSummary, profile: &GraphProfile) -> String {
    let mut ctx = String::with_capacity(MAX_CHARS);
    let mut budget = MAX_CHARS;

    // Section 1: Schema — types, fields, rdf_type, xsd, optionality
    let schema_section = build_schema_section(pipeline);
    write_section(&mut ctx, &mut budget, &schema_section);

    // Section 2: Data Statistics — per-predicate stats from GraphProfile
    let stats_section = build_stats_section(profile);
    write_section(&mut ctx, &mut budget, &stats_section);

    // Section 3: Graph Summary — triple count, subject count, type distribution
    let summary_section = build_graph_summary(profile);
    write_section(&mut ctx, &mut budget, &summary_section);

    // Section 4: Vocabulary Hints — auto-detected well-known namespaces
    let vocab_section = build_vocab_hints(profile);
    write_section(&mut ctx, &mut budget, &vocab_section);

    // Section 5: SPARQL Tips
    let tips_section = build_sparql_tips();
    write_section(&mut ctx, &mut budget, &tips_section);

    ctx
}

fn write_section(ctx: &mut String, budget: &mut usize, section: &str) {
    if section.is_empty() || *budget == 0 {
        return;
    }
    let to_write = section.len().min(*budget);
    ctx.push_str(&section[..to_write]);
    *budget = budget.saturating_sub(to_write);
}

fn build_schema_section(pipeline: &PipelineSummary) -> String {
    let mut out = String::new();

    // Data sources
    if !pipeline.inputs.is_empty() {
        let _ = writeln!(out, "## Data Sources");
        for src in &pipeline.inputs {
            let _ = writeln!(out, "  Source: {}", src.name);
            if !src.fields.is_empty() {
                let field_names: Vec<&str> = src.fields.iter().map(|f| f.name.as_str()).collect();
                let _ = writeln!(out, "    Fields: {}", field_names.join(", "));
            }
        }
        let _ = writeln!(out);
    }

    // Joins
    let join_ops: Vec<_> = pipeline
        .operations
        .iter()
        .filter(|op| op.kind == "join")
        .collect();
    if !join_ops.is_empty() {
        let _ = writeln!(out, "## Joins");
        for op in &join_ops {
            let left = op
                .inputs
                .first()
                .map(|i| i.source.as_str())
                .unwrap_or("?");
            let right = op.inputs.get(1).map(|i| i.source.as_str()).unwrap_or("?");
            let left_on = op
                .inputs
                .first()
                .map(|i| &i.key_fields)
                .cloned()
                .unwrap_or_default();
            let right_on = op
                .inputs
                .get(1)
                .map(|i| &i.key_fields)
                .cloned()
                .unwrap_or_default();
            let on_clause: Vec<String> = left_on
                .iter()
                .zip(right_on.iter())
                .map(|(l, r)| format!("{l} = {r}"))
                .collect();
            let _ = writeln!(
                out,
                "  {} {} {} ON {}",
                left,
                op.label,
                right,
                on_clause.join(", ")
            );
        }
        let _ = writeln!(out);
    }

    // Output types — show ALL outputs with rdf_type, not just ones with fields
    let (ref_types, regular_outputs): (Vec<_>, Vec<_>) = pipeline
        .outputs
        .iter()
        .partition(|o| o.fields.is_empty() && o.rdf_type.is_some());

    if !regular_outputs.is_empty() {
        let _ = writeln!(out, "## Output Types");
        for output in &regular_outputs {
            let rdf_suffix = output
                .rdf_type
                .as_deref()
                .map(|r| format!(" [rdf:type = <{r}>]"))
                .unwrap_or_default();
            let _ = writeln!(out, "\nType: {}{}", output.type_name, rdf_suffix);
            for field in &output.fields {
                let opt_marker = if field.optional { "?" } else { "" };
                let req_label = if field.optional {
                    " (optional)"
                } else {
                    " (required)"
                };
                let xsd_suffix = field
                    .xsd_datatype
                    .as_deref()
                    .map(|x| format!(" [{}]", shorten_xsd(x)))
                    .unwrap_or_default();
                match &field.uri {
                    Some(u) => {
                        let _ = writeln!(
                            out,
                            "  - {}: {}{}{} → <{}>{}",
                            field.name, field.field_type, opt_marker, req_label, u, xsd_suffix
                        );
                    }
                    None => {
                        let _ = writeln!(
                            out,
                            "  - {}: {}{}{}{}",
                            field.name, field.field_type, opt_marker, req_label, xsd_suffix
                        );
                    }
                }
            }
            if !output.mappings.is_empty() {
                let _ = writeln!(out, "  Mappings (source field → output field):");
                for m in &output.mappings {
                    let _ = writeln!(out, "    {} ← {}", m.target, m.source);
                }
            }
        }
        let _ = writeln!(out);
    }

    if !ref_types.is_empty() {
        let _ = writeln!(out, "## Reference Types (cross-reference nodes)");
        let _ = writeln!(
            out,
            "These nodes only have an rdf:type triple and incoming links from other types."
        );
        let _ = writeln!(
            out,
            "They have NO field predicates — query them via rdf:type and incoming references."
        );
        for rt in &ref_types {
            let rdf = rt.rdf_type.as_deref().unwrap_or("(no rdf:type)");
            let params: Vec<&str> = rt.mappings.iter().map(|m| m.target.as_str()).collect();
            let _ = writeln!(
                out,
                "  {}({}) → <{}>",
                rt.type_name,
                params.join(", "),
                rdf
            );
        }
        let _ = writeln!(out);
    }

    out
}

fn build_stats_section(profile: &GraphProfile) -> String {
    if profile.predicates.is_empty() {
        return String::new();
    }
    let mut out = String::from("## Data Statistics\n");
    for pred in &profile.predicates {
        if pred.is_object_property {
            let _ = writeln!(
                out,
                "  {} — {} links (object property)",
                pred.short_name, pred.count
            );
            continue;
        }

        let pct = if profile.subject_count > 0 {
            (pred.count as f64 / profile.subject_count as f64 * 100.0).round() as usize
        } else {
            100
        };
        let coverage = if pct < 100 {
            format!(" ({}%)", pct)
        } else {
            String::new()
        };

        if let (Some(min), Some(max), Some(avg)) = (pred.min, pred.max, pred.avg) {
            let _ = writeln!(
                out,
                "  {} — {} values{}, range: {:.2}–{:.2}, avg: {:.2}",
                pred.short_name, pred.count, coverage, min, max, avg
            );
        } else if let Some(top) = &pred.top_values {
            let top_str: Vec<String> = top
                .iter()
                .take(5)
                .map(|(v, c)| format!("{v} ({c})"))
                .collect();
            let _ = writeln!(
                out,
                "  {} — {} values{}, {} unique: {}{}",
                pred.short_name,
                pred.count,
                coverage,
                pred.distinct,
                top_str.join(", "),
                if top.len() > 5 { "..." } else { "" }
            );
        } else if !pred.samples.is_empty() {
            let samples_str: Vec<String> =
                pred.samples.iter().map(|s| format!("\"{s}\"")).collect();
            let _ = writeln!(
                out,
                "  {} — {} values{}, samples: {}",
                pred.short_name,
                pred.count,
                coverage,
                samples_str.join(", ")
            );
        } else {
            let _ = writeln!(
                out,
                "  {} — {} values{}",
                pred.short_name, pred.count, coverage
            );
        }
    }
    let _ = writeln!(out);
    out
}

fn build_graph_summary(profile: &GraphProfile) -> String {
    let mut out = String::from("## Graph Summary\n");
    let _ = writeln!(
        out,
        "  Triples: {}, Subjects: {}",
        profile.triple_count, profile.subject_count
    );
    if !profile.type_distribution.is_empty() {
        let _ = write!(out, "  Types: ");
        let parts: Vec<String> = profile
            .type_distribution
            .iter()
            .map(|(t, c)| format!("{} ({c})", shorten_uri(t)))
            .collect();
        let _ = writeln!(out, "{}", parts.join(", "));
    }
    let _ = writeln!(out);
    out
}

fn build_vocab_hints(profile: &GraphProfile) -> String {
    let mut namespaces = std::collections::HashSet::new();
    for pred in &profile.predicates {
        if let Some(ns) = extract_namespace(&pred.predicate) {
            namespaces.insert(ns);
        }
    }
    for (type_uri, _) in &profile.type_distribution {
        if let Some(ns) = extract_namespace(type_uri) {
            namespaces.insert(ns);
        }
    }

    let hints: Vec<(&str, &str)> = VOCAB_DESCRIPTIONS
        .iter()
        .filter(|(ns, _)| namespaces.contains(*ns))
        .copied()
        .collect();

    if hints.is_empty() {
        return String::new();
    }

    let mut out = String::from("## Vocabulary Hints\n");
    for (ns, desc) in hints {
        let _ = writeln!(out, "  <{ns}> — {desc}");
    }
    let _ = writeln!(out);
    out
}

fn build_sparql_tips() -> String {
    "\
## SPARQL Tips
  - For numeric comparisons: FILTER(xsd:double(?val) > 100)
  - For string matching: FILTER(CONTAINS(LCASE(STR(?val)), \"term\"))
  - For exact category match: FILTER(STR(?val) = \"Category Name\")
  - Predicates without a URI mapping use the field name directly as the predicate IRI.
"
    .to_string()
}

fn shorten_xsd(uri: &str) -> String {
    uri.strip_prefix("http://www.w3.org/2001/XMLSchema#")
        .map(|local| format!("xsd:{local}"))
        .unwrap_or_else(|| uri.to_string())
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
    ];
    for (full, short) in PREFIXES {
        if let Some(local) = uri.strip_prefix(full) {
            return format!("{short}{local}");
        }
    }
    uri.rsplit_once('/')
        .or_else(|| uri.rsplit_once('#'))
        .map(|(_, local)| local.to_string())
        .unwrap_or_else(|| uri.to_string())
}

fn extract_namespace(uri: &str) -> Option<String> {
    uri.rfind('#')
        .or_else(|| uri.rfind('/'))
        .map(|pos| uri[..=pos].to_string())
}

const VOCAB_DESCRIPTIONS: &[(&str, &str)] = &[
    (
        "http://schema.org/",
        "Schema.org — general-purpose structured data vocabulary",
    ),
    (
        "http://www.w3.org/ns/dcat#",
        "DCAT — Data Catalog vocabulary for datasets and distributions",
    ),
    (
        "http://purl.org/dc/terms/",
        "Dublin Core Terms — metadata for documents and resources",
    ),
    (
        "http://xmlns.com/foaf/0.1/",
        "FOAF — Friend of a Friend, people and social networks",
    ),
    (
        "http://www.w3.org/2006/vcard/ns#",
        "vCard — contact information (addresses, emails, phone numbers)",
    ),
    (
        "http://www.w3.org/ns/org#",
        "W3C Organization Ontology — organizational structures",
    ),
    (
        "http://www.w3.org/2004/02/skos/core#",
        "SKOS — Simple Knowledge Organization System, taxonomies and thesauri",
    ),
];
