// server/src/catalog/ — DuckLake catalog (W1).
//
// keasy is the trusted host of the metadata catalog (ARCHITECTURE §10). The
// catalog registers the pipeline output BY REFERENCE (ducklake_add_data_files
// over the flat+SSE Parquet the job wrote) inside a single transaction, so a
// completed dataset is one atomic snapshot. The catalog is server-side only:
// the browser never attaches ducklake — it keeps reading flat Parquet by signed
// URL — so the writer=reader version-pin (I7) is keasy↔keasy.

pub mod reconcile;
pub mod routes;
mod secret;
pub mod view;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use duckdb::Connection;
use fossil_run_status::RunStatus;

/// Errors registering a dataset in the catalog. The host treats these as
/// non-fatal at `complete_job` time (the reconciler re-registers; §11) — a
/// catalog miss must never fail a job whose data is already durably at the sink.
#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("duckdb: {0}")]
    Duck(#[from] duckdb::Error),
    #[error("catalog io: {0}")]
    Io(#[from] std::io::Error),
    #[error("the job output target carries no credentials the catalog can read it with")]
    NoCredentials,
}

/// The workspace's DuckLake catalog — the server-side authority over output
/// metadata. One per keasy instance (instance-per-workspace deploy). Holds a
/// single DuckDB control connection with `ducklake` + `httpfs` loaded and the
/// catalog attached as `lake`; writes are serialised through a `Mutex` because a
/// DuckDB connection is single-writer (several `complete_job`s can race).
pub struct Catalog {
    conn: Mutex<Connection>,
}

impl Catalog {
    /// Open (creating if absent) the catalog rooted at `data_dir`. The catalog
    /// metadata uses the **SQLite** ducklake backend (`catalog.sqlite`) so it
    /// replicates with Litestream exactly like `keasy.db`; `DATA_PATH` points at
    /// `catalog-data/` but stays ~empty — every dataset is registered BY
    /// REFERENCE (the bytes live at the member's sink), never copied in.
    pub fn open(data_dir: &Path) -> Result<Self, CatalogError> {
        let catalog_db = data_dir.join("catalog.sqlite");
        let data_path = data_dir.join("catalog-data");
        // On a fresh instance the data dir exists (keasy.db lives there) but the
        // ducklake DATA_PATH subdir does not yet — create it before ATTACH.
        std::fs::create_dir_all(&data_path)?;
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "INSTALL ducklake; LOAD ducklake;
             INSTALL sqlite;   LOAD sqlite;
             INSTALL httpfs;   LOAD httpfs;
             INSTALL azure;    LOAD azure;",
        )?;
        // TLS in slim container images: neither httpfs nor the azure extension
        // auto-find the system trust store, so reading a remote Parquet footer
        // fails with "Problem with the SSL CA cert". Two distinct stacks need
        // pointing at the CA bundle: httpfs honours `ca_cert_file`; the azure
        // extension uses the Azure SDK, whose `curl` transport honours the
        // `CURL_CA_BUNDLE` env var — so force that transport here. No-op where the
        // bundle is already found (e.g. a dev host without this path).
        const CA_BUNDLE: &str = "/etc/ssl/certs/ca-certificates.crt";
        if Path::new(CA_BUNDLE).exists() {
            conn.execute_batch(&format!(
                "SET ca_cert_file = '{CA_BUNDLE}';
                 SET azure_transport_option_type = 'curl';"
            ))?;
        }
        // BYOS: ducklake compaction/cleanup is MANUAL (no auto-compaction to
        // disable). keasy never calls `ducklake_merge_adjacent_files` /
        // `ducklake_cleanup_old_files`, and never deletes the member's storage at
        // all — the referenced Parquet lives in the member's sink, whose lifecycle
        // is the member's. The catalog only ever touches its own metadata.
        conn.execute_batch(&format!(
            "ATTACH 'ducklake:sqlite:{}' AS lake (DATA_PATH '{}');",
            catalog_db.display(),
            data_path.display(),
        ))?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Register a completed job's output as one atomic snapshot: a per-job schema
    /// `job_<id>` holding one table per vertex/edge type, each backed BY
    /// REFERENCE by the Parquet the job already wrote. Idempotent — re-running
    /// (the reconciler, or a duplicate `complete_job`) drops and rebuilds the
    /// schema in the same transaction, so the count never doubles.
    ///
    /// `creds` is the object_store config keasy signs the output with; for a
    /// remote dataset (S3/Azure) it is translated, by the dataset's URL scheme,
    /// into a scoped DuckDB secret so httpfs/azure can read the Parquet footers.
    /// A `file://`/local dataset needs no secret.
    pub fn register(
        &self,
        job_id: &str,
        dataset: &RunStatus,
        creds: &HashMap<String, String>,
    ) -> Result<(), CatalogError> {
        let conn = self.conn.lock().expect("catalog mutex poisoned");

        // Authorise reads of this dataset's prefix. Local needs nothing; a remote
        // dataset whose creds we can't translate is a registration miss, not a
        // silent partial. A single fixed-name
        // secret, replaced each call: the `Mutex` serialises registrations so
        // only this dataset's secret is ever live — no per-job accumulation on
        // the long-lived connection.
        let base = &dataset.dest;
        match secret::plan(READ_SECRET, base, creds) {
            secret::SecretPlan::None => {}
            secret::SecretPlan::Sql(sql) => conn.execute_batch(&sql)?,
            secret::SecretPlan::Unsupported => return Err(CatalogError::NoCredentials),
        }

        let schema = format!("job_{}", sanitize(job_id));
        let mut sql = String::from("BEGIN;\n");
        sql.push_str(&format!("DROP SCHEMA IF EXISTS lake.\"{schema}\" CASCADE;\n"));
        sql.push_str(&format!("CREATE SCHEMA lake.\"{schema}\";\n"));

        for v in &dataset.vertices {
            push_register(&mut sql, &schema, &v.vertex_type, &join(base, &v.file));
        }
        for e in &dataset.edges {
            // One table per edge, keyed by (src, edge, dst) — the predicate alone
            // collides when the same edge type connects different endpoint pairs
            // (e.g. `classifiedAs` from two source types). Matches the viewer's
            // `edgeTableName` convention, backed by the CSR (`by_source`) file the
            // discovery view actually mounts.
            let name = format!("{}_{}_{}", e.src_type, e.edge_type, e.dst_type);
            push_register(&mut sql, &schema, &name, &join(base, &e.by_source));
        }
        sql.push_str("COMMIT;\n");

        // If the BEGIN…COMMIT fails mid-way (e.g. a remote `read_parquet` can't
        // reach the sink), the transaction is left OPEN on this long-lived
        // connection — every later catalog op would then fail with "transaction
        // is aborted". Roll it back so one bad registration never poisons the
        // catalog; the error still propagates (the reconciler retries).
        if let Err(e) = conn.execute_batch(&sql) {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(e.into());
        }
        Ok(())
    }

    /// Drop a job's dataset from the catalog (its `job_<id>` schema). BYOS-safe:
    /// `DROP SCHEMA CASCADE` removes only the catalog metadata — the member's
    /// referenced Parquet at the sink is never touched. Idempotent (no-op if the
    /// schema is absent). Used when a job is deleted and by the deregister pass.
    pub fn unregister(&self, job_id: &str) -> Result<(), CatalogError> {
        let conn = self.conn.lock().expect("catalog mutex poisoned");
        let schema = format!("job_{}", sanitize(job_id));
        conn.execute_batch(&format!("DROP SCHEMA IF EXISTS lake.\"{schema}\" CASCADE;"))?;
        Ok(())
    }

    /// The set of job ids that already have a registered dataset (their schema
    /// exists). The catalog is the authority on "is this registered" — no flag on
    /// `Job` to drift out of sync — so the reconciler diffs completed jobs against
    /// this. Ids are returned in their `sanitize`d form (as they appear in schema
    /// names); compare with `Catalog::is_registered`.
    pub fn registered_jobs(&self) -> Result<std::collections::HashSet<String>, CatalogError> {
        let conn = self.conn.lock().expect("catalog mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT schema_name FROM duckdb_schemas()
             WHERE database_name = 'lake' AND schema_name LIKE 'job\\_%' ESCAPE '\\'",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows
            .filter_map(Result::ok)
            .filter_map(|s| s.strip_prefix("job_").map(str::to_owned))
            .collect())
    }

    /// Whether `job_id`'s dataset is registered, given a set from
    /// [`registered_jobs`]. Applies the same `sanitize` the schema name uses.
    pub fn is_registered(registered: &std::collections::HashSet<String>, job_id: &str) -> bool {
        registered.contains(&sanitize(job_id))
    }
}

/// Append the "create empty table from the Parquet schema, then attach the file
/// by reference" pair for one dataset member into `sql`. `schema`/`ty` are bare
/// names: quoted for the DDL identifiers and passed as plain string values to
/// `ducklake_add_data_files` (whose `schema =>` arg wants the name, not an
/// identifier). Both use the SAME sanitized `table` so the names match.
fn push_register(sql: &mut String, schema: &str, ty: &str, url: &str) {
    let table = sanitize(ty);
    sql.push_str(&format!(
        "CREATE TABLE lake.\"{schema}\".\"{table}\" AS SELECT * FROM read_parquet('{url}') LIMIT 0;\n"
    ));
    sql.push_str(&format!(
        "CALL ducklake_add_data_files('lake', '{table}', '{url}', schema => '{schema}');\n"
    ));
}

/// Join a dataset base URL with a dataset-relative member path.
fn join(base: &str, rel: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), rel.trim_start_matches('/'))
}

