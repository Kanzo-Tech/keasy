//! Subprocess wrapper around the `fossil` CLI's W0b `run` path.
//!
//! **W0e Branch-by-Abstraction seam.** Keasy runs fossil as a process — the same
//! way it already consumes the editor, viewer, and LSP — rather than embedding
//! the compiler as a Rust library. `runner.rs` executes jobs through this seam;
//! the IR-walking validate path (`pipeline_extract` / `ProgramQuery`) is gone and
//! the catalog reads the output spec from the run manifest (`RunStatus`).
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

use secrecy::SecretString;

/// Environment variable overriding the `fossil` binary location. Falls back to
/// `fossil` on `PATH` when unset.
const FOSSIL_BIN_ENV: &str = "FOSSIL_BIN";

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

/// The `fossil run --output-json` status — `RunStatus { dest, vertices, edges }`
/// — reused VERBATIM from the canonical `fossil-run-status` crate (one source of
/// truth: the CLI serialises exactly this struct, keasy deserialises it; the TS
/// type for the web is `JsonSchema`-codegen'd from the same crate). No
/// hand-mirrored copy here.
pub use fossil_run_status::{
    ColumnStatus, EdgeStatus, ProviderInfo, RunStatus, SourceRefInfo, VertexStatus,
};

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
    /// `--output-json` stdout was not a parseable [`RunStatus`].
    #[error("could not parse fossil --output-json status: {source} (stdout: {stdout})")]
    Parse {
        stdout: String,
        #[source]
        source: serde_json::Error,
    },
    /// The `fossil` binary speaks a wire-contract version this host does not
    /// understand (the binary and host drifted). Surfaced instead of silently
    /// misreading the payload.
    #[error("fossil wire-contract version {got} is incompatible with host version {expected}")]
    WireVersion { got: u32, expected: u32 },
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

    /// Bound the child `fossil`/`DuckDB` memory + CPU — multi-instance OOM
    /// protection. An uncapped DuckDB targets ~80% of physical RAM, so a few
    /// concurrent jobs (across keasy instances sharing a small host) can OOM the
    /// box. The CLI reads `FOSSIL_DUCKDB_{MEMORY_LIMIT,THREADS,TEMP_DIR}`
    /// ([`fossil_runtime::apply_resource_limits`]). A value already in keasy's
    /// env is inherited by the child (deployment override); otherwise a
    /// conservative default is set so the cap is never silently absent. The
    /// temp dir lets DuckDB spill (rather than error) once the limit is hit.
    fn apply_duckdb_limits(command: &mut Command, anchor: Option<&Path>) {
        if std::env::var_os("FOSSIL_DUCKDB_MEMORY_LIMIT").is_none() {
            command.env("FOSSIL_DUCKDB_MEMORY_LIMIT", "512MB");
        }
        if std::env::var_os("FOSSIL_DUCKDB_THREADS").is_none() {
            command.env("FOSSIL_DUCKDB_THREADS", "2");
        }
        if std::env::var_os("FOSSIL_DUCKDB_TEMP_DIR").is_none() {
            let tmp = anchor.map_or_else(std::env::temp_dir, Path::to_path_buf);
            command.env("FOSSIL_DUCKDB_TEMP_DIR", tmp);
        }
    }

    /// List the data-source providers fossil supports via `fossil providers
    /// --output-json`. Host boundary: fossil owns which sources it can read; the
    /// keasy `/v1/providers` endpoint surfaces this verbatim. No stdin payload,
    /// no dest — a pure capability query.
    ///
    /// # Errors
    ///
    /// Returns [`FossilRunError`] if the binary cannot be spawned, it exits
    /// non-zero, or emits an unparseable provider list.
    pub fn run_providers(&self) -> Result<Vec<ProviderInfo>, FossilRunError> {
        let stdout = self.spawn_capture(
            vec!["providers".to_string(), "--output-json".to_string()],
            "",
            None,
        )?;
        serde_json::from_str(stdout.trim()).map_err(|source| FossilRunError::Parse {
            stdout,
            source,
        })
    }

    /// List a program's external references via `fossil refs <file>
    /// --output-json` — the typed lineage (each `@conn`/URL/path the program
    /// names, per data + `schema =` + `select =`). keasy reads this to derive a
    /// job's connections without scanning the script text. Parse-only: no stdin,
    /// no creds, no dest. The script is written to a temp `.fossil` the CLI reads.
    ///
    /// # Errors
    ///
    /// Returns [`FossilRunError`] if the temp file can't be written, the binary
    /// can't be spawned, it exits non-zero, or emits an unparseable ref list.
    pub fn run_refs(&self, script: &str) -> Result<Vec<SourceRefInfo>, FossilRunError> {
        let file = std::env::temp_dir().join(format!("keasy-refs-{}.fossil", std::process::id()));
        std::fs::write(&file, script).map_err(|source| FossilRunError::Spawn {
            binary: file.to_string_lossy().into_owned(),
            source,
        })?;
        let result = self.spawn_capture(
            vec![
                "refs".to_string(),
                file.to_string_lossy().into_owned(),
                "--output-json".to_string(),
            ],
            "",
            None,
        );
        let _ = std::fs::remove_file(&file);
        let stdout = result?;
        serde_json::from_str(stdout.trim()).map_err(|source| FossilRunError::Parse {
            stdout,
            source,
        })
    }

    /// Spawn the `fossil` binary with `args`, pipe `stdin_payload`, and capture
    /// its stdout (the `--output-json` document). `anchor` (when set) is the
    /// child's working directory (so a program's relative source paths resolve)
    /// AND the DuckDB spill dir. The single subprocess path shared by
    /// [`Self::run_providers`] and [`Self::run_refs`]; each caller parses the
    /// captured stdout into its own contract type.
    fn spawn_capture(
        &self,
        args: Vec<String>,
        stdin_payload: &str,
        anchor: Option<&Path>,
    ) -> Result<String, FossilRunError> {
        let spawn_err = |source: std::io::Error| FossilRunError::Spawn {
            binary: self.binary.to_string_lossy().into_owned(),
            source,
        };

        let mut command = Command::new(&self.binary);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = anchor {
            command.current_dir(dir);
        }
        Self::apply_duckdb_limits(&mut command, anchor);

        let mut child = command.spawn().map_err(spawn_err)?;
        // Write the stdin payload, then drop stdin so the CLI's read-to-EOF
        // returns. Scoped so the borrow ends before `wait_with_output`.
        {
            let mut stdin = child.stdin.take().ok_or_else(|| {
                spawn_err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "child stdin unavailable",
                ))
            })?;
            stdin.write_all(stdin_payload.as_bytes()).map_err(spawn_err)?;
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

        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}
