//! The validator against a realm: a genuinely signed token, and what the
//! validator makes of it.

use std::sync::Arc;
use std::time::Duration;

use axum::{Json, Router, routing::get};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde_json::json;

use crate::helpers::{CLIENT, ORG, Realm, good, mint, realm};
use keasy_server::authentication::token::{CLOCK_LEEWAY, REQUEST_TIMEOUT, TokenError, Validator};

fn validating(realm: &Realm) -> Validator {
    Validator::new(&realm.issuer, "keasy-api", CLIENT, None)
}

#[tokio::test]
async fn a_token_the_realm_signed_is_accepted_and_read() {
    let realm = realm("k1").await;
    let claims = validating(&realm)
        .verify(&mint(&realm, good(&realm)))
        .await
        .expect("a well-formed token from this realm");

    assert_eq!(claims.sub, "u-1");
    assert_eq!(
        claims.org_roles(ORG, CLIENT),
        Some(["admin", "editor", "reader"].map(String::from).as_slice())
    );
    assert_eq!(
        claims.org_roles("globex", CLIENT),
        Some(["reader".to_string()].as_slice())
    );
}

#[tokio::test]
async fn a_token_that_does_not_name_this_api_is_refused() {
    let realm = realm("k1").await;
    let mut claims = good(&realm);
    claims["aud"] = json!(["account"]);

    assert!(matches!(
        validating(&realm).verify(&mint(&realm, claims)).await,
        Err(TokenError::Invalid)
    ));
}

#[tokio::test]
async fn a_token_from_another_issuer_is_refused() {
    let realm = realm("k1").await;
    let mut claims = good(&realm);
    claims["iss"] = json!("https://elsewhere/realms/keasy");

    assert!(matches!(
        validating(&realm).verify(&mint(&realm, claims)).await,
        Err(TokenError::Invalid)
    ));
}

#[tokio::test]
async fn an_expired_token_is_refused() {
    let realm = realm("k1").await;
    let mut claims = good(&realm);
    // Well past the validator's sixty seconds of leeway.
    claims["exp"] = json!(jiff::Timestamp::now().as_second() - 3600);

    assert!(matches!(
        validating(&realm).verify(&mint(&realm, claims)).await,
        Err(TokenError::Invalid)
    ));
}

/// The tenancy check, and the reason it is separate from `aud`.
///
/// This token is valid, unexpired, and names this API — another application
/// in the same realm obtained it. Refusing on the credential says *why*
/// instead of looking like an authorization failure.
#[tokio::test]
async fn a_token_minted_for_another_application_is_refused() {
    let realm = realm("k1").await;
    let mut claims = good(&realm);
    claims["azp"] = json!("board");

    assert!(matches!(
        validating(&realm).verify(&mint(&realm, claims)).await,
        Err(TokenError::Foreign)
    ));
}

/// A forgery signed with somebody else's key, wearing a `kid` this realm
/// does publish. The re-fetch finds the real key, and the signature fails
/// against it.
#[tokio::test]
async fn a_token_signed_by_another_key_is_refused() {
    let forger = realm("k1").await;
    let ours = realm("k1").await;

    let forged = mint(&forger, good(&ours));
    assert!(matches!(
        validating(&ours).verify(&forged).await,
        Err(TokenError::Invalid)
    ));
}

#[tokio::test]
async fn a_kid_the_realm_does_not_publish_is_refused() {
    let stranger = realm("k2").await;
    let ours = realm("k1").await;

    // Signed by a key this realm never had, and announcing a `kid` it has
    // never published — one re-fetch, then a refusal.
    let alien = mint(&stranger, good(&ours));
    assert!(matches!(
        validating(&ours).verify(&alien).await,
        Err(TokenError::Invalid)
    ));
}

/// The amplifier that unknown `kid`s used to be. A `kid` is unauthenticated
/// input, and each unknown one cost the realm two requests with nothing
/// bounding how many an anonymous caller could ask for.
#[tokio::test]
async fn an_unknown_kid_is_not_a_lever_on_the_realm() {
    let stranger = realm("k2").await;
    let ours = realm("k1").await;
    let validator = validating(&ours);
    let alien = mint(&stranger, good(&ours));

    // Cold cache: the realm is asked, once, for discovery and for the keys.
    assert!(matches!(
        validator.verify(&alien).await,
        Err(TokenError::Invalid)
    ));
    assert_eq!(ours.requests(), 2);

    // Fifty more of the same, all refused, none of them asked of the realm.
    for _ in 0..50 {
        assert!(matches!(
            validator.verify(&alien).await,
            Err(TokenError::Invalid)
        ));
    }
    assert_eq!(ours.requests(), 2, "the cooldown held");

    // And the floor costs a real token nothing: its `kid` is in the set the
    // first refusal fetched, so it verifies without another word to Keycloak.
    validator
        .verify(&mint(&ours, good(&ours)))
        .await
        .expect("a token this realm signed");
    assert_eq!(ours.requests(), 2);
}

