//! Credential vending: a credential that opens one prefix, for an hour — the
//! temporary credentials of Unity Catalog and Polaris, in Iceberg REST's form.
//!
//! The store enforces the boundary, not the reader: an S3 session policy or an
//! Azure directory SAS names the prefix, and a request outside it is refused
//! by the store whatever the reader asks for.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;

use aws_sdk_sts::config::timeout::TimeoutConfig;
use aws_sdk_sts::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_sts::error::SdkError;
use azure_core::cloud::{CloudConfiguration, CustomConfiguration};
use azure_core::credentials::{Secret, TokenCredential};
use azure_core::error::ErrorKind;
use azure_core::http::headers::{HeaderName, HeaderValue, Headers};
use azure_core::http::{
    AsyncRawResponse, Body, ClientOptions, HttpClient, Request, RetryOptions, Transport, Url,
};
use azure_core::time::OffsetDateTime;
use azure_identity::{ClientSecretCredential, ClientSecretCredentialOptions};
use azure_storage_blob::models::KeyInfo;
use azure_storage_blob::{BlobServiceClient, BlobServiceClientOptions};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use hmac::{Hmac, KeyInit, Mac};
use jiff::{SignedDuration, Timestamp};
use secrecy::{ExposeSecret, SecretString};
use sha2::Sha256;

use super::{Endpoints, StoreFailure};
use crate::domain::{Access, SecretSpec, StorageLocation, Store, VendedCredential};

/// How long a vended credential lives: Unity Catalog's and Polaris's default.
/// Readers renew it before it lapses.
pub const VENDED_FOR: Duration = Duration::from_secs(3600);

/// Azure refuses a SAS whose start is ahead of its clock; Polaris backdates by
/// the same margin.
const CLOCK_SKEW: SignedDuration = SignedDuration::from_secs(300);

/// The role a configured STS endpoint is asked for when the credential names
/// none. The dev store (`infra/dev/seaweedfs/iam.json`) declares exactly this
/// one; a store that validates roles needs the credential's `role_arn`.
const S3_COMPATIBLE_ROLE: &str = "arn:aws:iam::000000000000:role/keasy-vended";

const AZURE_VERSION: &str = "2022-11-02";

/// How long a vend waits on what is outside the process: Entra, Azure Blob,
/// STS. Each call is bounded on its own, and a vend can make two in a row
/// (Entra, then the delegation key), so the request figure is what keeps both
/// inside the server's own request deadline — and that one inside the
/// browser's — so the code that reaches the screen names who did not answer.
#[derive(Debug, Clone, Copy)]
pub struct Deadlines {
    pub connect: Duration,
    pub request: Duration,
}

pub const DEADLINES: Deadlines = Deadlines {
    connect: Duration::from_secs(5),
    request: Duration::from_secs(10),
};

const _: () = assert!(
    DEADLINES.request.saturating_mul(2).as_millis() < crate::startup::REQUEST_DEADLINE.as_millis(),
    "a vend's two calls in a row end inside the server's request deadline"
);

