use utoipa::OpenApi;
use keasy_server::openapi::ApiDoc;

fn main() {
    let doc = ApiDoc::openapi();
    let json = serde_json::to_string_pretty(&doc).unwrap();
    std::fs::write("../openapi.json", &json).unwrap();
    eprintln!("openapi.json written ({} bytes)", json.len());
}
