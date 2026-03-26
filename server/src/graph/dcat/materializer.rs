//! DCAT-AP catalog materializer.
//!
//! Builds vertex/edge DataFrames from [`DcatInput`] + [`DataManifest`] and
//! delegates parquet writing to [`fossil_stdlib::rdf::materialize_frames`].
//!
//! One model, two views: the parquets produced here are the **single source
//! of truth** — both the interactive graph (DuckDB-WASM) and the Turtle
//! export derive from them.

use std::collections::HashMap;

use polars::prelude::*;

use fossil_lang::error::FossilError;
use fossil_lang::runtime::executor::DataManifest;
use fossil_lang::traits::resolver::ResolvedPath;
use fossil_stdlib::rdf::{EdgeSpec, VertexSpec, materialize_frames};

use crate::graph::vocab;
use super::generator::{encode_uri_component, slug};
use super::types::DcatInput;

// ── URN builders ────────────────────────────────────────────────────────

fn catalog_urn(job_id: &str) -> String {
    format!("urn:keasy:catalog:{job_id}")
}

fn dataset_urn(job_id: &str, type_name: &str) -> String {
    format!("urn:keasy:dataset:{job_id}/{}", encode_uri_component(type_name))
}

fn distribution_urn(job_id: &str, filename: &str) -> String {
    format!("urn:keasy:dist:{job_id}/{}", encode_uri_component(filename))
}

fn publisher_urn(name: &str) -> String {
    format!("urn:keasy:publisher:{}", slug(name))
}

fn contact_urn(email: &str) -> String {
    format!("urn:keasy:contact:{}", slug(email))
}

fn field_urn(job_id: &str, type_name: &str, field_name: &str) -> String {
    format!(
        "urn:keasy:field:{job_id}/{}/{}",
        encode_uri_component(type_name),
        encode_uri_component(field_name),
    )
}

// ── Main entry point ────────────────────────────────────────────────────

