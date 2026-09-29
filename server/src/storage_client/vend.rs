//! Credential vending: a credential that opens one prefix, for an hour — the
//! temporary credentials of Unity Catalog and Polaris, in Iceberg REST's form.
//!
//! The store enforces the boundary, not the reader: an S3 session policy or an
//! Azure directory SAS names the prefix, and a request outside it is refused
//! by the store whatever the reader asks for.

use std::collections::BTreeMap;
use std::time::Duration;

use aws_sdk_sts::config::{BehaviorVersion, Credentials, Region};
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

/// S3-compatible stores (MinIO, Ceph) ignore the role but the call names one.
const S3_COMPATIBLE_ROLE: &str = "arn:aws:iam::000000000000:role/keasy-vended";

const AZURE_VERSION: &str = "2022-11-02";

/// A credential that opens `location` for `access`, and nothing else.
pub async fn vend(
    credential: &StorageCredentialInput,
    location: &StorageLocation,
    access: Access,
) -> Result<VendedCredential, String> {
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
                    return Err("AWS scopes a credential to a prefix by assuming a role: \
                                the credential needs its role_arn"
                        .into());
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
            )
            .await
        }
        StorageCredentialInput::AzureServicePrincipal {
            account,
            tenant_id,
            client_id,
            client_secret,
        } => {
            let token = entra_token(tenant_id, client_id, client_secret).await?;
            let (start, expiry) = window();
            let key = user_delegation_key(account, &token, start, expiry).await?;
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
) -> Result<VendedCredential, String> {
    let mut config = aws_sdk_sts::Config::builder()
        .behavior_version(BehaviorVersion::latest())
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
        .map_err(|e| format!("the store refused to vend a credential: {}", aws_error(&e)))?;
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
    tenant_id: &str,
    client_id: &str,
    client_secret: &SecretString,
) -> Result<SecretString, String> {
    let response = reqwest::Client::new()
        .post(format!(
            "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        ))
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", client_id),
            ("client_secret", client_secret.expose_secret()),
            ("scope", "https://storage.azure.com/.default"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Entra refused the service principal ({})",
            response.status()
        ));
    }
    let token: EntraToken = response.json().await.map_err(|e| e.to_string())?;
    Ok(SecretString::from(token.access_token))
}

/// Get User Delegation Key: a key only Entra-authenticated principals obtain,
/// valid for the credential's lifetime.
async fn user_delegation_key(
    account: &str,
    token: &SecretString,
    start: DateTime<Utc>,
    expiry: DateTime<Utc>,
) -> Result<UserDelegationKey, String> {
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><KeyInfo><Start>{}</Start><Expiry>{}</Expiry></KeyInfo>",
        azure_time(start),
        azure_time(expiry)
    );
    let response = reqwest::Client::new()
        .post(format!(
            "https://{account}.blob.core.windows.net/?restype=service&comp=userdelegationkey"
        ))
        .bearer_auth(token.expose_secret())
        .header("x-ms-version", AZURE_VERSION)
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Azure refused a user delegation key ({})",
            response.status()
        ));
    }
    let text = response.text().await.map_err(|e| e.to_string())?;
    quick_xml::de::from_str(&text).map_err(|e| e.to_string())
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
}
