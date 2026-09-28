use std::io;
use std::sync::{Arc, Mutex};

use axum::http::{Method, StatusCode};
use tracing_subscriber::fmt::MakeWriter;

use crate::helpers::spawn_app;
use keasy_server::telemetry;

#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for Captured {
    type Writer = Captured;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

/// The process-wide subscriber, installed once. A thread-local one races the
/// other tests: a callsite first reached on another thread caches "disabled".
fn captured_logs() -> Captured {
    static LOGS: std::sync::OnceLock<Captured> = std::sync::OnceLock::new();
    LOGS.get_or_init(|| {
        let logs = Captured::default();
        tracing::subscriber::set_global_default(telemetry::get_subscriber("info", logs.clone()))
            .expect("the only global subscriber in the test binary");
        logs
    })
    .clone()
}

/// The request log used to run outside the bearer layer and so always wrote
/// `user_id = "-"`. The line that closes a request names who made it.
#[tokio::test]
async fn the_request_log_names_the_authenticated_caller() {
    let logs = captured_logs();
    let app = spawn_app().await;
    let token = app.token_for("u-logged", &["member"]);
    assert_eq!(
        app.call(Method::GET, "/v1/jobs", Some(&token)).await,
        StatusCode::OK
    );

    let out = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(
        out.lines()
            .any(|l| l.contains("finished processing request")
                && l.contains("/v1/jobs")
                && l.contains(r#""user_id":"u-logged""#)),
        "no response line naming the caller in:\n{out}"
    );
}
