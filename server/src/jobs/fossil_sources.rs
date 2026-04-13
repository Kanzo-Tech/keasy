//! DuckDB-specific source definitions and SQL dialect.
//!
//! Builds a FossilDb pre-configured with keasy data sources via FossilDbBuilder.
//! Provides the DuckDB SQL dialect for plan generation.

use fossil_lang::dialect::{ScanStrategy, SqlDialect};
use fossil_lang::registry::register_defaults;
use fossil_lang::rq::ScanSource;
use fossil_lang::{FossilDb, FossilRegistry, ParamDef, SourceDef, SourceRegistry};

// ── Source builders ─────────────────────────────────────────────────

fn csv_params() -> Vec<ParamDef> {
    vec![
        ParamDef::required("path"),
        ParamDef::with_default("delimiter", ","),
        ParamDef::with_default("header", "true"),
    ]
}

fn parquet_params() -> Vec<ParamDef> {
    vec![ParamDef::required("path")]
}

fn json_params() -> Vec<ParamDef> {
    vec![ParamDef::required("path")]
}

fn excel_params() -> Vec<ParamDef> {
    vec![
        ParamDef::required("path"),
        ParamDef::with_default("sheet", "Sheet1"),
        ParamDef::with_default("header", "true"),
    ]
}

// ── Registry builder ────────────────────────────────────────────────

/// Build the FossilRegistry with keasy data sources + language defaults.
/// Called once at server startup; result is stored in AppState (Send+Sync).
///
/// FossilDb instances are constructed per-job-thread via `build_fossil_db`,
/// because Salsa Storage is not Send+Sync. The registry IS Send+Sync.
pub fn build_fossil_registry() -> FossilRegistry {
    let mut sources = SourceRegistry::new();
    sources.register(SourceDef::new("csv", csv_params()));
    sources.register(SourceDef::new("parquet", parquet_params()));
    sources.register(SourceDef::new("json", json_params()));
    sources.register(SourceDef::new("excel", excel_params()));
    sources.register(
        SourceDef::new("pdf", vec![ParamDef::required("path")]).with_schema_pairs(&[
            ("text", "VARCHAR"),
            ("page", "INTEGER"),
            ("source", "VARCHAR"),
        ]),
    );
    sources.register(
        SourceDef::new("docx", vec![ParamDef::required("path")])
            .with_schema_pairs(&[("text", "VARCHAR"), ("source", "VARCHAR")]),
    );

    let mut registry = FossilRegistry {
        sources,
        ..Default::default()
    };
    register_defaults(&mut registry);
    registry
}

/// Construct a FossilDb from a shared registry. Cheap (clones the registry).
/// Each compilation thread builds its own FossilDb to avoid sharing
/// non-Send Salsa storage across threads.
pub fn build_fossil_db(registry: &FossilRegistry) -> FossilDb {
    FossilDb::with_registry(registry.clone())
}

// ── DuckDB SQL dialect ──────────────────────────────────────────────

pub struct DuckDbDialect;

impl SqlDialect for DuckDbDialect {
    fn scan_strategy(&self, source: &ScanSource) -> ScanStrategy {
        match source.format.as_str() {
            "pdf" => ScanStrategy::Preprocess {
                handler: "pdf_extract".into(),
                output_table: format!("_pre_pdf_{}", sanitize(&source.path)),
            },
            "docx" => ScanStrategy::Preprocess {
                handler: "docx_extract".into(),
                output_table: format!("_pre_docx_{}", sanitize(&source.path)),
            },
            "excel" => {
                let sheet = param_or(&source.params, "sheet", "Sheet1");
                let header = param_or(&source.params, "header", "true");
                ScanStrategy::Sql(format!(
                    "SELECT * FROM read_xlsx('{}', sheet='{}', header={})",
                    source.path, sheet, header
                ))
            }
            "csv" => {
                let delim = param_or(&source.params, "delimiter", ",");
                let header = param_or(&source.params, "header", "true");
                ScanStrategy::Sql(format!(
                    "SELECT * FROM read_csv('{}', delim='{}', header={})",
                    source.path, delim, header
                ))
            }
            // Convention: read_{format}('{path}')
            format => ScanStrategy::Sql(format!(
                "SELECT * FROM read_{format}('{}')",
                source.path
            )),
        }
    }
}

fn param_or<'a>(
    params: &'a std::collections::HashMap<String, String>,
    key: &str,
    default: &'a str,
) -> &'a str {
    params.get(key).map_or(default, |s| s.as_str())
}

fn sanitize(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}
