//! End-to-end check of the keasy→fossil subprocess contract (W0e slice 6b).
//!
//! Spawns the real `fossil` binary on a minimal pipeline, writing GraphAr to a
//! `file://` dest, and asserts the structured `RunStatus` keasy's job runner
//! consumes. Env-gated: set `FOSSIL_BIN` to a built `fossil` to run it;
//! otherwise it skips (so CI without the binary stays green).
//!
//!   FOSSIL_BIN=../../rmlext/target/debug/fossil cargo test -p keasy-server \
//!     --test fossil_subprocess -- --nocapture

use std::path::PathBuf;

use keasy_server::jobs::fossil_runner::{FossilRunner, RunCreds};

/// The canonical walking-skeleton pipeline: CSV → one vertex type with a
/// templated IRI and one string property. Mirrors rmlext `examples/hello.fossil`.
const PIPELINE: &str = r#"prefix ex: <https://example.org/>

users := io.csv("users.csv")

User : ex:Person from users
    iri = `${ex:}user/${.id}`
    ex:name = .name
"#;

const USERS_CSV: &str = "id,name\n1,Alice\n2,Bob\n3,Carol\n4,Dave\n5,Eve\n";

fn workdir() -> PathBuf {
    let dir = std::env::temp_dir().join("keasy-fossil-subprocess-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create workdir");
    dir
}

#[test]
fn fossil_run_writes_graphar_and_returns_run_status() {
    let Ok(bin) = std::env::var("FOSSIL_BIN") else {
        eprintln!("SKIP: set FOSSIL_BIN to a built `fossil` binary to run this test");
        return;
    };

    let dir = workdir();
    let fossil_file = dir.join("pipeline.fossil");
    std::fs::write(&fossil_file, PIPELINE).expect("write pipeline");
    // The program's relative `io.csv("users.csv")` resolves against the file's
    // parent — FossilRunner anchors the child's cwd there.
    std::fs::write(dir.join("users.csv"), USERS_CSV).expect("write csv");

    let dest_dir = dir.join("out");
    std::fs::create_dir_all(&dest_dir).expect("create dest");
    let dest_url = format!("file://{}", dest_dir.display());

    // Fully local run: no cloud secrets, no @conn sources.
    let status = FossilRunner::new(&bin)
        .run(&fossil_file, &dest_url, &RunCreds::default())
        .expect("fossil run succeeds");

    assert_eq!(status.dest, dest_url, "RunStatus echoes the dest");
    assert!(!status.vertices.is_empty(), "expected at least one vertex type");

    let total: i64 = status.vertices.iter().filter_map(|v| v.count).sum();
    assert_eq!(total, 5, "5 CSV rows → 5 vertices (got {status:?})");

    let has_name = status
        .vertices
        .iter()
        .any(|v| v.columns.iter().any(|c| c.name == "name"));
    assert!(has_name, "expected a `name` property column (got {status:?})");

    // The dataset Parquet was actually written under the file:// dest.
    let wrote_parquet = status
        .vertices
        .iter()
        .any(|v| dest_dir.join(&v.file).exists());
    assert!(wrote_parquet, "vertex Parquet missing under dest (got {status:?})");
}
