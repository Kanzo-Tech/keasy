//! Prints the API contract. `make api` writes it to `api/openapi.json`.

fn main() {
    let spec = keasy_server::openapi()
        .to_pretty_json()
        .expect("the contract serializes");
    println!("{spec}");
}
