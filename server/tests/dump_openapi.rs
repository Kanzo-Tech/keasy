use keasy_server::openapi::ApiDoc;
use utoipa::OpenApi;

#[test]
fn dump_openapi_json() {
    let doc = ApiDoc::openapi();
    let json = serde_json::to_string_pretty(&doc).unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("openapi.json");
    std::fs::write(&path, &json).unwrap();
    eprintln!("Wrote OpenAPI schema to {}", path.display());
}
