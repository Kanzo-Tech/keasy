#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    if let Err(e) = keasy_server::run().await {
        eprintln!("FATAL: {e}");
        std::process::exit(1);
    }
}
