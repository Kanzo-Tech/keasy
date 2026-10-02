//! Credential vending: a credential that opens one prefix, for an hour — the
//! temporary credentials of Unity Catalog and Polaris, in Iceberg REST's form.
//!
//! The store enforces the boundary, not the reader: an S3 session policy or an
//! Azure directory SAS names the prefix, and a request outside it is refused
//! by the store whatever the reader asks for.

use std::collections::BTreeMap;
use std::time::Duration;

use aws_sdk_sts::config::timeout::TimeoutConfig;
use aws_sdk_sts::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_sts::error::SdkError;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{DateTime, SecondsFormat, Utc};
use hmac::{Hmac, KeyInit, Mac};
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use sha2::Sha256;

use crate::domain::{Access, StorageCredentialInput, StorageLocation, Store, VendedCredential};

/// How long a vended credential lives: Unity Catalog's and Polaris's default.
/// Readers renew it before it lapses.
pub const VENDED_FOR: Duration = Duration::from_secs(3600);

/// Azure refuses a SAS whose start is ahead of its clock; Polaris backdates by
/// the same margin.
const CLOCK_SKEW: Duration = Duration::from_secs(300);

/// The role an S3-compatible endpoint is asked for when the credential names
/// none. The dev store (`infra/dev/seaweedfs/iam.json`) declares exactly this
/// one; a store that validates roles needs the credential's `role_arn`.
const S3_COMPATIBLE_ROLE: &str = "arn:aws:iam::000000000000:role/keasy-vended";

const AZURE_VERSION: &str = "2022-11-02";

const ENTRA: &str = "https://login.microsoftonline.com";

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

/// Why a vend did not happen: the store said no, or it said nothing in time.
#[derive(Debug)]
pub enum VendError {
    Refused(String),
    /// `who` did not answer within `after`.
    Silent {
        who: &'static str,
        after: Duration,
    },
}

impl std::fmt::Display for VendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(message) => f.write_str(message),
            Self::Silent { who, after } => {
                write!(f, "{who} did not answer within {} s", after.as_secs_f64())
            }
        }
    }
}

impl From<String> for VendError {
    fn from(message: String) -> Self {
        Self::Refused(message)
    }
}

impl From<&str> for VendError {
    fn from(message: &str) -> Self {
        Self::Refused(message.to_string())
    }
}

