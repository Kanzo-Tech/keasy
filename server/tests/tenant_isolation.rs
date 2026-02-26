//! Integration tests verifying tenant isolation, RBAC enforcement, and
//! no-active-dataspace errors. All tests use tower::ServiceExt::oneshot
//! (no HTTP listener required).
//!
//! Each test function spins up its own in-memory SQLite DB, ensuring full
//! isolation between tests.

use axum::body::Body;
use axum::extract::connect_info::MockConnectInfo;
use axum::http::{Request, StatusCode, header};
use secrecy::SecretString;
use serde_json::Value;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower::ServiceExt;

use keasy_server::{
    AppState, Database, JobRunner, OutputCache, RateLimiter, RdfGraph,
    db::seed::{SEED_ORG_ID, SEED_DATASPACE_ID, SEED_ADMIN_ID, SEED_ADMIN_EMAIL, SEED_INVITE_TOKEN},
};

const SESSION_SECRET: &str = "test-session-secret-at-least-32-chars-long-for-pbkdf2";

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_test_writer()
        .with_env_filter("keasy_server=debug")
        .try_init();
}

/// Build a test router backed by a temporary SQLite DB on disk.
async fn test_router_with_state() -> (axum::Router, AppState) {
    init_tracing();
    let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
    let db_path = temp_dir.path().join("test.db");
    // Leak tempdir so DB stays alive for duration of test
    std::mem::forget(temp_dir);

    let db = Database::open(&db_path, None).expect("failed to open test database");

    let session_conn =
        tower_sessions_rusqlite_store::tokio_rusqlite::Connection::open(&db_path)
            .await
            .expect("session conn");
    let session_store = tower_sessions_rusqlite_store::RusqliteStore::new(session_conn);
    session_store.migrate().await.expect("session migrate");

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

    // Wrap with MockConnectInfo so ConnectInfo<SocketAddr> extraction works in tests
    let router = keasy_server::routes::build_router(
        state.clone(),
        None,
        session_store,
        SecretString::from(SESSION_SECRET),
    )
    .layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 12345))));

    (router, state)
}

/// Login as the seed admin and return the session cookie string.
async fn login_seed_admin(router: &axum::Router) -> String {
    let body = serde_json::json!({
        "email": SEED_ADMIN_EMAIL,
        "password": "changeme"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/v1/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    if resp.status() != StatusCode::OK {
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        panic!("login should succeed but got {status}: {}", String::from_utf8_lossy(&bytes));
    }

    // Extract Set-Cookie header
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("login must set a session cookie")
        .to_str()
        .unwrap()
        .to_string();

    // Return only the cookie name=value part (strip attributes like Path, HttpOnly, etc.)
    cookie
        .split(';')
        .next()
        .unwrap()
        .trim()
        .to_string()
}

/// Set active dataspace in session. Returns the response status.
async fn set_dataspace(router: &axum::Router, session_cookie: &str, dataspace_id: &str) -> StatusCode {
    let body = serde_json::json!({ "dataspace_id": dataspace_id });
    let req = Request::builder()
        .method("POST")
        .uri("/v1/auth/set-dataspace")
        .header("content-type", "application/json")
        .header("cookie", session_cookie)
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    router.clone().oneshot(req).await.unwrap().status()
}

/// Parse response body as JSON.
async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

// ---------------------------------------------------------------------------
// Test 1: No active dataspace → 403 rbac/no_active_dataspace
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_no_active_dataspace_returns_403() {
    let (router, _state) = test_router_with_state().await;
    let cookie = login_seed_admin(&router).await;

    // Request a protected resource WITHOUT setting a dataspace first
    let req = Request::builder()
        .method("GET")
        .uri("/v1/jobs")
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "no dataspace → 403");
    let json = body_json(resp).await;
    assert_eq!(json["error"], "rbac/no_active_dataspace");
}

// ---------------------------------------------------------------------------
// Test 2: Set dataspace then access works → 200
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_set_dataspace_then_access_works() {
    let (router, _state) = test_router_with_state().await;
    let cookie = login_seed_admin(&router).await;

    let status = set_dataspace(&router, &cookie, SEED_DATASPACE_ID).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "set-dataspace should return 204");

    let req = Request::builder()
        .method("GET")
        .uri("/v1/jobs")
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "jobs list should be 200 after set-dataspace");
}