/// What an Azure call failed with: `who` going silent — a request deadline
/// fired anywhere under it — or a refusal, in the SDK's words.
fn azure_failure(who: &'static str, deadlines: Deadlines, e: azure_core::Error) -> StoreFailure {
    let mut cause: Option<&(dyn std::error::Error + 'static)> = Some(&e);
    while let Some(error) = cause {
        if error
            .downcast_ref::<reqwest::Error>()
            .is_some_and(reqwest::Error::is_timeout)
        {
            return StoreFailure::Silent {
                who,
                after: deadlines.request,
            };
        }
        cause = error.source();
    }
    StoreFailure::Refused(format!("{who} refused: {e}"))
}

/// The Azure SDK's requests, sent by keasy's own client: its deadlines, and
/// one try — a vend waits a request's worth, and a silent service is named,
/// not asked again.
#[derive(Debug)]
struct Bounded(reqwest::Client);

#[async_trait::async_trait]
impl HttpClient for Bounded {
    async fn execute_request(&self, request: &Request) -> azure_core::Result<AsyncRawResponse> {
        let io = |e: reqwest::Error| {
            azure_core::Error::with_error(ErrorKind::Io, e, "Azure did not answer")
        };
        let Body::Bytes(body) = request.body() else {
            return Err(azure_core::Error::with_message(
                ErrorKind::Other,
                "a streamed body",
            ));
        };
        let method = reqwest::Method::from_bytes(request.method().as_ref().as_bytes())
            .map_err(|e| azure_core::Error::with_error(ErrorKind::Other, e, "an HTTP method"))?;
        let mut sent = self
            .0
            .request(method, request.url().as_str())
            .body(body.clone());
        for (name, value) in request.headers().iter() {
            sent = sent.header(name.as_str(), value.as_str());
        }
        let answer = sent.send().await.map_err(io)?;
        let status = answer.status().as_u16();
        let headers: HashMap<HeaderName, HeaderValue> = answer
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                let value = value.to_str().ok()?.to_owned();
                Some((
                    HeaderName::from(name.as_str().to_owned()),
                    HeaderValue::from(value),
                ))
            })
            .collect();
        let body = answer.bytes().await.map_err(io)?;
        Ok(AsyncRawResponse::new(
            status.into(),
            Headers::from(headers),
            Box::pin(futures::stream::once(async move { Ok(body) })),
        ))
    }
}

/// The SDK's client options: keasy's transport, no retries, and — for a test —
/// the authority Entra is reached at.
fn sdk_options(deadlines: Deadlines, authority: Option<&str>) -> ClientOptions {
    ClientOptions {
        transport: Some(Transport::new(Arc::new(Bounded(http(deadlines))))),
        retry: RetryOptions::none(),
        cloud: authority.map(|host| {
            let mut custom = CustomConfiguration::default();
            custom.authority_host = host.into();
            Arc::new(CloudConfiguration::from(custom))
        }),
        ..Default::default()
    }
}

fn http(deadlines: Deadlines) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(deadlines.connect)
        .timeout(deadlines.request)
        .build()
        .expect("a client with timeouts builds")
}

/// A credential that opens `location` for `access`, and nothing else.
pub async fn vend(
    credential: &SecretSpec,
    location: &StorageLocation,
    endpoints: &Endpoints,
    access: Access,
) -> Result<VendedCredential, StoreFailure> {
    vend_within(credential, location, endpoints, access, DEADLINES).await
}

async fn vend_within(
    credential: &SecretSpec,
    location: &StorageLocation,
    endpoints: &Endpoints,
    access: Access,
    deadlines: Deadlines,
) -> Result<VendedCredential, StoreFailure> {
    match credential {
        SecretSpec::S3 {
            access_key_id,
            secret_access_key,
            region,
            role_arn,
            external_id,
        } => {
            let role = match (role_arn, &endpoints.sts) {
                (Some(role), _) => role.as_str(),
                (None, Some(_)) => S3_COMPATIBLE_ROLE,
                (None, None) => {
                    return Err(StoreFailure::Refused(
                        "AWS scopes a credential to a prefix by assuming a role: \
                         the credential needs its role_arn"
                            .into(),
                    ));
                }
            };
            assume_role(
                access_key_id,
                secret_access_key,
                region,
                endpoints,
                role,
                external_id.as_deref(),
                location,
                access,
                deadlines,
            )
            .await
        }
        SecretSpec::AzureServicePrincipal {
            account,
            tenant_id,
            client_id,
            client_secret,
        } => {
            let entra = entra(tenant_id, client_id, client_secret, deadlines, None)?;
            let (start, expiry) = window();
            let blob = format!("https://{account}.blob.core.windows.net");
            let key = user_delegation_key(entra, deadlines, &blob, start, expiry).await?;
            Ok(azure_credential(
                account,
                location,
                expiry,
                user_delegation_sas(account, location, access, start, expiry, &key)?,
            ))
        }
    }
}

fn window() -> (Timestamp, Timestamp) {
    let now = Timestamp::now();
    let lives = SignedDuration::from_secs(VENDED_FOR.as_secs() as i64);
    (now - CLOCK_SKEW, now + lives)
}

