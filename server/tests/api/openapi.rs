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

fn schema(name: &str) -> serde_json::Value {
    let spec = serde_json::to_value(keasy_server::startup::openapi()).unwrap();
    spec["components"]["schemas"][name].clone()
}

/// What a form checks before it sends: the spellings `parse` holds, published.
#[test]
fn the_spellings_are_published_with_their_rule() {
    use keasy_server::domain::{JobFolder, ResourceName};

    for (name, pattern, max) in [
        ("JobFolder", JobFolder::PATTERN, JobFolder::MAX_LEN),
        ("ResourceName", ResourceName::PATTERN, ResourceName::MAX_LEN),
    ] {
        let schema = schema(name);
        assert_eq!(schema["type"], "string", "{name}");
        assert_eq!(schema["pattern"], pattern, "{name}");
        assert_eq!(schema["maxLength"], max, "{name}");
        assert_eq!(schema["minLength"], 1, "{name}");
    }
}

/// The roles the spec publishes are the ones keasy registers on its client
/// (`infra/auth/main.tf`), in the order their composites nest.
#[test]
fn the_published_roles_are_the_registered_ones() {
    let terraform = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../infra/auth/main.tf"),
    )
    .unwrap();
    let block = terraform
        .split("roles = {")
        .nth(1)
        .and_then(|rest| rest.split("\n  }").next())
        .expect("a roles block");
    let registered: Vec<_> = block
        .lines()
        .filter_map(|l| l.trim().split_once(" = {").map(|(name, _)| name.trim()))
        .map(serde_json::Value::from)
        .collect();
    assert_eq!(schema("Role")["enum"], serde_json::Value::from(registered));
    assert_eq!(
        schema("Role")["enum"],
        serde_json::json!(["reader", "editor", "admin"])
    );
}