// ---------------------------------------------------------------------------
// Test 3: Set invalid dataspace → 403
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_set_invalid_dataspace_returns_403() {
    let (router, _state) = test_router_with_state().await;
    let cookie = login_seed_admin(&router).await;

    let status = set_dataspace(&router, &cookie, "nonexistent-dataspace-id").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "org not a member → 403");
}

// ---------------------------------------------------------------------------
// Test 4: Cross-org job access returns 404 (opaque)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_cross_org_job_returns_404() {
    let (router, state) = test_router_with_state().await;
    let cookie = login_seed_admin(&router).await;

    // Create Org B directly in DB
    let org_b_id = "bbbbbbbb-0000-0000-0000-000000000001";
    state.db.create_organization(&keasy_server::db::organizations::Organization {
        id: org_b_id.to_string(),
        name: "Org B".to_string(),
        legal_name: "Org B Legal".to_string(),
        registration_number: None,
        country: "EU".to_string(),
        vc_verified_at: None,
        created_at: jiff::Timestamp::now().to_string(),
        updated_at: jiff::Timestamp::now().to_string(),
    }).await.unwrap();

    // Create a job belonging to Org B directly in the DB
    let org_b_job_id = "cccccccc-0000-0000-0000-000000000001";
    {
        let conn = state.db.write().await;
        let now = jiff::Timestamp::now().to_string();
        conn.execute(
            "INSERT INTO jobs (id, organization_id, status, created_at) VALUES (?1, ?2, 'draft', ?3)",
            rusqlite::params![org_b_job_id, org_b_id, now],
        ).unwrap();
    }

    // Set dataspace as Org A (seed admin)
    let status = set_dataspace(&router, &cookie, SEED_DATASPACE_ID).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Try to GET the Org B job as Org A user
    let req = Request::builder()
        .method("GET")
        .uri(format!("/v1/jobs/{org_b_job_id}"))
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();

    // Must return 404 (opaque — not 403)
    assert_eq!(resp.status(), StatusCode::NOT_FOUND, "cross-org job access must return 404, not 403");
}

// ---------------------------------------------------------------------------
// Test 5: List scoping — only own org's resources returned
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_cross_org_list_scoped() {
    let (router, state) = test_router_with_state().await;
    let cookie = login_seed_admin(&router).await;

    // Create Org B
    let org_b_id = "bbbbbbbb-0000-0000-0000-000000000002";
    state.db.create_organization(&keasy_server::db::organizations::Organization {
        id: org_b_id.to_string(),
        name: "Org B Two".to_string(),
        legal_name: "Org B Two Legal".to_string(),
        registration_number: None,
        country: "EU".to_string(),
        vc_verified_at: None,
        created_at: jiff::Timestamp::now().to_string(),
        updated_at: jiff::Timestamp::now().to_string(),
    }).await.unwrap();

    // Insert one job for Org A (seed org) and one for Org B
    {
        let conn = state.db.write().await;
        let now = jiff::Timestamp::now().to_string();
        conn.execute(
            "INSERT INTO jobs (id, organization_id, status, created_at) VALUES (?1, ?2, 'draft', ?3)",
            rusqlite::params!["aaaaaaaa-job0-0000-0000-000000000001", SEED_ORG_ID, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO jobs (id, organization_id, status, created_at) VALUES (?1, ?2, 'draft', ?3)",
            rusqlite::params!["bbbbbbbb-job0-0000-0000-000000000001", org_b_id, now],
        ).unwrap();
    }

    let status = set_dataspace(&router, &cookie, SEED_DATASPACE_ID).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let req = Request::builder()
        .method("GET")
        .uri("/v1/jobs")
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let json = body_json(resp).await;
    let jobs = json["data"].as_array().expect("data should be an array");
    assert_eq!(jobs.len(), 1, "only Org A's job should be returned, got {}", jobs.len());
    assert_eq!(jobs[0]["id"], "aaaaaaaa-job0-0000-0000-000000000001");
}

// ---------------------------------------------------------------------------
// Test 6: Promotor can access admin endpoints → 200
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_promotor_admin_endpoints() {
    let (router, _state) = test_router_with_state().await;
    let cookie = login_seed_admin(&router).await;

    let status = set_dataspace(&router, &cookie, SEED_DATASPACE_ID).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // GET /v1/admin/organizations
    let req = Request::builder()
        .method("GET")
        .uri("/v1/admin/organizations")
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "promotor GET /v1/admin/organizations → 200");

    // GET /v1/admin/dataspaces
    let req = Request::builder()
        .method("GET")
        .uri("/v1/admin/dataspaces")
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "promotor GET /v1/admin/dataspaces → 200");
}

