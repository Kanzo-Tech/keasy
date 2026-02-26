use std::collections::HashMap;
use std::collections::VecDeque;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_REQUESTS: usize = 5;
const WINDOW: Duration = Duration::from_secs(60);

/// In-memory per-IP rate limiter using a sliding window.
/// Enforces at most MAX_REQUESTS (5) per WINDOW (60s) per IP address.
/// Uses std::sync::Mutex (not tokio) — the lock is held only briefly.
#[derive(Clone)]
pub struct RateLimiter {
    attempts: Arc<Mutex<HashMap<IpAddr, VecDeque<Instant>>>>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            attempts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns true if the request should be allowed, false if rate-limited.
    /// Prunes expired entries from the window before checking.
    pub fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut map = self.attempts.lock().unwrap();
        let timestamps = map.entry(ip).or_default();

        // Remove timestamps outside the window
        while timestamps
            .front()
            .is_some_and(|t| now.duration_since(*t) > WINDOW)
        {
            timestamps.pop_front();
        }

        if timestamps.len() >= MAX_REQUESTS {
            false
        } else {
            timestamps.push_back(now);
            true
        }
    }
}
