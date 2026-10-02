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

/// The roles the spec publishes are the realm's: Terraform keeps its copy of
/// the names, and this holds the two together.
#[test]
fn the_published_roles_are_the_realms() {
    let terraform = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../infra/terraform/realm/tenants_keycloak.tf"),
    )
    .unwrap();
    let mut realm = Vec::new();
    let mut in_role = false;
    for line in terraform.lines().map(str::trim) {
        if line.starts_with("resource \"keycloak_role\"") {
            in_role = true;
        } else if in_role && line.starts_with("name") {
            let name = line.split('"').nth(1).expect("a quoted role name");
            realm.push(serde_json::Value::from(name));
            in_role = false;
        }
    }
    assert_eq!(schema("Role")["enum"], serde_json::Value::from(realm));
    assert_eq!(
        schema("Role")["enum"],
        serde_json::json!(["owner", "member"])
    );
}
