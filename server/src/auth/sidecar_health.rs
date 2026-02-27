use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Spawns a background task that periodically checks the walt.id Verifier
/// health endpoint. Updates the `flag` AtomicBool: true = available, false = unavailable.
/// Called once at server startup. The flag is consumed by VC auth routes.
pub fn spawn_health_monitor(
    verifier_url: String,
    client: reqwest::Client,
    flag: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        // Run an initial check immediately (no delay)
        loop {
            let available = client
                .get(format!("{verifier_url}/healthz"))
                .timeout(Duration::from_secs(2))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false);
            flag.store(available, Ordering::Relaxed);
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
