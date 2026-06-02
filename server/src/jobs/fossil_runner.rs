//! Subprocess wrapper around the `fossil` CLI's W0b `run` path.
//!
//! **W0e Branch-by-Abstraction seam.** Keasy stops embedding fossil as a Rust
//! library (`fossil-lang` / `fossil-stdlib` / …) and consumes it as a process —
//! the same way it already consumes the editor, viewer, and LSP. This module is
//! the seam; it is intentionally NOT wired into the job runner yet (call sites
//! in `runner.rs` migrate onto it, then the embedded-library deps and
//! `pipeline_extract.rs` get deleted).
//!
//! Protocol contract (owned + end-to-end-tested on the rmlext side, see
//! `crates/fossil-cli/tests/run_w0b.rs`):
//!
//! ```text
//! fossil run <file> --dest <url> --output-json --creds-stdin
//! ```
//!
//! No `--shape`: the output descriptor is program-resident (the `.fossil`'s
//! typed mapping synthesises the vertex decomposition; an in-program `shex!()`
//! refines it). Cloud credentials ride **stdin**, never argv/env — a single JSON
//! document carrying the dest's typed cloud secret and the per-`@conn` source
//! connection map (url + secret). The CLI installs each as a scoped DuckDB
//! `CREATE SECRET`. `<url>` may be `file://` or a cloud object store (`s3://`,
//! `az://`, …); the CLI's DuckDB writes both Parquet and the YAML manifests.
//!
//! The CLI emits a single structured status object on stdout:
//!
//! ```json
//! { "dest": "s3://…",
//!   "vertices": [ { "type": "Person", "file": "vertex/Person.parquet",
//!                   "count": 5, "columns": [ { "name": "name", "data_type": "string" } ] } ],
//!   "edges":    [ { "edge_type": "knows", "src_type": "Person", "dst_type": "Person",
//!                   "by_source": "edge/…/by_source.parquet", "by_target": "…", "count": 2 } ] }
//! ```

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;

/// Environment variable overriding the `fossil` binary location. Falls back to
/// `fossil` on `PATH` when unset.
const FOSSIL_BIN_ENV: &str = "FOSSIL_BIN";

/// Cloud secrets + source connections piped to `fossil run --creds-stdin`.
/// Secret values are [`SecretString`] so they stay off `Debug`/logs; they are
/// exposed only when serialising to the child's stdin pipe
/// ([`RunCreds::to_stdin_json`]).
#[derive(Debug, Default, Clone)]
pub struct RunCreds {
    /// Cloud secret for the `--dest` URL (`None` ⇒ local/public dest).
    pub dest: Option<CloudSecret>,
    /// Per-`@conn-name` source resolution: base URL + read secret.
    pub connections: HashMap<String, ConnectionCreds>,
}

/// A `.fossil` `@conn-name` source: its base URL plus the read secret.
#[derive(Debug, Default, Clone)]
pub struct ConnectionCreds {
    /// Base URL the connection resolves to (e.g. `s3://bucket/prefix`).
    pub url: String,
    /// Cloud secret for reading under `url` (`None` ⇒ public-URL source).
    pub secret: Option<CloudSecret>,
}

/// A DuckDB `CREATE SECRET` spec: provider type + parameters. The keasy host
/// projects a connection's provider + stored credentials into this from its
/// `ProviderSchema`; the CLI renders it into a scoped `CREATE SECRET`.
#[derive(Debug, Default, Clone)]
pub struct CloudSecret {
    /// DuckDB secret provider — `"s3"`, `"azure"`, `"gcs"`.
    pub secret_type: String,
    /// `CREATE SECRET` parameter names (`KEY_ID`, `SECRET`, `REGION`, …) → values.
    pub params: HashMap<String, SecretString>,
}

impl RunCreds {
    /// Serialise to the `--creds-stdin` JSON the CLI expects. Secret values are
    /// exposed ONLY here, to be written to the child's stdin pipe — never logged.
    fn to_stdin_json(&self) -> String {
        fn secret_json(s: &Option<CloudSecret>) -> serde_json::Value {
            match s {
                Some(cs) => {
                    let params: serde_json::Map<String, serde_json::Value> = cs
                        .params
                        .iter()
                        .map(|(k, v)| {
                            (k.clone(), serde_json::Value::String(v.expose_secret().to_owned()))
                        })
                        .collect();
                    serde_json::json!({ "type": cs.secret_type, "params": params })
                }
                None => serde_json::Value::Null,
            }
        }
        let connections: serde_json::Map<String, serde_json::Value> = self
            .connections
            .iter()
            .map(|(name, c)| {
                (
                    name.clone(),
                    serde_json::json!({ "url": c.url, "secret": secret_json(&c.secret) }),
                )
            })
            .collect();
        serde_json::json!({
            "dest": { "secret": secret_json(&self.dest) },
            "connections": connections,
        })
        .to_string()
    }
}