/// The object-key prefix a location opens: its path and a `/`, or the whole
/// bucket.
fn key_prefix(location: &StorageLocation) -> String {
    match location.path().as_ref() {
        "" => String::new(),
        path => format!("{path}/"),
    }
}

/// Unity Catalog's and Polaris's session policy: read (and list) the prefix,
/// or write under it. Never delete.
fn s3_policy(bucket: &str, prefix: &str, access: Access) -> String {
    let objects = format!("arn:aws:s3:::{bucket}/{prefix}*");
    let statements = match access {
        Access::Read => serde_json::json!([
            { "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": [objects] },
            { "Effect": "Allow", "Action": ["s3:ListBucket"],
              "Resource": [format!("arn:aws:s3:::{bucket}")],
              "Condition": { "StringLike": { "s3:prefix": [format!("{prefix}*")] } } },
        ]),
        Access::Write => serde_json::json!([
            { "Effect": "Allow", "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
              "Resource": [objects] },
        ]),
    };
    serde_json::json!({ "Version": "2012-10-17", "Statement": statements }).to_string()
}

#[allow(clippy::too_many_arguments)]
async fn assume_role(
    access_key_id: &str,
    secret_access_key: &SecretString,
    region: &str,
    endpoints: &Endpoints,
    role: &str,
    external_id: Option<&str>,
    location: &StorageLocation,
    access: Access,
    deadlines: Deadlines,
) -> Result<VendedCredential, StoreFailure> {
    let mut config = aws_sdk_sts::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        // The whole operation, retries included: the SDK's default bounds
        // only the connect.
        .timeout_config(
            TimeoutConfig::builder()
                .connect_timeout(deadlines.connect)
                .operation_timeout(deadlines.request)
                .build(),
        )
        .region(Region::new(region.to_string()))
        .credentials_provider(Credentials::new(
            access_key_id,
            secret_access_key.expose_secret(),
            None,
            None,
            "keasy",
        ));
    if let Some(endpoint) = &endpoints.sts {
        config = config.endpoint_url(endpoint);
    }
    let issued = aws_sdk_sts::Client::from_conf(config.build())
        .assume_role()
        .role_arn(role)
        .role_session_name("keasy-vended")
        .set_external_id(external_id.map(Into::into))
        .policy(s3_policy(location.bucket(), &key_prefix(location), access))
        .duration_seconds(VENDED_FOR.as_secs() as i32)
        .send()
        .await
        .map_err(|e| match e {
            SdkError::TimeoutError(_) => StoreFailure::Silent {
                who: "STS",
                after: deadlines.request,
            },
            e => StoreFailure::Refused(format!(
                "the store refused to vend a credential: {}",
                aws_error(&e)
            )),
        })?;
    let credentials = issued.credentials.ok_or("the store vended no credential")?;

    let mut config = BTreeMap::new();
    let mut put = |key: &str, value: String| {
        config.insert(key.to_string(), SecretString::from(value));
    };
    put("s3.access-key-id", credentials.access_key_id);
    put("s3.secret-access-key", credentials.secret_access_key);
    put("s3.session-token", credentials.session_token);
    put(
        "s3.session-token-expires-at-ms",
        (credentials.expiration.secs() * 1000).to_string(),
    );
    put("client.region", region.to_string());
    if let Some(endpoint) = &endpoints.s3 {
        put("s3.endpoint", endpoint.clone());
        put("s3.path-style-access", "true".into());
    }
    Ok(VendedCredential {
        prefix: location.to_string(),
        config,
    })
}

fn aws_error<E: std::error::Error + 'static>(e: &E) -> String {
    let mut message = e.to_string();
    let mut source = e.source();
    while let Some(inner) = source {
        message = format!("{message}: {inner}");
        source = inner.source();
    }
    message
}

fn azure_credential(
    account: &str,
    location: &StorageLocation,
    expiry: Timestamp,
    sas: String,
) -> VendedCredential {
    let host = format!("{account}.dfs.core.windows.net");
    let mut config = BTreeMap::new();
    config.insert(format!("adls.sas-token.{host}"), SecretString::from(sas));
    config.insert(
        format!("adls.sas-token-expires-at-ms.{host}"),
        SecretString::from(expiry.as_millisecond().to_string()),
    );
    VendedCredential {
        prefix: location.to_string(),
        config,
    }
}

