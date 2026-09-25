use axum::extract::Request;
use tracing::{Span, Subscriber};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::util::SubscriberInitExt;

/// JSON lines into `sink`, filtered by `RUST_LOG` or else `default_filter`.
pub fn get_subscriber<Sink>(default_filter: &str, sink: Sink) -> impl Subscriber + Send + Sync
where
    Sink: for<'a> MakeWriter<'a> + Send + Sync + 'static,
{
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter)),
        )
        .json()
        .with_writer(sink)
        .finish()
}

/// Install `subscriber` for the whole process, `log` records included. Once.
pub fn init_subscriber(subscriber: impl Subscriber + Send + Sync + 'static) {
    subscriber.init();
}

/// The one request log. `bearer_required` records `user_id` into this span
/// once the token verifies, so the response line names the caller.
pub fn request_span(request: &Request) -> Span {
    tracing::info_span!(
        "request",
        method = %request.method(),
        path = %request.uri().path(),
        user_id = tracing::field::Empty,
    )
}