/// One vertex type in a [`RunOutput`] — its dataset-relative Parquet, row count,
/// and property columns (the structure keasy persists; column-value statistics
/// are computed browser-side via DuckDB-WASM over the mounted Parquet).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct VertexInfo {
    /// The vertex type / `GraphAr` `type` (e.g. `Person`).
    #[serde(rename = "type")]
    pub type_name: String,
    /// Dataset-relative Parquet path, e.g. `vertex/Person.parquet`.
    pub file: String,
    /// Row count (Parquet footer metadata), `None` if the count query failed.
    pub count: Option<i64>,
    /// The vertex's property columns.
    pub columns: Vec<ColumnInfo>,
}

/// A property column of a [`VertexInfo`].
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ColumnInfo {
    /// Column / predicate local name.
    pub name: String,
    /// `GraphAr` data-type spelling (`string`, `int64`, `double`, …).
    pub data_type: String,
}

/// One edge type in a [`RunOutput`] — its CSR/CSC Parquet pair and endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct EdgeInfo {
    /// The edge type / predicate local name.
    pub edge_type: String,
    /// Source vertex type.
    pub src_type: String,
    /// Destination vertex type.
    pub dst_type: String,
    /// CSR-ordered (`by_source`) Parquet, dataset-relative.
    pub by_source: String,
    /// CSC-ordered (`by_target`) Parquet, dataset-relative.
    pub by_target: String,
    /// Edge count (Parquet footer metadata), `None` if the count query failed.
    pub count: Option<i64>,
}

/// Parsed `--output-json` status from a successful `fossil run` (W0b path).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RunOutput {
    /// Destination URL the GraphAr dataset was written under (echoes `--dest`).
    pub dest: String,
    /// One entry per emitted vertex type.
    pub vertices: Vec<VertexInfo>,
    /// One entry per emitted edge type (empty until a shape/Phase-B adds edges).
    pub edges: Vec<EdgeInfo>,
}

/// Failure modes of a `fossil run` subprocess invocation.
#[derive(Debug, thiserror::Error)]
pub enum FossilRunError {
    /// The `fossil` binary could not be spawned, or its stdin/stdout pipe failed.
    #[error("failed to run fossil ({binary}): {source}")]
    Spawn {
        binary: String,
        #[source]
        source: std::io::Error,
    },
    /// `fossil` exited non-zero. Carries the captured stderr for diagnosis.
    #[error("fossil run exited with {code}: {stderr}")]
    NonZero { code: String, stderr: String },
    /// `--output-json` stdout was not a parseable [`RunOutput`].
    #[error("could not parse fossil --output-json status: {source} (stdout: {stdout})")]
    Parse {
        stdout: String,
        #[source]
        source: serde_json::Error,
    },
}

/// Locates and invokes the `fossil` CLI.
#[derive(Debug, Clone)]
pub struct FossilRunner {
    binary: PathBuf,
}

impl Default for FossilRunner {
    fn default() -> Self {
        Self::from_env()
    }
}

impl FossilRunner {
    /// Resolve the binary from `$FOSSIL_BIN`, falling back to `fossil` on `PATH`.
    #[must_use]
    pub fn from_env() -> Self {
        let binary = std::env::var_os(FOSSIL_BIN_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("fossil"));
        Self { binary }
    }

    /// Use an explicit binary path (tests, pinned deployments).
    #[must_use]
    pub fn new(binary: impl Into<PathBuf>) -> Self {
        Self {
            binary: binary.into(),
        }
    }

    /// The argv passed to the binary (split out so arg construction is unit-
    /// testable without spawning a process). No `--shape` — the descriptor is
    /// program-resident; `--creds-stdin` is always set (the payload may be empty
    /// for a fully-local run).
    fn run_args(fossil_file: &Path, dest_url: &str) -> Vec<String> {
        vec![
            "run".to_string(),
            fossil_file.to_string_lossy().into_owned(),
            "--dest".to_string(),
            dest_url.to_string(),
            "--output-json".to_string(),
            "--creds-stdin".to_string(),
        ]
    }

