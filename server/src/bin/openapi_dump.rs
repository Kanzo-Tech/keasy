use keasy_server::openapi::ApiDoc;
use utoipa::OpenApi;

fn main() {
    let doc = ApiDoc::openapi();
    println!("{}", serde_json::to_string_pretty(&doc).unwrap());
}
