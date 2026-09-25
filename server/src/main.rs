use std::process::ExitCode;

use keasy_server::configuration::{self, DatabaseSettings};
use keasy_server::startup::Application;
use keasy_server::{credentials, telemetry};

#[tokio::main]
async fn main() -> ExitCode {
    telemetry::init_subscriber(telemetry::get_subscriber("info", std::io::stdout));

    let outcome = match std::env::args().nth(1).as_deref() {
        None => serve().await,
        Some("rekey") => rekey(),
        Some(other) => Err(format!(
            "unknown command {other:?}: run with no command to serve, or `rekey`"
        )),
    };
    match outcome {
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
    Application::build(settings)
        .await?
        .run_until_stopped()
        .await
}

/// `keasy-server rekey`: seal every stored credential again under
/// `KEASY_NEW_SECRET_KEY`, reading them with `KEASY_SECRET_KEY`. Run it with
/// the server stopped, then restart the server with the new key.
fn rekey() -> Result<(), String> {
    let database = DatabaseSettings::from_env()?;
    let new = configuration::secret_key("KEASY_NEW_SECRET_KEY")?;
    let n = credentials::rekey(&database, &new)?;
    println!("sealed {n} credential(s) under KEASY_NEW_SECRET_KEY");
    Ok(())
}
