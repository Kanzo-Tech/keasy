//! Security smoke test: asserts all non-public API endpoints return 401
//! for requests with no valid session cookie.

use axum::http::{Request, StatusCode};
use secrecy::SecretString;
use std::sync::Arc;
use tower::ServiceExt; // for oneshot

use keasy_server::{AppState, AuthServices, Database, GaiaXServices, JobRunner, RdfGraph};

/// Helper: build a test router backed by a temp directory SQLite DB.
async fn test_router() -> axum::Router {
    let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
    let db_path = temp_dir.path().join("test.db");

    // Keep temp_dir alive for duration of test — leak it intentionally since
    // the router needs the DB to remain accessible during test execution.
    std::mem::forget(temp_dir);

    let db = Database::open(&db_path, None, None).expect("failed to open test database");

    let session_conn = tower_sessions_rusqlite_store::tokio_rusqlite::Connection::open(&db_path)
        .await
        .expect("failed to open session store connection");

    let session_store = tower_sessions_rusqlite_store::RusqliteStore::new(session_conn);
    session_store
        .migrate()
        .await
        .expect("failed to migrate session store");

    let graph_store = Arc::new(RdfGraph::new());
    let runner = Arc::new(JobRunner::new(db.clone(), graph_store.clone(), 1, 30));
    let api_key = SecretString::from("test-api-key");

    let state = AppState {
        db,
        runner,
        graph_store,
        api_key,
        base_url: "http://localhost:3000".to_string(),
        auth: AuthServices {
            oidc_state: None,
            keycloak_admin: None,
            oidc_issuer_url: None,
            oidc_client_id: None,
            oidc_client_secret: None,
        },
        gaia_x: GaiaXServices {
            gxdch_notary_url: "https://example.com/notary".to_string(),
            gxdch_compliance_url: "https://example.com/compliance".to_string(),
            base_domain: None,
            caddy_certs_dir: None,
        },
    };

    let session_secret = SecretString::from("test-session-secret-at-least-32-chars-long");

    keasy_server::routes::build_router(
        state,
        None,
        session_store,
        session_secret,
        "sid".to_string(),
        false,
    )
}

/// All protected routes must return 401 without a session.
///
/// MAINTAINER NOTE: When adding a new route to api_routes or session_auth_routes
/// in routes/mod.rs, add a corresponding entry here. This test guards against
/// routes that accidentally skip session_required.
#[tokio::test]
async fn protected_routes_return_401_without_session() {
    let app = test_router().await;

    let dummy_id = "00000000-0000-0000-0000-000000000099";
    let dummy_provider = "00000000-0000-0000-0000-000000000099";
    let dummy_token = "00000000000000000000000000000099";

    // Exhaustive list of all protected routes (session_auth_routes + api_routes).
    // Format: (HTTP method, path)
    let protected: Vec<(&str, String)> = vec![
        // ── Session-auth routes (session required, no tenant context) ────────
        ("POST", "/v1/auth/logout".to_string()),
        ("GET", "/v1/auth/me".to_string()),
        ("GET", "/v1/auth/workspaces".to_string()),
        // ── API routes (session + tenant context required) ───────────────────
        // Jobs — collection
        ("GET", "/v1/jobs".to_string()),
        ("POST", "/v1/jobs".to_string()),
        // Jobs — item
        ("GET", format!("/v1/jobs/{dummy_id}")),
        ("PUT", format!("/v1/jobs/{dummy_id}")),
        ("DELETE", format!("/v1/jobs/{dummy_id}")),
        ("POST", format!("/v1/jobs/{dummy_id}/cancel")),
        ("GET", format!("/v1/jobs/{dummy_id}/catalog")),
        ("GET", format!("/v1/jobs/{dummy_id}/graph")),
        // Graph
        ("GET", "/v1/graph".to_string()),
        // Scripts
        ("POST", "/v1/scripts/validate".to_string()),
        // Settings — org
        ("GET", "/v1/settings/organization".to_string()),
        ("PUT", "/v1/settings/organization".to_string()),
        // Settings — preferences
        ("GET", "/v1/settings/preferences".to_string()),
        ("PUT", "/v1/settings/preferences".to_string()),
        // Settings — AI providers
        ("GET", "/v1/settings/ai/providers".to_string()),
        ("PUT", format!("/v1/settings/ai/providers/{dummy_provider}")),
        (
            "DELETE",
            format!("/v1/settings/ai/providers/{dummy_provider}"),
        ),
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
        ("GET", format!("/v1/jobs/{dummy_id}/discover/export")),
        ("POST", format!("/v1/jobs/{dummy_id}/discover/ask")),
        // Conversations
        ("GET", format!("/v1/jobs/{dummy_id}/conversations")),
        ("POST", format!("/v1/jobs/{dummy_id}/conversations")),
        ("GET", format!("/v1/conversations/{dummy_id}/messages")),
        ("PUT", format!("/v1/conversations/{dummy_id}")),
        ("DELETE", format!("/v1/conversations/{dummy_id}")),
        // Cloud accounts
        ("GET", "/v1/cloud-accounts".to_string()),
        ("POST", "/v1/cloud-accounts".to_string()),
        ("GET", format!("/v1/cloud-accounts/{dummy_id}")),
        ("PUT", format!("/v1/cloud-accounts/{dummy_id}")),
        ("DELETE", format!("/v1/cloud-accounts/{dummy_id}")),
        // Connections
        ("GET", "/v1/connections".to_string()),
        ("POST", "/v1/connections".to_string()),
        ("GET", format!("/v1/connections/{dummy_id}")),
        ("PUT", format!("/v1/connections/{dummy_id}")),
        ("DELETE", format!("/v1/connections/{dummy_id}")),
        ("GET", format!("/v1/connections/{dummy_id}/files")),
        // Admin — promotor only
        ("GET", "/v1/admin/organizations".to_string()),
        ("POST", "/v1/admin/organizations".to_string()),
        ("GET", "/v1/admin/invites".to_string()),
        ("POST", "/v1/admin/invites".to_string()),
        ("DELETE", format!("/v1/admin/invites/{dummy_token}")),
        ("GET", "/v1/admin/oidc-clients".to_string()),
        ("POST", "/v1/admin/oidc-clients".to_string()),
        // Org admin
        ("GET", "/v1/org/users".to_string()),
        ("POST", "/v1/org/users".to_string()),
        ("PUT", format!("/v1/org/users/{dummy_id}")),
        ("DELETE", format!("/v1/org/users/{dummy_id}")),
        // Gaia-X compliance wizard
        ("GET", "/v1/gaia-x/wizard".to_string()),
        ("POST", "/v1/gaia-x/wizard/keys".to_string()),
        ("POST", "/v1/gaia-x/wizard/certificate".to_string()),
        ("POST", "/v1/gaia-x/wizard/lrn".to_string()),
        ("POST", "/v1/gaia-x/wizard/legal-participant".to_string()),
        ("POST", "/v1/gaia-x/wizard/terms".to_string()),
        ("POST", "/v1/gaia-x/wizard/submit".to_string()),
        ("GET", "/v1/gaia-x/compliance".to_string()),
        ("POST", "/v1/gaia-x/compliance/rerun".to_string()),
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
        ("GET", "/healthz/live"),
        ("GET", "/healthz/ready"),
        ("GET", "/v1/settings/schema"),
        ("GET", "/v1/providers"),
        ("GET", "/.well-known/did.json"),
        ("GET", "/.well-known/x509CertificateChain.pem"),
        ("GET", "/v1/auth/invite-info"),
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
