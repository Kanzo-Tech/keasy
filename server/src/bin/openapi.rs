use utoipa::OpenApi;
use keasy_server::openapi::ApiDoc;

fn main() {
    let doc = ApiDoc::openapi();
    let json = serde_json::to_string_pretty(&doc).unwrap();
    let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../openapi.json");
    std::fs::write(&out, &json).unwrap();
    eprintln!("openapi.json written ({} bytes)", json.len());
}