/// A reqwest failure, as a refusal or as `who` going silent.
fn reqwest_error(who: &'static str, deadlines: Deadlines, e: reqwest::Error) -> VendError {
    if e.is_timeout() {
        VendError::Silent {
            who,
            after: deadlines.request,
        }
    } else {
        VendError::Refused(format!("{who}: {e}"))
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
    credential: &StorageCredentialInput,
    location: &StorageLocation,
    access: Access,
) -> Result<VendedCredential, VendError> {
    vend_within(credential, location, access, DEADLINES).await
}

async fn vend_within(
    credential: &StorageCredentialInput,
    location: &StorageLocation,
    access: Access,
    deadlines: Deadlines,
) -> Result<VendedCredential, VendError> {
    match credential {
        StorageCredentialInput::S3 {
            access_key_id,
            secret_access_key,
            region,
            endpoint,
            role_arn,
            external_id,
        } => {
            let role = match (role_arn, endpoint) {
                (Some(role), _) => role.as_str(),
                (None, Some(_)) => S3_COMPATIBLE_ROLE,
                (None, None) => {
                    return Err(VendError::Refused(
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
                endpoint.as_deref(),
                role,
                external_id.as_deref(),
                location,
                access,
                deadlines,
            )
            .await
        }
        StorageCredentialInput::AzureServicePrincipal {
            account,
            tenant_id,
            client_id,
            client_secret,
        } => {
            let client = http(deadlines);
            let token = entra_token(
                &client,
                deadlines,
                ENTRA,
                tenant_id,
                client_id,
                client_secret,
            )
            .await?;
            let (start, expiry) = window();
            let blob = format!("https://{account}.blob.core.windows.net");
            let key = user_delegation_key(&client, deadlines, &blob, &token, start, expiry).await?;
            Ok(azure_credential(
                account,
                location,
                expiry,
                user_delegation_sas(account, location, access, start, expiry, &key)?,
            ))
        }
        StorageCredentialInput::AzureAccountKey { account, key } => {
            let (start, expiry) = window();
            Ok(azure_credential(
                account,
                location,
                expiry,
                service_sas(account, key, location, access, start, expiry)?,
            ))
        }
    }
}

fn window() -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    (now - CLOCK_SKEW, now + VENDED_FOR)
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
    endpoint: Option<&str>,
    role: &str,
    external_id: Option<&str>,
    location: &StorageLocation,
    access: Access,
    deadlines: Deadlines,
) -> Result<VendedCredential, VendError> {
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
    if let Some(endpoint) = endpoint {
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
            SdkError::TimeoutError(_) => VendError::Silent {
                who: "STS",
                after: deadlines.request,
            },
            e => VendError::Refused(format!(
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
    if let Some(endpoint) = endpoint {
        put("s3.endpoint", endpoint.to_string());
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
    expiry: DateTime<Utc>,
    sas: String,
) -> VendedCredential {
    let host = format!("{account}.dfs.core.windows.net");
    let mut config = BTreeMap::new();
    config.insert(format!("adls.sas-token.{host}"), SecretString::from(sas));
    config.insert(
        format!("adls.sas-token-expires-at-ms.{host}"),
        SecretString::from(expiry.timestamp_millis().to_string()),
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

fn azure_time(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct UserDelegationKey {
    signed_oid: String,
    signed_tid: String,
    signed_start: String,
    signed_expiry: String,
    signed_service: String,
    signed_version: String,
    value: String,
}

#[derive(Deserialize)]
struct EntraToken {
    access_token: String,
}

/// A token for Azure Storage from the service principal: the OAuth 2.0 client
/// credentials grant.
async fn entra_token(
    client: &reqwest::Client,
    deadlines: Deadlines,
    base: &str,
    tenant_id: &str,
    client_id: &str,
    client_secret: &SecretString,
) -> Result<SecretString, VendError> {
    let silent = |e| reqwest_error("Entra", deadlines, e);
    let response = client
        .post(format!("{base}/{tenant_id}/oauth2/v2.0/token"))
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", client_id),
            ("client_secret", client_secret.expose_secret()),
            ("scope", "https://storage.azure.com/.default"),
        ])
        .send()
        .await
        .map_err(silent)?;
    if !response.status().is_success() {
        return Err(VendError::Refused(format!(
            "Entra refused the service principal ({})",
            response.status()
        )));
    }
    let token: EntraToken = response.json().await.map_err(silent)?;
    Ok(SecretString::from(token.access_token))
}

/// Get User Delegation Key: a key only Entra-authenticated principals obtain,
/// valid for the credential's lifetime.
async fn user_delegation_key(
    client: &reqwest::Client,
    deadlines: Deadlines,
    blob: &str,
    token: &SecretString,
    start: DateTime<Utc>,
    expiry: DateTime<Utc>,
) -> Result<UserDelegationKey, VendError> {
    let silent = |e| reqwest_error("Azure Blob", deadlines, e);
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><KeyInfo><Start>{}</Start><Expiry>{}</Expiry></KeyInfo>",
        azure_time(start),
        azure_time(expiry)
    );
    let response = client
        .post(format!("{blob}/?restype=service&comp=userdelegationkey"))
        .bearer_auth(token.expose_secret())
        .header("x-ms-version", AZURE_VERSION)
        .body(body)
        .send()
        .await
        .map_err(silent)?;
    if !response.status().is_success() {
        return Err(VendError::Refused(format!(
            "Azure refused a user delegation key ({})",
            response.status()
        )));
    }
    let text = response.text().await.map_err(silent)?;
    quick_xml::de::from_str(&text).map_err(|e| VendError::Refused(e.to_string()))
}

/// A user delegation SAS over the location's directory: the string-to-sign of
/// version 2020-12-06 and later, signed with the delegation key.
fn user_delegation_sas(
    account: &str,
    location: &StorageLocation,
    access: Access,
    start: DateTime<Utc>,
    expiry: DateTime<Utc>,
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
    let key_bytes = STANDARD.decode(&key.value).map_err(|e| e.to_string())?;
    let signature = hmac_base64(&key_bytes, &to_sign)?;
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

/// A service SAS over the location's directory, signed with the account key.
/// A directory SAS needs a hierarchical namespace; on a flat account the store
/// refuses it, and the connection does not validate.
fn service_sas(
    account: &str,
    key: &SecretString,
    location: &StorageLocation,
    access: Access,
    start: DateTime<Utc>,
    expiry: DateTime<Utc>,
) -> Result<String, String> {
    let (resource, depth) = sas_resource(location);
    let (st, se) = (azure_time(start), azure_time(expiry));
    let permissions = permissions(access);
    let to_sign = [
        permissions,
        &st,
        &se,
        &canonical_resource(account, location),
        "", // signedIdentifier
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
    let key_bytes = STANDARD
        .decode(key.expose_secret())
        .map_err(|_| "the account key is not base64".to_string())?;
    let signature = hmac_base64(&key_bytes, &to_sign)?;
    let depth = depth.map(|d| d.to_string()).unwrap_or_default();
    Ok(query(&[
        ("sv", AZURE_VERSION),
        ("sr", resource),
        ("sdd", &depth),
        ("st", &st),
        ("se", &se),
        ("sp", permissions),
        ("spr", "https"),
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
            &key_prefix(&loc("s3://b/output/job-1")),
            Access::Read,
        ))
        .unwrap();
        assert_eq!(
            read["Statement"][0]["Resource"][0],
            "arn:aws:s3:::b/output/job-1/*"
        );
        assert_eq!(
            read["Statement"][1]["Condition"]["StringLike"]["s3:prefix"][0],
            "output/job-1/*"
        );
        let write: serde_json::Value =
            serde_json::from_str(&s3_policy("b", "output/job-1/", Access::Write)).unwrap();
        let actions = write["Statement"][0]["Action"].to_string();
        assert!(actions.contains("s3:PutObject") && !actions.contains("Delete"));
        assert!(!actions.contains("GetObject"));
        assert_eq!(key_prefix(&loc("s3://b")), "");
    }

    #[test]
    fn a_sas_names_the_directory_it_opens() {
        let dir = loc("abfss://c@acct.dfs.core.windows.net/output/job-1");
        assert_eq!(sas_resource(&dir), ("d", Some(2)));
        assert_eq!(
            canonical_resource("acct", &dir),
            "/blob/acct/c/output/job-1"
        );
        let root = loc("az://c");
        assert_eq!(sas_resource(&root), ("c", None));
        assert_eq!(canonical_resource("acct", &root), "/blob/acct/c");
        let key = SecretString::from(STANDARD.encode(b"key"));
        let (st, se) = window();
        let sas = service_sas("acct", &key, &dir, Access::Read, st, se).unwrap();
        assert!(sas.contains("sr=d") && sas.contains("sdd=2") && sas.contains("sp=rl"));
        assert!(!sas.contains("skoid"));
    }

    /// A listener that accepts every connection and never answers: the
    /// kernel completes the handshake, so only a request deadline ends the wait.
    async fn silent() -> (tokio::net::TcpListener, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        (listener, url)
    }

    const SHORT: Deadlines = Deadlines {
        connect: Duration::from_millis(200),
        request: Duration::from_millis(300),
    };

    fn is_silent(e: &VendError, expected: &str) -> bool {
        matches!(e, VendError::Silent { who, after } if *who == expected && *after == SHORT.request)
    }

    #[tokio::test]
    async fn an_entra_that_accepts_and_never_answers_is_named_silent() {
        let (_held, url) = silent().await;
        let started = std::time::Instant::now();
        let err = entra_token(
            &http(SHORT),
            SHORT,
            &url,
            "t",
            "c",
            &SecretString::from("s"),
        )
        .await
        .unwrap_err();
        assert!(is_silent(&err, "Entra"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test]
    async fn an_azure_blob_that_accepts_and_never_answers_is_named_silent() {
        let (_held, url) = silent().await;
        let (start, expiry) = window();
        let err = user_delegation_key(
            &http(SHORT),
            SHORT,
            &url,
            &SecretString::from("token"),
            start,
            expiry,
        )
        .await
        .unwrap_err();
        assert!(is_silent(&err, "Azure Blob"), "{err}");
    }

    #[tokio::test]
    async fn an_sts_that_accepts_and_never_answers_is_named_silent() {
        let (_held, url) = silent().await;
        let credential = StorageCredentialInput::S3 {
            access_key_id: "AK".into(),
            secret_access_key: SecretString::from("secret"),
            region: "us-east-1".into(),
            endpoint: Some(url),
            role_arn: None,
            external_id: None,
        };
        let started = std::time::Instant::now();
        let err = vend_within(&credential, &loc("s3://b/out"), Access::Read, SHORT)
            .await
            .unwrap_err();
        assert!(is_silent(&err, "STS"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