/// Reduce a name to `[A-Za-z0-9_]` (DuckDB type/predicate names are local names;
/// this also blocks injection via a hostile RunStatus). The result is used both
/// as a quoted DDL identifier and as a `ducklake_add_data_files` string arg, and
/// (by the reconciler) to map a live job id to its schema suffix.
pub(crate) fn sanitize(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect()
}

/// The single DuckDB secret the catalog reads referenced Parquet through —
/// `CREATE OR REPLACE`d per registration, scoped to that dataset's prefix.
const READ_SECRET: &str = "catalog_read";

#[cfg(test)]
mod tests {
    use super::*;
    use duckdb::Connection;
    use fossil_run_status::{ColumnStatus, EdgeStatus, VertexStatus};
    use std::collections::HashMap;

    /// `Catalog::register` lands a dataset as a queryable per-job schema backed by
    /// reference, and a second register (the reconciler / a duplicate completion)
    /// does NOT double-count — it cleanly replaces. Local Parquet stands in for
    /// the sink (the remote httpfs+creds path is de-risked separately by the
    /// `secret` unit tests + the live footer test).
    #[test]
    fn register_is_queryable_and_idempotent() {
        let dir = tempfile::tempdir().expect("tempdir");

        // Write a flat Parquet at the dataset's relative path, like a job output.
        let probe = Connection::open_in_memory().unwrap();
        let person = dir.path().join("Person.parquet");
        probe
            .execute_batch(&format!(
                "COPY (SELECT 1 AS id, 'a' AS name UNION ALL SELECT 2, 'b')
                 TO '{}' (FORMAT parquet);",
                person.display(),
            ))
            .unwrap();

        let dataset = RunStatus {
            version: 1,
            dest: dir.path().display().to_string(),
            vertices: vec![VertexStatus {
                vertex_type: "Person".into(),
                rdf_type: None,
                file: "Person.parquet".into(),
                count: Some(2),
                columns: vec![ColumnStatus {
                    name: "name".into(),
                    data_type: "string".into(),
                    rdf_uri: None,
                    xsd_datatype: None,
                }],
            }],
            edges: vec![],
        };

        let catalog = Catalog::open(dir.path()).expect("open catalog");
        catalog.register("abc123", &dataset, &HashMap::new()).expect("register");

        let count = |c: &Catalog| -> i64 {
            c.conn
                .lock()
                .unwrap()
                .query_row("SELECT count(*) FROM lake.\"job_abc123\".\"Person\"", [], |r| r.get(0))
                .expect("query registered table")
        };
        assert_eq!(count(&catalog), 2, "dataset registered + queryable by reference");
        assert!(person.exists(), "registered by reference — Parquet not copied away");

        catalog.register("abc123", &dataset, &HashMap::new()).expect("re-register");
        assert_eq!(count(&catalog), 2, "idempotent: re-register replaces, never doubles");
        // BYOS: the re-register's DROP SCHEMA CASCADE must NOT delete the
        // member's referenced Parquet — only the catalog metadata.
        assert!(person.exists(), "referenced Parquet survives DROP SCHEMA CASCADE (BYOS)");

        // The catalog is the authority on "is this registered" (reconciler input).
        let registered = catalog.registered_jobs().expect("list registered");
        assert!(Catalog::is_registered(&registered, "abc123"), "registered job is seen");
        assert!(!Catalog::is_registered(&registered, "never-ran"), "unknown job is not");

        // A FAILED registration (here: a dataset whose Parquet doesn't exist)
        // must roll back, NOT leave the connection in an aborted transaction that
        // poisons every later op. After it, the catalog still works.
        let broken = RunStatus {
            version: 1,
            dest: dir.path().display().to_string(),
            vertices: vec![VertexStatus {
                vertex_type: "Ghost".into(),
                rdf_type: None,
                file: "does-not-exist.parquet".into(),
                count: None,
                columns: vec![],
            }],
            edges: vec![],
        };
        assert!(catalog.register("broken", &broken, &HashMap::new()).is_err(), "missing Parquet fails");
        // The connection is NOT poisoned — this would error "transaction is aborted" without the rollback.
        assert_eq!(count(&catalog), 2, "catalog still usable after a failed registration");
        assert!(catalog.registered_jobs().is_ok(), "registered_jobs works after a failed registration");

        // unregister (job deleted): drops the schema, idempotently, and STILL
        // leaves the member's Parquet at the sink (BYOS).
        catalog.unregister("abc123").expect("unregister");
        catalog.unregister("abc123").expect("unregister is idempotent");
        assert!(
            !Catalog::is_registered(&catalog.registered_jobs().unwrap(), "abc123"),
            "unregistered job is gone from the catalog",
        );
        assert!(person.exists(), "unregister never deletes the member's Parquet (BYOS)");
    }

