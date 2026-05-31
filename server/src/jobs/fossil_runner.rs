//! Subprocess wrapper around the `fossil` CLI's W0b `run` path.
//!
//! **W0e Branch-by-Abstraction seam.** Keasy stops embedding fossil as a Rust
//! library (`fossil-lang` / `fossil-stdlib` / …) and consumes it as a process —
//! the same way it already consumes the editor, viewer, and LSP. This module is
//! the seam; it is intentionally NOT wired into the job runner yet (call sites
//! in `runner.rs` migrate onto it one at a time, then the embedded-library deps
//! and `pipeline_extract.rs` get deleted).
//!
//! Protocol contract (owned + end-to-end-tested on the rmlext side, see
//! `crates/fossil-cli/tests/run_w0b.rs`):
//!
//! ```text
//! fossil run <file> --shape <shex> --dest <url> --output-json
//! ```
//!
//! writes GraphAr Parquet + YAML manifests under `<url>` and emits a single
//! JSON status object on stdout:
//!
//! ```json
//! { "dest": "file:///…", "vertices": ["vertex/…"], "edges": ["edge/…"] }
//! ```
//!
//! For now `<url>` must be a `file://` destination — cloud uploads need the
//! W0b/7 uploader, and credential plumbing (over stdin) lands with it.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

/// Environment variable overriding the `fossil` binary location. Falls back to
/// `fossil` on `PATH` when unset.
const FOSSIL_BIN_ENV: &str = "FOSSIL_BIN";

/// Parsed `--output-json` status from a successful `fossil run` (W0b path).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RunOutput {
    /// Destination URL the GraphAr dataset was written under (echoes `--dest`).
    pub dest: String,
    /// Dataset-relative vertex manifest paths, e.g. `vertex/Person.vertex.yml`.
    pub vertices: Vec<String>,
    /// Dataset-relative edge manifest paths, e.g.
    /// `edge/Person_knows_Person/Person_knows_Person.edge.yml`.
    pub edges: Vec<String>,
}

/// Failure modes of a `fossil run` subprocess invocation.
#[derive(Debug, thiserror::Error)]
pub enum FossilRunError {
    /// The `fossil` binary could not be spawned (missing, not executable).
    #[error("failed to spawn fossil ({binary}): {source}")]
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
    /// testable without spawning a process).
    fn run_args(fossil_file: &Path, shape_file: &Path, dest_url: &str) -> Vec<String> {
        vec![
            "run".to_string(),
            fossil_file.to_string_lossy().into_owned(),
            "--shape".to_string(),
            shape_file.to_string_lossy().into_owned(),
            "--dest".to_string(),
            dest_url.to_string(),
            "--output-json".to_string(),
        ]
    }

    /// Run a fossil pipeline to GraphAr under `dest_url` (a `file://` URL for
    /// now). `fossil_file` and `shape_file` are filesystem paths the CLI reads;
    /// the working directory is anchored to the fossil file's parent so the
    /// pipeline's relative input paths (e.g. `examples/users.csv`) resolve.
    ///
    /// # Errors
    ///
    /// Returns [`FossilRunError`] if the binary cannot be spawned, exits
    /// non-zero, or emits unparseable `--output-json`.
    pub fn run(
        &self,
        fossil_file: &Path,
        shape_file: &Path,
        dest_url: &str,
    ) -> Result<RunOutput, FossilRunError> {
        let mut command = Command::new(&self.binary);
        command.args(Self::run_args(fossil_file, shape_file, dest_url));
        if let Some(parent) = fossil_file.parent().filter(|p| !p.as_os_str().is_empty()) {
            command.current_dir(parent);
        }

        let output = command.output().map_err(|source| FossilRunError::Spawn {
            binary: self.binary.to_string_lossy().into_owned(),
            source,
        })?;

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
    fn run_args_match_the_cli_w0b_contract() {
        let args = FossilRunner::run_args(
            Path::new("/tmp/job/pipeline.fossil"),
            Path::new("/tmp/job/shape.shex"),
            "file:///tmp/job/graph",
        );
        assert_eq!(
            args,
            vec![
                "run",
                "/tmp/job/pipeline.fossil",
                "--shape",
                "/tmp/job/shape.shex",
                "--dest",
                "file:///tmp/job/graph",
                "--output-json",
            ]
        );
    }

    #[test]
    fn parses_the_output_json_status() {
        // Shape mirrors crates/fossil-cli/src/main.rs cmd_run_w0b + the
        // run_w0b.rs integration assertions.
        let stdout = r#"{
            "dest": "file:///tmp/job/graph",
            "vertices": ["vertex/Person.vertex.yml"],
            "edges": ["edge/Person_knows_Person/Person_knows_Person.edge.yml"]
        }"#;
        let parsed = FossilRunner::parse_status(stdout).expect("parse status");
        assert_eq!(parsed.dest, "file:///tmp/job/graph");
        assert_eq!(parsed.vertices, vec!["vertex/Person.vertex.yml"]);
        assert_eq!(
            parsed.edges,
            vec!["edge/Person_knows_Person/Person_knows_Person.edge.yml"]
        );
    }

    #[test]
    fn surfaces_unparseable_stdout_as_parse_error() {
        let err = FossilRunner::parse_status("not json").unwrap_err();
        assert!(matches!(err, FossilRunError::Parse { .. }));
    }
}