/// Materialize DCAT-AP catalog as GraphAr parquets.
///
/// Builds DataFrames for each DCAT-AP type, converts to lazy `VertexSpec` /
/// `EdgeSpec`, and delegates to `materialize_frames` for streaming parquet
/// I/O + stats computation.
///
/// `DcatInput` is transient — only used here, never persisted.
pub fn materialize_catalog(
    input: &DcatInput,
    data_manifest: &DataManifest,
    dest: &ResolvedPath,
) -> Result<DataManifest, FossilError> {
    let mut vertices = Vec::new();
    let mut edges = Vec::new();

    // ── Vertices ────────────────────────────────────────────────────────

    // Catalog (1 row)
    let title = input.job_name.as_deref().unwrap_or("Keasy Pipeline Output");
    let lang = input.language.as_deref().unwrap_or("en");
    vertices.push(VertexSpec {
        name: "Catalog".into(),
        iri: vocab::DCAT_CATALOG.into(),
        frame: df! {
            "_id" => &[0u64],
            "subject" => &[catalog_urn(&input.job_id)],
            "title" => &[title],
            "description" => &[input.org.catalog_description.as_deref().unwrap_or("")],
            "issued" => &[input.completed_at.as_str()],
            "language" => &[lang],
            "license" => &[input.org.license_uri.as_deref().unwrap_or("")],
        }.expect("catalog df").lazy(),
        column_iris: HashMap::from([
            ("title".into(), vocab::DCT_TITLE.into()),
            ("description".into(), vocab::DCT_DESCRIPTION.into()),
            ("issued".into(), vocab::DCT_ISSUED.into()),
            ("language".into(), vocab::DCT_LANGUAGE.into()),
            ("license".into(), vocab::DCT_LICENSE.into()),
        ]),
    });

    // Dataset (N rows)
    let type_counts: HashMap<&str, u64> = data_manifest.types.iter()
        .map(|t| (t.name.as_str(), t.entity_count))
        .collect();

    let ds_ids: Vec<u64> = (0..input.datasets.len() as u64).collect();
    let ds_subjects: Vec<String> = input.datasets.iter()
        .map(|ds| dataset_urn(&input.job_id, &ds.type_name)).collect();
    let ds_titles: Vec<String> = input.datasets.iter().map(|ds| ds.type_name.clone()).collect();
    let ds_sources: Vec<String> = input.datasets.iter()
        .map(|ds| ds.source_name.as_deref().unwrap_or("").into()).collect();
    let ds_conforms: Vec<String> = input.datasets.iter()
        .map(|ds| ds.rdf_type.as_deref().unwrap_or("").into()).collect();
    let ds_keywords: Vec<String> = input.datasets.iter()
        .map(|ds| ds.keywords.join(", ")).collect();
    let ds_counts: Vec<u64> = input.datasets.iter()
        .map(|ds| *type_counts.get(ds.type_name.as_str()).unwrap_or(&0)).collect();

    vertices.push(VertexSpec {
        name: "Dataset".into(),
        iri: vocab::DCAT_DATASET.into(),
        frame: df! {
            "_id" => &ds_ids,
            "subject" => &ds_subjects,
            "title" => &ds_titles,
            "source" => &ds_sources,
            "conforms_to" => &ds_conforms,
            "keywords" => &ds_keywords,
            "entity_count" => &ds_counts,
        }.expect("dataset df").lazy(),
        column_iris: HashMap::from([
            ("title".into(), vocab::DCT_TITLE.into()),
            ("source".into(), vocab::DCT_SOURCE.into()),
            ("conforms_to".into(), vocab::DCT_CONFORMS_TO.into()),
            ("keywords".into(), vocab::DCAT_KEYWORD.into()),
        ]),
    });

    // Distribution (M rows)
    let mut dist_ids = Vec::new();
    let mut dist_subjects = Vec::new();
    let mut dist_urls = Vec::new();
    let mut dist_types = Vec::new();
    let mut i = 0u64;
    for ds in &input.datasets {
        for dist in &ds.distributions {
            let filename = dist.destination.rsplit('/').next().unwrap_or(&dist.destination);
            dist_ids.push(i);
            dist_subjects.push(distribution_urn(&input.job_id, filename));
            dist_urls.push(dist.destination.clone());
            dist_types.push(dist.media_type.clone());
            i += 1;
        }
    }
    vertices.push(VertexSpec {
        name: "Distribution".into(),
        iri: vocab::DCAT_DISTRIBUTION.into(),
        frame: df! {
            "_id" => &dist_ids,
            "subject" => &dist_subjects,
            "access_url" => &dist_urls,
            "media_type" => &dist_types,
        }.expect("distribution df").lazy(),
        column_iris: HashMap::from([
            ("access_url".into(), vocab::DCAT_ACCESS_URL.into()),
            ("media_type".into(), vocab::DCAT_MEDIA_TYPE.into()),
        ]),
    });

    // Agent (1 row)
    let agent_subject = match &input.org.publisher_uri {
        Some(uri) => uri.clone(),
        None => publisher_urn(&input.org.publisher_name),
    };
    vertices.push(VertexSpec {
        name: "Agent".into(),
        iri: vocab::FOAF_AGENT.into(),
        frame: df! {
            "_id" => &[0u64],
            "subject" => &[agent_subject],
            "name" => &[input.org.publisher_name.as_str()],
            "homepage" => &[input.org.publisher_uri.as_deref().unwrap_or("")],
        }.expect("agent df").lazy(),
        column_iris: HashMap::from([
            ("name".into(), vocab::FOAF_NAME.into()),
            ("homepage".into(), vocab::FOAF_HOMEPAGE.into()),
        ]),
    });

    // Contact (0 or 1 row)
    if let Some(email) = &input.org.contact_email {
        vertices.push(VertexSpec {
            name: "Contact".into(),
            iri: vocab::VCARD_KIND.into(),
            frame: df! {
                "_id" => &[0u64],
                "subject" => &[contact_urn(email)],
                "email" => &[format!("mailto:{email}")],
            }.expect("contact df").lazy(),
            column_iris: HashMap::from([
                ("email".into(), vocab::VCARD_HAS_EMAIL.into()),
            ]),
        });
    }

    // Field (1 per column per dataset, enriched with stats from DataManifest)
    let mut col_stats: HashMap<(&str, &str), &fossil_lang::runtime::executor::ColumnStat> = HashMap::new();
    for tm in &data_manifest.types {
        for cs in &tm.columns {
            col_stats.insert((tm.name.as_str(), cs.name.as_str()), cs);
        }
    }

    let mut f_ids = Vec::new();
    let mut f_subjects = Vec::new();
    let mut f_names = Vec::new();
    let mut f_uris = Vec::new();
    let mut f_datatypes = Vec::new();
    let mut f_counts = Vec::new();
    let mut f_uniques = Vec::new();
    let mut f_mins = Vec::new();
    let mut f_maxs = Vec::new();
    let mut f_s1 = Vec::new();
    let mut f_s2 = Vec::new();
    let mut f_s3 = Vec::new();

    let mut fi = 0u64;
    for ds in &input.datasets {
        for field in &ds.fields {
            let stat = col_stats.get(&(ds.type_name.as_str(), field.name.as_str()));
            f_ids.push(fi);
            f_subjects.push(field_urn(&input.job_id, &ds.type_name, &field.name));
            f_names.push(field.name.clone());
            f_uris.push(field.rdf_uri.as_deref().unwrap_or("").to_string());
            f_datatypes.push(stat.map(|s| s.datatype.as_str()).unwrap_or("string").to_string());
            f_counts.push(stat.map(|s| s.count).unwrap_or(0));
            f_uniques.push(stat.map(|s| s.n_unique).unwrap_or(0));
            f_mins.push(stat.and_then(|s| s.min.clone()).unwrap_or_default());
            f_maxs.push(stat.and_then(|s| s.max.clone()).unwrap_or_default());
            let samples = stat.map(|s| &s.samples);
            f_s1.push(samples.and_then(|s| s.first().cloned()).unwrap_or_default());
            f_s2.push(samples.and_then(|s| s.get(1).cloned()).unwrap_or_default());
            f_s3.push(samples.and_then(|s| s.get(2).cloned()).unwrap_or_default());
            fi += 1;
        }
    }

    if fi > 0 {
        vertices.push(VertexSpec {
            name: "Field".into(),
            iri: vocab::KEASY_FIELD.into(),
            frame: df! {
                "_id" => &f_ids,
                "subject" => &f_subjects,
                "name" => &f_names,
                "rdf_uri" => &f_uris,
                "datatype" => &f_datatypes,
                "count" => &f_counts,
                "n_unique" => &f_uniques,
                "min" => &f_mins,
                "max" => &f_maxs,
                "sample_1" => &f_s1,
                "sample_2" => &f_s2,
                "sample_3" => &f_s3,
            }.expect("field df").lazy(),
            column_iris: HashMap::new(), // Field columns are schema metadata, not RDF properties
        });
    }

    // ── Edges ───────────────────────────────────────────────────────────

    // Catalog → Dataset
    if !input.datasets.is_empty() {
        let sources: Vec<u64> = vec![0; input.datasets.len()];
        let targets: Vec<u64> = (0..input.datasets.len() as u64).collect();
        edges.push(EdgeSpec {
            label: "dataset".into(),
            iri: vocab::DCAT_DATASET_PROP.into(),
            source_type: "Catalog".into(),
            target_type: "Dataset".into(),
            frame: df! { "source" => &sources, "target" => &targets }
                .expect("catalog→dataset edge").lazy(),
        });
    }

    // Dataset → Distribution
    let mut dd_src = Vec::new();
    let mut dd_tgt = Vec::new();
    let mut dist_idx = 0u64;
    for (ds_idx, ds) in input.datasets.iter().enumerate() {
        for _ in &ds.distributions {
            dd_src.push(ds_idx as u64);
            dd_tgt.push(dist_idx);
            dist_idx += 1;
        }
    }
    if !dd_src.is_empty() {
        edges.push(EdgeSpec {
            label: "distribution".into(),
            iri: vocab::DCAT_DISTRIBUTION_PROP.into(),
            source_type: "Dataset".into(),
            target_type: "Distribution".into(),
            frame: df! { "source" => &dd_src, "target" => &dd_tgt }
                .expect("dataset→distribution edge").lazy(),
        });
    }

    // Dataset → Field
    let mut df_src = Vec::new();
    let mut df_tgt = Vec::new();
    let mut field_idx = 0u64;
    for (ds_idx, ds) in input.datasets.iter().enumerate() {
        for _ in &ds.fields {
            df_src.push(ds_idx as u64);
            df_tgt.push(field_idx);
            field_idx += 1;
        }
    }
    if !df_src.is_empty() {
        edges.push(EdgeSpec {
            label: "field".into(),
            iri: vocab::KEASY_FIELD_PROP.into(),
            source_type: "Dataset".into(),
            target_type: "Field".into(),
            frame: df! { "source" => &df_src, "target" => &df_tgt }
                .expect("dataset→field edge").lazy(),
        });
    }

    // Catalog → Agent
    edges.push(EdgeSpec {
        label: "publisher".into(),
        iri: vocab::DCT_PUBLISHER.into(),
        source_type: "Catalog".into(),
        target_type: "Agent".into(),
        frame: df! { "source" => &[0u64], "target" => &[0u64] }
            .expect("catalog→agent edge").lazy(),
    });

    // Catalog → Contact
    if input.org.contact_email.is_some() {
        edges.push(EdgeSpec {
            label: "contactPoint".into(),
            iri: vocab::DCAT_CONTACT_POINT.into(),
            source_type: "Catalog".into(),
            target_type: "Contact".into(),
            frame: df! { "source" => &[0u64], "target" => &[0u64] }
                .expect("catalog→contact edge").lazy(),
        });
    }

    // ── Delegate to ikigai-core ─────────────────────────────────────────

    materialize_frames(vertices, edges, dest)
}
