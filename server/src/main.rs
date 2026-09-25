#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    if std::env::args().nth(1).as_deref() == Some("rekey") {
        match keasy_server::rekey() {
            Ok(n) => println!("sealed {n} credential(s) under KEASY_NEW_SECRET_KEY"),
            Err(e) => {
                eprintln!("FATAL: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    if let Err(e) = keasy_server::run().await {
        eprintln!("FATAL: {e}");
        std::process::exit(1);
    }
}
