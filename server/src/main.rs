use std::process::ExitCode;

use keasy_server::configuration;
use keasy_server::startup::Application;
use keasy_server::telemetry;

#[tokio::main]
async fn main() -> ExitCode {
    telemetry::init_subscriber(telemetry::get_subscriber("info", std::io::stdout));

    match serve().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("FATAL: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Configure from the environment, open the stores and serve until Ctrl+C.
async fn serve() -> Result<(), String> {
    let settings = configuration::get_configuration()?;
    let ctrl_c = async {
        if tokio::signal::ctrl_c().await.is_ok() {
            tracing::info!("Shutdown signal received");
        }
    };
    Application::build(settings)
        .await?
        .run_until_stopped(ctrl_c)
        .await
}