/// The SAS resource a location is: its container, or a directory `depth`
/// segments down.
fn sas_resource(location: &StorageLocation) -> (&'static str, Option<usize>) {
    match location.path().parts().count() {
        0 => ("c", None),
        depth => ("d", Some(depth)),
    }
}

fn canonical_resource(account: &str, location: &StorageLocation) -> String {
    let container = match location.store() {
        Store::Azure { container, .. } => container.as_str(),
        Store::S3 { bucket, .. } => bucket.as_str(),
    };
    match location.path().as_ref() {
        "" => format!("/blob/{account}/{container}"),
        path => format!("/blob/{account}/{container}/{path}"),
    }
}

fn permissions(access: Access) -> &'static str {
    match access {
        Access::Read => "rl",
        Access::Write => "cw",
    }
}

fn azure_time(t: Timestamp) -> String {
    t.strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn hmac_base64(key: &[u8], message: &str) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|e| e.to_string())?;
    mac.update(message.as_bytes());
    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}

fn query(pairs: &[(&str, &str)]) -> String {
    let mut out = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs.iter().filter(|(_, v)| !v.is_empty()) {
        out.append_pair(k, v);
    }
    out.finish()
}

/// A user-delegation key as the SAS is signed with it: the SDK's, spelled.
struct UserDelegationKey {
    signed_oid: String,
    signed_tid: String,
    signed_start: String,
    signed_expiry: String,
    signed_service: String,
    signed_version: String,
    value: Vec<u8>,
}

/// The service principal, as the Azure SDK's credential: it gets the Entra
/// token, the OAuth 2.0 client credentials grant. `authority` is a test's.
fn entra(
    tenant_id: &str,
    client_id: &str,
    client_secret: &SecretString,
    deadlines: Deadlines,
    authority: Option<&str>,
) -> Result<Arc<ClientSecretCredential>, StoreFailure> {
    ClientSecretCredential::new(
        tenant_id,
        client_id.into(),
        Secret::new(client_secret.expose_secret().to_owned()),
        Some(ClientSecretCredentialOptions {
            client_options: sdk_options(deadlines, authority),
        }),
    )
    .map_err(|e| StoreFailure::Refused(format!("the service principal: {e}")))
}

/// Get User Delegation Key, through the Azure SDK: a key only an
/// Entra-authenticated principal obtains, for the credential's lifetime. The
/// token is asked for first, so a silent Entra is named, not Azure Blob.
async fn user_delegation_key(
    entra: Arc<impl TokenCredential + 'static>,
    deadlines: Deadlines,
    blob: &str,
    start: Timestamp,
    expiry: Timestamp,
) -> Result<UserDelegationKey, StoreFailure> {
    entra
        .get_token(&[STORAGE_SCOPE], None)
        .await
        .map_err(|e| azure_failure("Entra", deadlines, e))?;
    let failed = |e| azure_failure("Azure Blob", deadlines, e);
    let url = Url::parse(blob).map_err(|e| StoreFailure::Refused(format!("{blob}: {e}")))?;
    let client = BlobServiceClient::new(
        url,
        Some(entra),
        Some(BlobServiceClientOptions {
            client_options: sdk_options(deadlines, None),
            ..Default::default()
        }),
    )
    .map_err(failed)?;
    let window = KeyInfo {
        start: Some(offset(start)?),
        expiry: Some(offset(expiry)?),
        ..Default::default()
    };
    let key = client
        .get_user_delegation_key(window.try_into().map_err(failed)?, None)
        .await
        .map_err(failed)?
        .into_model()
        .map_err(failed)?;
    let missing = || StoreFailure::Refused("Azure answered an incomplete delegation key".into());
    let spelled =
        |t: Option<_>| -> Result<String, StoreFailure> { spelled(t.ok_or_else(missing)?) };
    Ok(UserDelegationKey {
        signed_oid: key.signed_oid.ok_or_else(missing)?,
        signed_tid: key.signed_tid.ok_or_else(missing)?,
        signed_start: spelled(key.signed_start)?,
        signed_expiry: spelled(key.signed_expiry)?,
        signed_service: key.signed_service.ok_or_else(missing)?,
        signed_version: key.signed_version.ok_or_else(missing)?,
        value: key.value.ok_or_else(missing)?,
    })
}

