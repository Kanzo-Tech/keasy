use keasy_server::config::ServerConfig;
use keasy_server::startup::Application;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let config = ServerConfig::from_env();
    let app = Application::build(config).await;
    app.run_until_stopped().await;
}
