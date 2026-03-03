use std::collections::HashMap;
use std::fmt::Write;

use crate::ai::profiler::{GraphProfile, PredicateStats};
use crate::jobs::PipelineSummary;

const MAX_CHARS: usize = 24_000;

pub fn build_semantic_context(pipeline: &PipelineSummary, profile: &GraphProfile) -> String {
    let mut ctx = String::with_capacity(MAX_CHARS);
    let mut budget = MAX_CHARS;

    let schema_section = build_schema_section(pipeline, profile);
    write_section(&mut ctx, &mut budget, &schema_section);

    let fewshot_section = build_fewshot_example(pipeline, profile);
    write_section(&mut ctx, &mut budget, &fewshot_section);

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

/// Build a lookup from predicate URI → PredicateStats for fast matching.
fn build_stats_lookup(profile: &GraphProfile) -> HashMap<&str, &PredicateStats> {
    profile
        .predicates
        .iter()
        .map(|p| (p.predicate.as_str(), p))
        .collect()
}

fn build_schema_section(pipeline: &PipelineSummary, profile: &GraphProfile) -> String {
    let mut out = String::new();
    let stats_map = build_stats_lookup(profile);

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
                .map(|r| format!(" [<{r}>]"))
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
                        // Inline stats for this field
                        if let Some(stats) = stats_map.get(u.as_str()) {
                            write_inline_stats(&mut out, stats, profile.subject_count);
                        }
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

/// Write inline stats line for a field (indented under the field).
fn write_inline_stats(out: &mut String, stats: &PredicateStats, subject_count: usize) {
    if stats.is_object_property {
        let _ = writeln!(out, "    ↳ {} links (object property)", stats.count);
        return;
    }

    let pct = if subject_count > 0 {
        (stats.count as f64 / subject_count as f64 * 100.0).round() as usize
    } else {
        100
    };
    let coverage = if pct < 100 {
        format!(" ({}%)", pct)
    } else {
        String::new()
    };

    if let (Some(min), Some(max), Some(avg)) = (stats.min, stats.max, stats.avg) {
        let _ = writeln!(
            out,
            "    ↳ {} values{}, range: {:.2}–{:.2}, avg: {:.2}",
            stats.count, coverage, min, max, avg
        );
    } else if let Some(top) = &stats.top_values {
        let top_str: Vec<String> = top
            .iter()
            .take(10)
            .map(|(v, c)| format!("{v} ({c})"))
            .collect();
        let _ = writeln!(
            out,
            "    ↳ {} values{}, {} unique: {}{}",
            stats.count,
            coverage,
            stats.distinct,
            top_str.join(", "),
            if top.len() > 10 { "..." } else { "" }
        );
    } else if !stats.samples.is_empty() {
        let samples_str: Vec<String> = stats.samples.iter().map(|s| format!("\"{s}\"")).collect();
        let _ = writeln!(
            out,
            "    ↳ {} values{}, samples: {}",
            stats.count, coverage, samples_str.join(", ")
        );
    } else {
        let _ = writeln!(out, "    ↳ {} values{}", stats.count, coverage);
    }
}

/// Generate a dynamic few-shot example using real predicates from the schema.
///
/// Looks for the first Output Type that has at least 1 categorical field (with top_values)
/// and 1 numeric field (with min/max). Generates a SPARQL example combining both filters.
fn build_fewshot_example(pipeline: &PipelineSummary, profile: &GraphProfile) -> String {
    let stats_map = build_stats_lookup(profile);

    for output in &pipeline.outputs {
        if output.fields.is_empty() {
            continue;
        }
        let rdf_type = match &output.rdf_type {
            Some(r) => r,
            None => continue,
        };

        let mut cat_field: Option<(&str, &str, &str, usize)> = None; // (name, uri, top_value, count)
        let mut num_field: Option<(&str, &str, f64, f64)> = None; // (name, uri, min, max)
        let mut label_field: Option<&str> = None; // first string field for SELECT

        for field in &output.fields {
            let uri = match &field.uri {
                Some(u) => u.as_str(),
                None => continue,
            };
            let stats = match stats_map.get(uri) {
                Some(s) => s,
                None => continue,
            };

            // Track first likely label/name field
            if label_field.is_none()
                && field.field_type == "String"
                && !field.optional
                && (field.name.contains("name") || field.name.contains("label") || field.name.contains("title"))
            {
                label_field = Some(uri);
            }

            if cat_field.is_none() {
                if let Some(top) = &stats.top_values {
                    if let Some((val, cnt)) = top.first() {
                        cat_field = Some((&field.name, uri, val.as_str(), *cnt));
                    }
                }
            }

            if num_field.is_none() {
                if let (Some(min), Some(max)) = (stats.min, stats.max) {
                    num_field = Some((&field.name, uri, min, max));
                }
            }

            if cat_field.is_some() && num_field.is_some() {
                break;
            }
        }

        // Need both categorical and numeric to generate example
        let (cat_name, cat_uri, cat_val, _) = match cat_field {
            Some(c) => c,
            None => continue,
        };
        let (num_name, num_uri, _min, max) = match num_field {
            Some(n) => n,
            None => continue,
        };

        // Threshold: ~top 20% of range
        let threshold = (max * 0.8).round();

        let label_line = label_field
            .map(|u| format!("  ?s <{u}> ?name .\n"))
            .unwrap_or_default();
        let label_var = if label_field.is_some() { " ?name" } else { "" };

        let mut out = String::from("## Example Query\n");
        let _ = writeln!(
            out,
            "Q: Which {type_name} have {cat_name}=\"{cat_val}\" and high {num_name}?\n\
             ```sparql\n\
             SELECT ?s{label_var} ?{cat_name} ?{num_name}\n\
             WHERE {{\n\
               ?s a <{rdf_type}> .\n\
             {label_line}\
               ?s <{cat_uri}> ?{cat_name} .\n\
               ?s <{num_uri}> ?{num_name} .\n\
             FILTER(STR(?{cat_name}) = \"{cat_val}\")\n\
             FILTER(xsd:double(?{num_name}) > {threshold})\n\
             }}\n\
             ```\n",
            type_name = output.type_name,
        );
        return out;
    }

    String::new()
}

fn shorten_xsd(uri: &str) -> String {
    uri.strip_prefix("http://www.w3.org/2001/XMLSchema#")
        .map(|local| format!("xsd:{local}"))
        .unwrap_or_else(|| uri.to_string())
}

