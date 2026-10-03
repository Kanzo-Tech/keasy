//! The authorization contract, read off the spec the server publishes.
//!
//! Every operation declares the least role it admits as its security
//! requirement (`security(("bearer" = ["editor"]))`), so the table is the
//! contract itself and a route added without one fails here, not in review.
//! What depends on the request rather than the route — the sink is an admin's,
//! a job is changed by its creator or an admin — is `ownership.rs`.

use axum::http::{Method, StatusCode};

use crate::helpers::{ADMIN, EDITOR, ORG, READER, spawn_app};

/// The roles in ascending order: holding one is holding every one before it.
const LADDER: [&str; 3] = ["reader", "editor", "admin"];

/// Every operation in the published spec: method, path with each parameter as
/// `x`, and the security requirement's roles — `None` for a public route.
fn operations() -> Vec<(Method, String, Option<Vec<String>>)> {
    let spec = serde_json::to_value(keasy_server::startup::openapi()).unwrap();
    let mut ops = Vec::new();
    for (path, item) in spec["paths"].as_object().unwrap() {
        let concrete = path
            .split('/')
            .map(|s| if s.starts_with('{') { "x" } else { s })
            .collect::<Vec<_>>()
            .join("/");
        for (verb, op) in item.as_object().unwrap() {
            let Ok(method) = Method::from_bytes(verb.to_uppercase().as_bytes()) else {
                continue;
            };
            let security = op["security"].as_array().expect("every operation says");
            let roles = security.iter().find_map(|req| {
                req.get("bearer").map(|roles| {
                    roles
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|r| r.as_str().unwrap().to_owned())
                        .collect::<Vec<_>>()
                })
            });
            ops.push((method, concrete.clone(), roles));
        }
    }
    ops
}

#[test]
fn every_protected_operation_names_exactly_one_role_of_the_ladder() {
    for (method, path, roles) in operations() {
        let Some(roles) = roles else { continue };
        assert!(
            roles.len() == 1 && LADDER.contains(&roles[0].as_str()),
            "{method} {path} declares {roles:?}"
        );
    }
}

#[test]
fn the_public_routes_are_the_probes_and_the_look() {
    let mut public: Vec<_> = operations()
        .into_iter()
        .filter(|(_, _, roles)| roles.is_none())
        .map(|(m, p, _)| format!("{m} {p}"))
        .collect();
    public.sort();
    assert_eq!(
        public,
        [
            "GET /healthz/live",
            "GET /healthz/ready",
            "GET /v1/branding"
        ]
    );
}

/// Each operation admits exactly who holds its least role, and refuses the
/// rest with the code that says why: no token 401, a role in another
/// organization or none here `rbac/no-membership`, too little
/// `rbac/insufficient-role`.
#[tokio::test]
async fn every_operation_admits_exactly_its_least_role_and_up() {
    let app = spawn_app().await;
    let reader = app.token(READER);
    let editor = app.token(EDITOR);
    let admin = app.token(ADMIN);
    let elsewhere = app.token_in("u-1", "globex", ADMIN);
    let nothing_here = app.token(&[]);
    assert_ne!(ORG, "globex");

    for (method, path, roles) in operations() {
        let Some(roles) = roles else { continue };
        let least = LADDER.iter().position(|r| *r == roles[0]).unwrap();

        for (rank, token) in [&reader, &editor, &admin].into_iter().enumerate() {
            let (status, code) = app.answer(method.clone(), &path, Some(token)).await;
            if rank >= least {
                assert!(
                    status != StatusCode::FORBIDDEN && status != StatusCode::UNAUTHORIZED,
                    "{method} {path} must admit {}, got {status} {code:?}",
                    LADDER[rank]
                );
            } else {
                assert_eq!(
                    (status, code.as_deref()),
                    (StatusCode::FORBIDDEN, Some("rbac/insufficient-role")),
                    "{method} {path} must refuse {}",
                    LADDER[rank]
                );
            }
        }
        for (who, token) in [
            ("another organization", &elsewhere),
            ("no role here", &nothing_here),
        ] {
            assert_eq!(
                app.answer(method.clone(), &path, Some(token)).await,
                (
                    StatusCode::FORBIDDEN,
                    Some("rbac/no-membership".to_string())
                ),
                "{method} {path} with {who}"
            );
        }
        assert_eq!(
            app.call(method.clone(), &path, None).await,
            StatusCode::UNAUTHORIZED,
            "{method} {path} without a token"
        );
    }
}
