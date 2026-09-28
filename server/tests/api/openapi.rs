//! The committed contract, as a golden file: `api/openapi.json` must be what
//! the routes publish. `UPDATE_EXPECT=1` writes it instead (`make api`).

use std::path::Path;

#[test]
fn the_committed_contract_is_the_one_the_routes_publish() {
    let spec = keasy_server::startup::openapi()
        .to_pretty_json()
        .expect("the contract serializes")
        + "\n";
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../api/openapi.json");
    if std::env::var_os("UPDATE_EXPECT").is_some() {
        std::fs::write(&path, &spec).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    if committed != spec {
        let line = committed
            .lines()
            .zip(spec.lines())
            .position(|(a, b)| a != b)
            .unwrap_or_else(|| committed.lines().count().min(spec.lines().count()));
        panic!(
            "api/openapi.json is stale from line {}: run `make api`",
            line + 1
        );
    }
}
