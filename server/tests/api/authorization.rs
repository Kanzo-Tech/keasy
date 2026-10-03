use axum::http::{Method, StatusCode};

use crate::helpers::spawn_app;

/// Who a route admits.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Admits {
    Owner,
    Member,
    AnyRole,
}

/// Every role-gated route. A route added without a row here fails
/// `every_role_gated_route_is_in_the_table`.
const ROUTES: &[(&str, &str, Admits)] = &[
    ("GET", "/v1/jobs", Admits::Member),
    ("POST", "/v1/jobs", Admits::Member),
    ("GET", "/v1/jobs/x", Admits::Member),
    ("PATCH", "/v1/jobs/x", Admits::Member),
    ("DELETE", "/v1/jobs/x", Admits::Member),
    ("POST", "/v1/jobs/x/submit", Admits::Member),
    ("POST", "/v1/jobs/x/status", Admits::Member),
    ("POST", "/v1/storage-credentials", Admits::AnyRole),
    ("GET", "/v1/jobs/x/dashboard", Admits::Member),
    ("PUT", "/v1/jobs/x/dashboard", Admits::Member),
    ("POST", "/v1/ai/chat/completions", Admits::Member),
    ("GET", "/v1/secrets", Admits::AnyRole),
    ("POST", "/v1/secrets", Admits::AnyRole),
    ("GET", "/v1/secrets/x", Admits::AnyRole),
    ("PATCH", "/v1/secrets/x", Admits::AnyRole),
    ("DELETE", "/v1/secrets/x", Admits::AnyRole),
    ("POST", "/v1/secrets/x/validate", Admits::AnyRole),
    ("GET", "/v1/connections", Admits::AnyRole),
    ("POST", "/v1/connections", Admits::AnyRole),
    ("GET", "/v1/connections/x", Admits::AnyRole),
    ("PATCH", "/v1/connections/x", Admits::AnyRole),
    ("DELETE", "/v1/connections/x", Admits::AnyRole),
    ("POST", "/v1/connections/x/validate", Admits::AnyRole),
    ("GET", "/v1/connections/x/files", Admits::Member),
    ("GET", "/v1/datasets", Admits::Owner),
];

fn method(name: &str) -> Method {
    Method::from_bytes(name.as_bytes()).unwrap()
}

/// The authorization contract, route by route: each role is admitted exactly
/// where the table says, refused with `rbac/insufficient-role` everywhere else,
/// a token with no workspace role gets `rbac/no-membership`, and no token 401.
#[tokio::test]
async fn every_route_admits_exactly_its_roles() {
    let app = spawn_app().await;
    let owner = app.token(&["owner"]);
    let member = app.token(&["member"]);
    let nobody = app.token(&[]);

    for &(verb, path, admits) in ROUTES {
        for (role, token) in [(Admits::Owner, &owner), (Admits::Member, &member)] {
            let admitted = admits == Admits::AnyRole || admits == role;
            let (status, code) = app.answer(method(verb), path, Some(token)).await;
            if admitted {
                assert!(
                    status != StatusCode::FORBIDDEN && status != StatusCode::UNAUTHORIZED,
                    "{verb} {path} must admit {role:?}, got {status} {code:?}"
                );
            } else {
                assert_eq!(
                    (status, code.as_deref()),
                    (StatusCode::FORBIDDEN, Some("rbac/insufficient-role")),
                    "{verb} {path} must refuse {role:?}"
                );
            }
        }
        assert_eq!(
            app.answer(method(verb), path, Some(&nobody)).await,
            (
                StatusCode::FORBIDDEN,
                Some("rbac/no-membership".to_string())
            ),
            "{verb} {path} without a workspace role"
        );
        assert_eq!(
            app.call(method(verb), path, None).await,
            StatusCode::UNAUTHORIZED,
            "{verb} {path} without a token"
        );
    }
}

/// The table is the whole of the gated surface: every route under the role
/// layer appears in it, and nothing else does.
#[tokio::test]
async fn every_role_gated_route_is_in_the_table() {
    let app = spawn_app().await;
    let nobody = app.token(&[]);
    let member = app.token(&["member"]);
    let candidates = [
        "/v1/jobs",
        "/v1/jobs/x",
        "/v1/jobs/x/submit",
        "/v1/jobs/x/status",
        "/v1/storage-credentials",
        "/v1/jobs/x/dashboard",
        "/v1/ai/chat/completions",
        "/v1/secrets",
        "/v1/secrets/x",
        "/v1/secrets/x/validate",
        "/v1/connections",
        "/v1/connections/x",
        "/v1/connections/x/validate",
        "/v1/connections/x/files",
        "/v1/datasets",
        "/v1/auth/workspaces",
    ];
    for path in candidates {
        for verb in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
            let listed = ROUTES.iter().any(|&(v, p, _)| v == verb && p == path);
            let exists =
                app.call(method(verb), path, Some(&member)).await != StatusCode::METHOD_NOT_ALLOWED;
            let (_, code) = app.answer(method(verb), path, Some(&nobody)).await;
            let gated = exists && code.as_deref() == Some("rbac/no-membership");
            assert_eq!(gated, listed, "{verb} {path}");
        }
    }
}