    /// Run a fossil pipeline to GraphAr under `dest_url`. `fossil_file` is a
    /// filesystem path the CLI reads; the working directory is anchored to its
    /// parent so any relative source paths resolve. `creds` is piped on stdin.
    ///
    /// # Errors
    ///
    /// Returns [`FossilRunError`] if the binary cannot be spawned, its stdin
    /// cannot be written, it exits non-zero, or emits unparseable `--output-json`.
    pub fn run(
        &self,
        fossil_file: &Path,
        dest_url: &str,
        creds: &RunCreds,
    ) -> Result<RunOutput, FossilRunError> {
        let spawn_err = |source: std::io::Error| FossilRunError::Spawn {
            binary: self.binary.to_string_lossy().into_owned(),
            source,
        };

        let mut command = Command::new(&self.binary);
        command
            .args(Self::run_args(fossil_file, dest_url))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(parent) = fossil_file.parent().filter(|p| !p.as_os_str().is_empty()) {
            command.current_dir(parent);
        }

        let mut child = command.spawn().map_err(spawn_err)?;
        // Write the creds payload, then drop stdin so the CLI's read-to-EOF
        // returns. Scoped so the borrow ends before `wait_with_output`.
        {
            let mut stdin = child.stdin.take().ok_or_else(|| {
                spawn_err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "child stdin unavailable",
                ))
            })?;
            stdin
                .write_all(creds.to_stdin_json().as_bytes())
                .map_err(spawn_err)?;
        }

        let output = child.wait_with_output().map_err(spawn_err)?;
        if !output.status.success() {
            return Err(FossilRunError::NonZero {
                code: output
                    .status
                    .code()
                    .map_or_else(|| "signal".to_string(), |c| c.to_string()),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }

        Self::parse_status(&String::from_utf8_lossy(&output.stdout))
    }

    /// Parse the `--output-json` stdout into a [`RunOutput`].
    fn parse_status(stdout: &str) -> Result<RunOutput, FossilRunError> {
        serde_json::from_str(stdout.trim()).map_err(|source| FossilRunError::Parse {
            stdout: stdout.to_string(),
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_args_match_the_cli_contract() {
        let args = FossilRunner::run_args(
            Path::new("/tmp/job/pipeline.fossil"),
            "s3://bucket/job-123",
        );
        assert_eq!(
            args,
            vec![
                "run",
                "/tmp/job/pipeline.fossil",
                "--dest",
                "s3://bucket/job-123",
                "--output-json",
                "--creds-stdin",
            ]
        );
    }

    fn s3_secret(pairs: &[(&str, &str)]) -> CloudSecret {
        CloudSecret {
            secret_type: "s3".to_string(),
            params: pairs
                .iter()
                .map(|(k, v)| ((*k).to_string(), SecretString::from(*v)))
                .collect(),
        }
    }

    #[test]
    fn creds_serialise_to_the_stdin_contract() {
        let mut connections = HashMap::new();
        connections.insert(
            "sales".to_string(),
            ConnectionCreds {
                url: "s3://bucket/prefix".to_string(),
                secret: Some(s3_secret(&[("KEY_ID", "AKIA")])),
            },
        );
        let creds = RunCreds {
            dest: Some(s3_secret(&[("REGION", "eu-west-1")])),
            connections,
        };

        let json: serde_json::Value =
            serde_json::from_str(&creds.to_stdin_json()).expect("valid JSON");
        assert_eq!(json["dest"]["secret"]["type"], "s3");
        assert_eq!(json["dest"]["secret"]["params"]["REGION"], "eu-west-1");
        assert_eq!(json["connections"]["sales"]["url"], "s3://bucket/prefix");
        assert_eq!(
            json["connections"]["sales"]["secret"]["params"]["KEY_ID"],
            "AKIA"
        );
    }

    #[test]
    fn no_secret_serialises_as_null() {
        let creds = RunCreds::default();
        let json: serde_json::Value =
            serde_json::from_str(&creds.to_stdin_json()).expect("valid JSON");
        assert!(json["dest"]["secret"].is_null());
    }

    #[test]
    fn secrets_never_appear_in_debug() {
        let creds = RunCreds {
            dest: Some(s3_secret(&[("SECRET", "leaky-value")])),
            connections: HashMap::new(),
        };
        assert!(
            !format!("{creds:?}").contains("leaky-value"),
            "secret leaked through Debug"
        );
    }

    #[test]
    fn parses_the_structured_output_json() {
        // Mirrors crates/fossil-cli/src/main.rs cmd_run_w0b `--output-json`.
        let stdout = r#"{
            "dest": "s3://bucket/job-123",
            "vertices": [
                { "type": "Person", "file": "vertex/Person.parquet", "count": 5,
                  "columns": [ { "name": "name", "data_type": "string" } ] }
            ],
            "edges": [
                { "edge_type": "knows", "src_type": "Person", "dst_type": "Person",
                  "by_source": "edge/Person_knows_Person/by_source.parquet",
                  "by_target": "edge/Person_knows_Person/by_target.parquet", "count": 2 }
            ]
        }"#;
        let parsed = FossilRunner::parse_status(stdout).expect("parse status");
        assert_eq!(parsed.dest, "s3://bucket/job-123");
        assert_eq!(parsed.vertices.len(), 1);
        let v = &parsed.vertices[0];
        assert_eq!(v.type_name, "Person");
        assert_eq!(v.file, "vertex/Person.parquet");
        assert_eq!(v.count, Some(5));
        assert_eq!(v.columns, vec![ColumnInfo {
            name: "name".to_string(),
            data_type: "string".to_string(),
        }]);
        assert_eq!(parsed.edges.len(), 1);
        assert_eq!(parsed.edges[0].edge_type, "knows");
        assert_eq!(parsed.edges[0].count, Some(2));
    }

    #[test]
    fn surfaces_unparseable_stdout_as_parse_error() {
        let err = FossilRunner::parse_status("not json").unwrap_err();
        assert!(matches!(err, FossilRunError::Parse { .. }));
    }
}