/// Azure Storage's scope: what the token is for.
const STORAGE_SCOPE: &str = "https://storage.azure.com/.default";

/// A timestamp as the SDK's clock holds it.
fn offset(t: Timestamp) -> Result<OffsetDateTime, StoreFailure> {
    OffsetDateTime::from_unix_timestamp(t.as_second())
        .map_err(|e| StoreFailure::Refused(e.to_string()))
}

/// The SDK's time as a SAS spells it.
fn spelled(t: OffsetDateTime) -> Result<String, StoreFailure> {
    Timestamp::from_second(t.unix_timestamp())
        .map(azure_time)
        .map_err(|e| StoreFailure::Refused(e.to_string()))
}

/// A user delegation SAS over the location's directory: the string-to-sign of
/// version 2020-12-06 and later, signed with the delegation key.
fn user_delegation_sas(
    account: &str,
    location: &StorageLocation,
    access: Access,
    start: Timestamp,
    expiry: Timestamp,
    key: &UserDelegationKey,
) -> Result<String, String> {
    let (resource, depth) = sas_resource(location);
    let (st, se) = (azure_time(start), azure_time(expiry));
    let permissions = permissions(access);
    let to_sign = [
        permissions,
        &st,
        &se,
        &canonical_resource(account, location),
        &key.signed_oid,
        &key.signed_tid,
        &key.signed_start,
        &key.signed_expiry,
        &key.signed_service,
        &key.signed_version,
        "", // signedAuthorizedUserObjectId
        "", // signedUnauthorizedUserObjectId
        "", // signedCorrelationId
        "", // signedIP
        "https",
        AZURE_VERSION,
        resource,
        "", // signedSnapshotTime
        "", // signedEncryptionScope
        "",
        "",
        "",
        "",
        "", // rscc, rscd, rsce, rscl, rsct
    ]
    .join("\n");
    let signature = hmac_base64(&key.value, &to_sign)?;
    let depth = depth.map(|d| d.to_string()).unwrap_or_default();
    Ok(query(&[
        ("sv", AZURE_VERSION),
        ("sr", resource),
        ("sdd", &depth),
        ("st", &st),
        ("se", &se),
        ("sp", permissions),
        ("spr", "https"),
        ("skoid", &key.signed_oid),
        ("sktid", &key.signed_tid),
        ("skt", &key.signed_start),
        ("ske", &key.signed_expiry),
        ("sks", &key.signed_service),
        ("skv", &key.signed_version),
        ("sig", &signature),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loc(s: &str) -> StorageLocation {
        StorageLocation::parse(s).unwrap()
    }

    #[test]
    fn the_session_policy_opens_one_prefix_and_never_its_siblings() {
        let read: serde_json::Value = serde_json::from_str(&s3_policy(
            "b",
            &key_prefix(&loc("s3://b/output/graph-1")),
            Access::Read,
        ))
        .unwrap();
        assert_eq!(
            read["Statement"][0]["Resource"][0],
            "arn:aws:s3:::b/output/graph-1/*"
        );
        assert_eq!(
            read["Statement"][1]["Condition"]["StringLike"]["s3:prefix"][0],
            "output/graph-1/*"
        );
        let write: serde_json::Value =
            serde_json::from_str(&s3_policy("b", "output/graph-1/", Access::Write)).unwrap();
        let actions = write["Statement"][0]["Action"].to_string();
        assert!(actions.contains("s3:PutObject") && !actions.contains("Delete"));
        assert!(!actions.contains("GetObject"));
        assert_eq!(key_prefix(&loc("s3://b")), "");
    }

    #[test]
    fn a_sas_names_the_directory_it_opens() {
        let dir = loc("abfss://c@acct.dfs.core.windows.net/output/graph-1");
        assert_eq!(sas_resource(&dir), ("d", Some(2)));
        assert_eq!(
            canonical_resource("acct", &dir),
            "/blob/acct/c/output/graph-1"
        );
        let root = loc("az://c");
        assert_eq!(sas_resource(&root), ("c", None));
        assert_eq!(canonical_resource("acct", &root), "/blob/acct/c");
        let key = UserDelegationKey {
            signed_oid: "oid".into(),
            signed_tid: "tid".into(),
            signed_start: "s".into(),
            signed_expiry: "e".into(),
            signed_service: "b".into(),
            signed_version: AZURE_VERSION.into(),
            value: b"key".to_vec(),
        };
        let (st, se) = window();
        let sas = user_delegation_sas("acct", &dir, Access::Read, st, se, &key).unwrap();
        assert!(sas.contains("sr=d") && sas.contains("sdd=2") && sas.contains("sp=rl"));
        assert!(sas.contains("skoid=oid"));
        let half: Timestamp = "2026-10-13T12:00:00.5Z".parse().unwrap();
        assert_eq!(
            azure_time(half),
            "2026-10-13T12:00:00Z",
            "whole seconds, in UTC"
        );
    }

    /// A listener that accepts every connection and never answers: the
    /// kernel completes the handshake, so only a request deadline ends the
    /// wait — over `https` too, whose TLS handshake gets no answer either (the
    /// Azure SDK reaches Entra only over `https`).
    async fn silent(scheme: &str) -> (tokio::net::TcpListener, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("{scheme}://{}", listener.local_addr().unwrap());
        (listener, url)
    }

    /// A credential that has its token already: what Azure Blob is asked with.
    #[derive(Debug)]
    struct Granted;

    #[async_trait::async_trait]
    impl TokenCredential for Granted {
        async fn get_token(
            &self,
            _: &[&str],
            _: Option<azure_core::credentials::TokenRequestOptions<'_>>,
        ) -> azure_core::Result<azure_core::credentials::AccessToken> {
            Ok(azure_core::credentials::AccessToken::new(
                "token",
                OffsetDateTime::now_utc() + std::time::Duration::from_secs(3600),
            ))
        }
    }

    const SHORT: Deadlines = Deadlines {
        connect: Duration::from_millis(200),
        request: Duration::from_millis(300),
    };

    fn is_silent(e: &StoreFailure, expected: &str) -> bool {
        matches!(e, StoreFailure::Silent { who, after } if *who == expected && *after == SHORT.request)
    }

    #[tokio::test]
    async fn an_entra_that_accepts_and_never_answers_is_named_silent() {
        let (_held, url) = silent("https").await;
        let started = std::time::Instant::now();
        let entra = entra("t", "c", &SecretString::from("s"), SHORT, Some(&url)).unwrap();
        let (start, expiry) = window();
        let Err(err) = user_delegation_key(
            entra,
            SHORT,
            "https://acct.blob.core.windows.net",
            start,
            expiry,
        )
        .await
        else {
            panic!("a silent Entra vended a key");
        };
        assert!(is_silent(&err, "Entra"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test]
    async fn an_azure_blob_that_accepts_and_never_answers_is_named_silent() {
        let (_held, url) = silent("https").await;
        let (start, expiry) = window();
        let Err(err) = user_delegation_key(Arc::new(Granted), SHORT, &url, start, expiry).await
        else {
            panic!("a silent Azure Blob vended a key");
        };
        assert!(is_silent(&err, "Azure Blob"), "{err}");
    }

    #[tokio::test]
    async fn an_sts_that_accepts_and_never_answers_is_named_silent() {
        let (_held, url) = silent("http").await;
        let credential = SecretSpec::S3 {
            access_key_id: "AK".into(),
            secret_access_key: SecretString::from("secret"),
            region: "us-east-1".into(),
            role_arn: None,
            external_id: None,
        };
        let endpoints = Endpoints {
            s3: None,
            sts: Some(url),
        };
        let started = std::time::Instant::now();
        let err = vend_within(
            &credential,
            &loc("s3://b/out"),
            &endpoints,
            Access::Read,
            SHORT,
        )
        .await
        .unwrap_err();
        assert!(is_silent(&err, "STS"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
