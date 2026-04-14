//! Keasy source catalog: `SourceHandler` implementations that register
//! each fossil source alias as a DuckDB view (or preprocessed temp table)
//! before the compiled SQL runs.
//!
//! After the fossil-lang catalog-based refactor, fossil-lang emits SQL
//! that references sources **by alias only** (e.g. `FROM src_csv_1`).
//! The host is fully responsible for making each alias resolvable. This
//! module implements that resolution: one native handler builds DuckDB
//! views via `read_csv(...)`, `read_parquet(...)`, etc. The dialect
//! trait is gone — this logic used to live on its emission side.

use fossil_lang::registry::register_defaults;
use fossil_lang::{FossilDb, FossilRegistry, ParamDef, SourceDef, SourceRegistry};

use super::duckdb_engine::DuckDbConn;
use super::executor::SourceHandler;

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

// ── DuckDB native source handler ────────────────────────────────────

/// Handles every format that DuckDB can read directly via a table-valued
/// function: csv, parquet, json, excel, and any unknown format that maps
/// convention-style to `read_{format}(...)`. Registered for each such
/// format in `runner.rs` when the `Executor` is constructed.
///
/// For every fossil source referencing one of these formats, this
/// handler issues `CREATE OR REPLACE VIEW <alias> AS SELECT * FROM
/// read_<format>('<path>', <params>)` against the DuckDB connection.
/// The compiled fossil SQL then reads from `<alias>` directly.
pub struct DuckDbNativeHandler {
    format: &'static str,
}

impl DuckDbNativeHandler {
    pub const fn new(format: &'static str) -> Self {
        Self { format }
    }
}

impl SourceHandler for DuckDbNativeHandler {
    fn format(&self) -> &str {
        self.format
    }

    fn load(
        &self,
        conn: &DuckDbConn,
        def: &fossil_lang::plan::SourceDef,
    ) -> Result<(), String> {
        let tvf = build_tvf_call(&def.format, &def.path, &def.params);
        let sql = format!(
            "CREATE OR REPLACE VIEW \"{alias}\" AS SELECT * FROM {tvf}",
            alias = def.alias,
        );
        conn.execute_batch(&sql)
            .map_err(|e| format!("register source '{}': {e}", def.alias))
    }
}

/// Build a `read_<format>('<path>', key=value, ...)` table-valued function
/// call. Format-specific parameter keys/quoting live here because this is
/// the host's catalog layer, where DuckDB-specific knowledge belongs.
fn build_tvf_call(
    format: &str,
    path: &str,
    params: &std::collections::HashMap<String, String>,
) -> String {
    let mut parts = vec![format!("'{}'", path.replace('\'', "''"))];
    match format {
        "csv" => {
            let delim = params.get("delimiter").map(String::as_str).unwrap_or(",");
            let header = params.get("header").map(String::as_str).unwrap_or("true");
            parts.push(format!("delim='{delim}'"));
            parts.push(format!("header={header}"));
            format!("read_csv({})", parts.join(", "))
        }
        "excel" => {
            let sheet = params.get("sheet").map(String::as_str).unwrap_or("Sheet1");
            let header = params.get("header").map(String::as_str).unwrap_or("true");
            parts.push(format!("sheet='{sheet}'"));
            parts.push(format!("header={header}"));
            format!("read_xlsx({})", parts.join(", "))
        }
        other => format!("read_{other}({})", parts.join(", ")),
    }
}