// ---------------------------------------------------------------------------
// Test 7: Non-promotor (participant) gets 403 on admin endpoints
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_non_promotor_admin_endpoints_403() {
    let (router, state) = test_router_with_state().await;

    // Create Org B as participant in the seed dataspace
    let org_b_id = "bbbbbbbb-0000-0000-0000-000000000003";
    let now = jiff::Timestamp::now().to_string();
    state.db.create_organization(&keasy_server::db::organizations::Organization {
        id: org_b_id.to_string(),
        name: "Org B Participant".to_string(),
        legal_name: "Org B Participant Legal".to_string(),
        registration_number: None,
        country: "EU".to_string(),
        vc_verified_at: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    }).await.unwrap();

    // Add Org B as participant to the seed dataspace
    state.db.add_org_to_dataspace(&keasy_server::db::dataspaces::OrgDataspaceMembership {
        id: uuid::Uuid::new_v4().to_string(),
        org_id: org_b_id.to_string(),
        dataspace_id: SEED_DATASPACE_ID.to_string(),
        role: keasy_server::db::dataspaces::DataspaceRole::Participant,
        created_at: now.clone(),
    }).await.unwrap();

    // Create invite token for Org B registration
    let org_b_token = "ORG-B-TEST-INVITE-TOKEN-000000002";
    {
        let conn = state.db.write().await;
        conn.execute(
            "INSERT INTO invite_tokens (token, email, org_id, role, created_by, used_at, expires_at, created_at)
             VALUES (?1, NULL, ?2, 'user', ?3, NULL, '2099-12-31T00:00:00Z', ?4)",
            rusqlite::params![org_b_token, org_b_id, SEED_ADMIN_ID, now],
        ).unwrap();
    }

    // Register Org B user
    let reg_body = serde_json::json!({
        "email": "orgb@example.com",
        "password": "TestPassword123",
        "invite_token": org_b_token
    });
    let req = Request::builder()
        .method("POST")
        .uri("/v1/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&reg_body).unwrap()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    if resp.status() != StatusCode::CREATED {
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        panic!("Org B registration failed {status}: {}", String::from_utf8_lossy(&bytes));
    }

    // Login as Org B user
    let login_body = serde_json::json!({
        "email": "orgb@example.com",
        "password": "TestPassword123"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/v1/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "Org B login should succeed");
    let cookie_b = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("login must set cookie")
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .trim()
        .to_string();

    // Set dataspace as Org B user
    let status = set_dataspace(&router, &cookie_b, SEED_DATASPACE_ID).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "Org B can set seed dataspace (is participant)");

    // GET /v1/admin/organizations as Org B user → 403
    let req = Request::builder()
        .method("GET")
        .uri("/v1/admin/organizations")
        .header("cookie", &cookie_b)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "participant → 403 on admin endpoint");
    let json = body_json(resp).await;
    assert_eq!(json["error"], "rbac/insufficient_role");
}

// ---------------------------------------------------------------------------
// Test 8: GET /v1/auth/me returns user info
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_auth_me_returns_user_info() {
    let (router, _state) = test_router_with_state().await;
    let cookie = login_seed_admin(&router).await;

    // Before setting a dataspace, active_dataspace_id should be null
    let req = Request::builder()
        .method("GET")
        .uri("/v1/auth/me")
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "GET /v1/auth/me → 200");
    let json = body_json(resp).await;
    assert!(json["data"]["email"].is_string(), "response should contain email field");
    assert!(json["data"]["active_dataspace_id"].is_null(), "no active dataspace yet → null");

    // Set dataspace and check it appears in /me
    let status = set_dataspace(&router, &cookie, SEED_DATASPACE_ID).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let req = Request::builder()
        .method("GET")
        .uri("/v1/auth/me")
        .header("cookie", &cookie)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(
        json["data"]["active_dataspace_id"],
        SEED_DATASPACE_ID,
        "active_dataspace_id should be populated after set-dataspace"
    );
}

// ---------------------------------------------------------------------------
// Test: Unused seed invite token constant must be valid
// ---------------------------------------------------------------------------

#[test]
fn test_seed_constants_are_present() {
    // Just ensures the constants are accessible from tests — not a runtime test
    assert!(!SEED_ORG_ID.is_empty());
    assert!(!SEED_DATASPACE_ID.is_empty());
    assert!(!SEED_ADMIN_EMAIL.is_empty());
    assert!(!SEED_INVITE_TOKEN.is_empty());
}
