//! Security smoke test: asserts all non-public API endpoints return 401
//! for requests with no valid session cookie.
//!
//! This test satisfies ROADMAP Phase 03 Success Criterion #4:
//! "Every non-public API endpoint returns 401 for requests with no valid
//! session cookie; a security smoke test asserts this for all routes"

use axum::http::{Request, StatusCode};
use secrecy::SecretString;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower::ServiceExt; // for oneshot

use keasy_server::{AppState, Database, JobRunner, OutputCache, RateLimiter, RdfGraph};

/// Helper: build a test router backed by a temp directory SQLite DB.
async fn test_router() -> axum::Router {
    // 1. Create a tempdir for the test database
    let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
    let db_path = temp_dir.path().join("test.db");

    // Keep temp_dir alive for duration of test — leak it intentionally since
    // the router needs the DB to remain accessible during test execution.
    std::mem::forget(temp_dir);

    // 2. Open the database (no encryption key needed for tests)
    let db = Database::open(&db_path, None).expect("failed to open test database");

    // 3. Create a session store with a separate tokio_rusqlite connection
    let session_conn =
        tower_sessions_rusqlite_store::tokio_rusqlite::Connection::open(&db_path)
            .await
            .expect("failed to open session store connection");

    // 4. Create and migrate the session store
    let session_store = tower_sessions_rusqlite_store::RusqliteStore::new(session_conn);
    session_store
        .migrate()
        .await
        .expect("failed to migrate session store");

    // 5. Construct minimal AppState
    let catalog = Arc::new(RdfGraph::new());
    let runner = Arc::new(JobRunner::new(db.clone(), catalog.clone(), 1, 30));
    let output_cache = Arc::new(Mutex::new(OutputCache::new(1)));
    let rate_limiter = RateLimiter::new();
    let api_key = SecretString::from("test-api-key");

    let state = AppState {
        db,
        runner,
        catalog,
        output_cache,
        api_key,
        rate_limiter,
        email_service: keasy_server::email::EmailService::from_env(),
        base_url: "http://localhost:3000".to_string(),
    };

    // 6. Session secret (must be at least 32 chars for PBKDF2 key derivation)
    let session_secret = SecretString::from("test-session-secret-at-least-32-chars-long");

    // 7. Build and return the router (no HTTP listener — uses tower::ServiceExt::oneshot)
    keasy_server::routes::build_router(state, None, session_store, session_secret)
}

/// All protected routes must return 401 without a session.
///
/// MAINTAINER NOTE: When adding a new route to api_routes in routes/mod.rs,
/// add a corresponding entry here. This test guards against routes that
/// accidentally skip session_required.
#[tokio::test]
async fn protected_routes_return_401_without_session() {
    let app = test_router().await;

    let dummy_id = "00000000-0000-0000-0000-000000000099";
    let dummy_provider = "00000000-0000-0000-0000-000000000099";

    // Exhaustive list of all protected routes (api_routes + logout_route).
    // Format: (HTTP method, path)
    let protected: Vec<(&str, String)> = vec![
        // Auth
        ("POST", "/v1/auth/logout".to_string()),
        // Jobs — collection
        ("GET",  "/v1/jobs".to_string()),
        ("POST", "/v1/jobs".to_string()),
        // Jobs — item
        ("GET",    format!("/v1/jobs/{dummy_id}")),
        ("PUT",    format!("/v1/jobs/{dummy_id}")),
        ("DELETE", format!("/v1/jobs/{dummy_id}")),
        ("POST",   format!("/v1/jobs/{dummy_id}/cancel")),
        ("GET",    format!("/v1/jobs/{dummy_id}/catalog")),
        ("GET",    format!("/v1/jobs/{dummy_id}/graph")),
        // Graph
        ("GET",  "/v1/graph".to_string()),
        // Scripts
        ("POST", "/v1/scripts/validate".to_string()),
        // Settings — org
        ("GET", "/v1/settings/organization".to_string()),
        ("PUT", "/v1/settings/organization".to_string()),
        // Settings — preferences
        ("GET", "/v1/settings/preferences".to_string()),
        ("PUT", "/v1/settings/preferences".to_string()),
        // Settings — AI providers
        ("GET",    "/v1/settings/ai/providers".to_string()),
        ("PUT",    format!("/v1/settings/ai/providers/{dummy_provider}")),
        ("DELETE", format!("/v1/settings/ai/providers/{dummy_provider}")),
        // Validate
        ("POST", "/v1/validate".to_string()),
        // Graph search/expand
        ("POST", "/v1/graph/search".to_string()),
        ("POST", "/v1/graph/expand".to_string()),
        // Dashboard layout
        ("GET", format!("/v1/jobs/{dummy_id}/dashboard-layout")),
        ("PUT", format!("/v1/jobs/{dummy_id}/dashboard-layout")),
        // Discover
        ("POST", format!("/v1/jobs/{dummy_id}/discover/load")),
        ("POST", format!("/v1/jobs/{dummy_id}/discover/query")),
        ("POST", format!("/v1/jobs/{dummy_id}/discover/chart")),
        ("GET",  format!("/v1/jobs/{dummy_id}/discover/export")),
        ("POST", format!("/v1/jobs/{dummy_id}/discover/ask")),
        // Conversations
        ("GET",  format!("/v1/jobs/{dummy_id}/conversations")),
        ("POST", format!("/v1/jobs/{dummy_id}/conversations")),
        ("GET",    format!("/v1/conversations/{dummy_id}/messages")),
        ("PUT",    format!("/v1/conversations/{dummy_id}")),
        ("DELETE", format!("/v1/conversations/{dummy_id}")),
        // Cloud accounts
        ("GET",    "/v1/cloud-accounts".to_string()),
        ("POST",   "/v1/cloud-accounts".to_string()),
        ("GET",    format!("/v1/cloud-accounts/{dummy_id}")),
        ("PUT",    format!("/v1/cloud-accounts/{dummy_id}")),
        ("DELETE", format!("/v1/cloud-accounts/{dummy_id}")),
        // Connections
        ("GET",    "/v1/connections".to_string()),
        ("POST",   "/v1/connections".to_string()),
        ("GET",    format!("/v1/connections/{dummy_id}")),
        ("PUT",    format!("/v1/connections/{dummy_id}")),
        ("DELETE", format!("/v1/connections/{dummy_id}")),
        ("GET",    format!("/v1/connections/{dummy_id}/files")),
    ];

    for (method, path) in &protected {
        let req = Request::builder()
            .method(*method)
            .uri(path.as_str())
            .body(axum::body::Body::empty())
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path} should return 401 without session, got {}",
            response.status()
        );
    }
}

/// Public routes must NOT return 401 without a session.
#[tokio::test]
async fn public_routes_do_not_return_401() {
    let app = test_router().await;

    let public: Vec<(&str, &str)> = vec![
        ("GET",  "/healthz/live"),
        ("GET",  "/healthz/ready"),
        ("GET",  "/v1/settings/schema"),
        ("GET",  "/v1/providers"),
        ("POST", "/v1/auth/register"),
        ("POST", "/v1/auth/login"),
    ];

    for (method, path) in &public {
        let req = Request::builder()
            .method(*method)
            .uri(*path)
            .body(axum::body::Body::empty())
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path} should NOT return 401 (public route), got 401",
        );
    }
}
