//! End-to-end check of the keasy→fossil subprocess contract.
//!
//! Spawns the real `fossil` binary to query its provider set (the surface keasy
//! still shells out to until providers move to WASM). Env-gated: set `FOSSIL_BIN`
//! to a built `fossil` to run it; otherwise it skips (so CI without the binary
//! stays green).
//!
//!   FOSSIL_BIN=../../rmlext/target/debug/fossil cargo test -p keasy-server \
//!     --test fossil_subprocess -- --nocapture

use keasy_server::jobs::fossil_runner::FossilRunner;

#[test]
fn fossil_providers_lists_the_source_constructors() {
    let Ok(bin) = std::env::var("FOSSIL_BIN") else {
        eprintln!("SKIP: set FOSSIL_BIN to a built `fossil` binary to run this test");
        return;
    };

    // `/v1/providers` is served from this — fossil owns the source set.
    let providers = FossilRunner::new(&bin)
        .run_providers()
        .expect("fossil providers succeeds");

    let names: Vec<&str> = providers.iter().map(|p| p.name.as_str()).collect();
    assert!(names.contains(&"csv"), "expected the csv provider (got {names:?})");
    assert!(names.contains(&"json"), "expected the json provider (got {names:?})");
    assert!(names.contains(&"parquet"), "expected the parquet provider (got {names:?})");

    let csv = providers.iter().find(|p| p.name == "csv").expect("csv provider");
    assert_eq!(csv.extensions, vec!["csv".to_string()], "csv reads .csv");
}