    /// Two edges sharing an `edge_type` but with different endpoints (e.g.
    /// `classifiedAs` from two source types) must NOT collide — they are distinct
    /// tables keyed by (src, edge, dst). Found live: naming edge tables by the
    /// predicate alone errored "Table ... already exists" on real RDF output.
    #[test]
    fn edges_sharing_a_predicate_do_not_collide() {
        let dir = tempfile::tempdir().unwrap();
        let probe = Connection::open_in_memory().unwrap();
        let edge = dir.path().join("edge.parquet");
        probe
            .execute_batch(&format!(
                "COPY (SELECT 0 AS src, 1 AS dst) TO '{}' (FORMAT parquet);",
                edge.display(),
            ))
            .unwrap();

        let edge_status = |src: &str, dst: &str| EdgeStatus {
            edge_type: "classifiedAs".into(),
            src_type: src.into(),
            dst_type: dst.into(),
            by_source: "edge.parquet".into(),
            by_target: "edge.parquet".into(),
            count: Some(1),
        };
        let dataset = RunStatus {
            version: 1,
            dest: dir.path().display().to_string(),
            vertices: vec![],
            edges: vec![edge_status("IfcBeam", "Class"), edge_status("IfcColumn", "Class")],
        };

        let catalog = Catalog::open(dir.path()).unwrap();
        catalog.register("e1", &dataset, &HashMap::new()).expect("two same-predicate edges register");

        let tables = catalog.datasets().unwrap();
        let names: Vec<&str> = tables[0].tables.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"IfcBeam_classifiedAs_Class"), "first edge table: {names:?}");
        assert!(names.contains(&"IfcColumn_classifiedAs_Class"), "second edge table: {names:?}");
    }

    /// De-risk (W1, first step): confirm the pinned `duckdb` 1.10502 crate can
    /// INSTALL + LOAD the `ducklake` extension and ATTACH a catalog. This is the
    /// load-mechanics check the integration-test probe couldn't make (duckdb is a
    /// normal dep, invisible to `tests/`). If this passes, the crate ships a
    /// ducklake that resolves; if it needs network to INSTALL, this is where we
    /// learn it.
    #[test]
    fn ducklake_extension_loads() {
        let conn = Connection::open_in_memory().expect("open in-memory duckdb");

        conn.execute_batch("INSTALL ducklake; LOAD ducklake;")
            .expect("INSTALL + LOAD ducklake");

        let dir = tempfile::tempdir().expect("tempdir");
        let catalog = dir.path().join("catalog.ducklake");
        let data = dir.path().join("data");

        conn.execute_batch(&format!(
            "ATTACH 'ducklake:{}' AS lake (DATA_PATH '{}');",
            catalog.display(),
            data.display(),
        ))
        .expect("ATTACH ducklake catalog");

        conn.execute_batch(
            "CREATE TABLE lake.t (id INTEGER, name VARCHAR);
             INSERT INTO lake.t VALUES (1, 'a'), (2, 'b');",
        )
        .expect("write to ducklake-backed table");

        let n: i64 = conn
            .query_row("SELECT count(*) FROM lake.t", [], |r| r.get(0))
            .expect("read back from ducklake table");
        assert_eq!(n, 2, "ducklake round-trip count");
    }

    /// De-risk: `httpfs` (the remote-read extension the catalog needs to read
    /// footers over object storage) also loads offline from the bundled crate.
    /// Pairs with `ducklake_extension_loads` as the version-pin (I7) CI guard.
    #[test]
    fn httpfs_loads_offline() {
        let conn = Connection::open_in_memory().expect("open in-memory duckdb");
        conn.execute_batch("INSTALL httpfs; LOAD httpfs;")
            .expect("INSTALL + LOAD httpfs");
    }

    /// De-risk (the one that matters): read a remote Parquet FOOTER over httpfs
    /// using credentials translated from the same object_store config map keasy
    /// signs output with. This is the exact mechanic `complete_job` will run to
    /// register a job's output by reference — and the part the local-file tests
    /// do NOT cover (httpfs + credentialed SECRET + remote read).
    ///
    /// `#[ignore]` because it needs a live S3 endpoint + creds. Run against the
    /// `make dev` substrate after a job has produced output:
    ///
    /// ```sh
    /// export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
    ///        AWS_DEFAULT_REGION=… AWS_ENDPOINT_URL=…           # the substrate creds
    /// export KEASY_DERISK_PARQUET_URL=s3://bucket/prefix/job/vertex/Person.parquet
    /// cargo test --manifest-path server/Cargo.toml --lib \
    ///   catalog::tests::reads_remote_parquet_footer -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs live S3 endpoint + creds (make dev substrate)"]
    fn reads_remote_parquet_footer() {
        let url = std::env::var("KEASY_DERISK_PARQUET_URL")
            .expect("set KEASY_DERISK_PARQUET_URL to a remote Parquet object");
        // Collect whatever provider env the substrate uses (S3 or Azure), then
        // translate by the URL scheme — same path `register` takes.
        let config: HashMap<String, String> = [
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION", "AWS_ENDPOINT_URL",
            "AZURE_STORAGE_ACCOUNT_NAME", "AZURE_STORAGE_ACCOUNT_KEY", "AZURE_STORAGE_SAS_KEY",
            "AZURE_STORAGE_CLIENT_ID", "AZURE_STORAGE_CLIENT_SECRET", "AZURE_STORAGE_TENANT_ID",
        ]
        .into_iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
        .collect();

        let secret_sql = match super::secret::plan("derisk", &url, &config) {
            super::secret::SecretPlan::Sql(s) => s,
            super::secret::SecretPlan::None => panic!("{url} parsed as local — set a remote URL"),
            super::secret::SecretPlan::Unsupported => panic!("no usable creds for {url} in env"),
        };

        let conn = Connection::open_in_memory().expect("open in-memory duckdb");
        conn.execute_batch(&format!("INSTALL httpfs; LOAD httpfs; INSTALL azure; LOAD azure; {secret_sql}"))
            .expect("load httpfs + azure + create secret");

        // parquet_file_metadata reads ONLY the footer — no full scan — which is
        // exactly what `ducklake_add_data_files` does to register by reference.
        let rows: i64 = conn
            .query_row(
                "SELECT num_rows FROM parquet_file_metadata(?)",
                [&url],
                |r| r.get(0),
            )
            .expect("read remote Parquet footer via httpfs + credentialed secret");
        assert!(rows >= 0, "footer reports a row count: {rows}");
        eprintln!("✓ remote footer read: {url} → {rows} rows");
    }
}