/// Concurrency, from the other side: a cold cache and a crowd of *valid*
/// tokens must produce one fetch and no spurious refusals. The cooldown
/// alone would refuse everyone who lost the race, so the same lock is what
/// makes the fetch single-flight.
#[tokio::test]
async fn a_cold_cache_under_load_fetches_once_and_refuses_nobody() {
    let ours = realm("k1").await;
    let validator = Arc::new(validating(&ours));
    let token = Arc::new(mint(&ours, good(&ours)));

    let mut waiting = Vec::new();
    for _ in 0..25 {
        let (validator, token) = (validator.clone(), token.clone());
        waiting.push(tokio::spawn(async move {
            validator.verify(&token).await.is_ok()
        }));
    }
    for handle in waiting {
        assert!(handle.await.unwrap(), "every valid token verifies");
    }
    assert_eq!(
        ours.requests(),
        2,
        "one discovery, one JWKS, for all of them"
    );
}

/// `nbf` was not checked at all: `jsonwebtoken` leaves it off by default, so
/// a token minted for later was spendable now.
#[tokio::test]
async fn a_token_that_is_not_valid_yet_is_refused() {
    let realm = realm("k1").await;
    let mut claims = good(&realm);
    claims["nbf"] = json!(jiff::Timestamp::now().as_second() + 3600);

    assert!(matches!(
        validating(&realm).verify(&mint(&realm, claims)).await,
        Err(TokenError::Invalid)
    ));
}

/// The leeway, asserted rather than assumed: a token that went out of date
/// a moment ago is still taken, one past the window is not.
#[tokio::test]
async fn the_clock_leeway_is_the_one_we_chose() {
    let realm = realm("k1").await;
    let now = jiff::Timestamp::now().as_second();
    let leeway = CLOCK_LEEWAY.as_secs() as i64;

    let mut just_inside = good(&realm);
    just_inside["exp"] = json!(now - (leeway / 2));
    assert!(
        validating(&realm)
            .verify(&mint(&realm, just_inside))
            .await
            .is_ok()
    );

    let mut just_outside = good(&realm);
    just_outside["exp"] = json!(now - (leeway * 2));
    assert!(matches!(
        validating(&realm).verify(&mint(&realm, just_outside)).await,
        Err(TokenError::Invalid)
    ));
}

/// Algorithm confusion: a token signed with HMAC, hoping the verifier will
/// take the realm's published public key as the shared secret.
#[tokio::test]
async fn a_symmetrically_signed_token_is_refused() {
    let ours = realm("k1").await;

    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("k1".to_string());
    let forged = encode(
        &header,
        &good(&ours),
        &EncodingKey::from_secret(b"whatever the attacker guessed"),
    )
    .unwrap();

    assert!(matches!(
        validating(&ours).verify(&forged).await,
        Err(TokenError::Invalid)
    ));
}

#[tokio::test]
async fn an_unreachable_realm_is_a_503_rather_than_a_401() {
    // Nothing is listening: a credential we cannot check is not a credential
    // we have judged.
    let validator = Validator::new(
        "http://127.0.0.1:1/realms/keasy",
        "keasy-api",
        "keasy",
        None,
    );
    let signed = {
        let realm = realm("k1").await;
        mint(&realm, good(&realm))
    };

    assert!(matches!(
        validator.verify(&signed).await,
        Err(TokenError::KeysUnavailable)
    ));
}

/// The failure a missing timeout actually produces. Nothing is refused and
/// nothing is answered: the realm accepts the connection and then says
/// nothing at all, which is what a wedged Keycloak looks like from here. A
/// client with no deadline parks the Axum handler on this forever.
#[tokio::test]
async fn a_realm_that_accepts_and_never_answers_is_a_503_too() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let issuer = format!("http://{}/realms/keasy", listener.local_addr().unwrap());
    let app = Router::new().route(
        "/realms/keasy/.well-known/openid-configuration",
        get(std::future::pending::<Json<serde_json::Value>>),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let validator = Validator::new(&issuer, "keasy-api", "keasy", None);
    let signed = {
        let realm = realm("k1").await;
        mint(&realm, good(&realm))
    };

    // Generously past `REQUEST_TIMEOUT`: what is asserted is that the call
    // comes back at all, and with the honest answer when it does.
    let answered = tokio::time::timeout(
        REQUEST_TIMEOUT + Duration::from_secs(10),
        validator.verify(&signed),
    )
    .await
    .expect("the validator gives up on a hung realm rather than waiting on it");

    assert!(matches!(answered, Err(TokenError::KeysUnavailable)));
}

/// One client serves every instance, so a token is the person's across every
/// organization they belong to. What it grants here is the entry for this
/// instance's organization alone: an admin of globex is nobody in acme, and a
/// role in the top-level `resource_access` is never read.
#[tokio::test]
async fn a_role_counts_only_inside_this_instances_organization() {
    let app = crate::helpers::spawn_app().await;
    let globex_admin = app.token_in("u-1", "globex", crate::helpers::ADMIN);
    assert_eq!(
        app.answer(axum::http::Method::GET, "/v1/jobs", Some(&globex_admin))
            .await,
        (
            axum::http::StatusCode::FORBIDDEN,
            Some("rbac/no-membership".to_string())
        )
    );

    let mut top_level_only = good(&app.realm);
    top_level_only["organization"] = json!({});
    top_level_only["resource_access"] =
        json!({ CLIENT: { "roles": ["admin", "editor", "reader"] } });
    let token = mint(&app.realm, top_level_only);
    assert_eq!(
        app.answer(axum::http::Method::GET, "/v1/jobs", Some(&token))
            .await
            .1
            .as_deref(),
        Some("rbac/no-membership")
    );
}
