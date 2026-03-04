//! Keycloak Admin REST API client.
//!
//! Provides methods to authenticate via client credentials flow and manage
//! OIDC client registrations. Uses the keasy-server service account.

use std::sync::Arc;

use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use tokio::sync::Mutex;
use tokio::time::Instant;

/// Client for interacting with the Keycloak Admin REST API.
///
/// Supports Docker networking: when `internal_base_url` is set (e.g. `http://keycloak:8080`),
/// all HTTP requests go to the internal URL while the realm is derived from the public issuer.
#[derive(Clone)]
pub struct KeycloakAdmin {
    http: reqwest::Client,
    /// Keycloak base URL for HTTP requests (internal if configured, public otherwise)
    base_url: String,
    /// Keycloak realm name
    realm: String,
    /// Service account client_id
    client_id: String,
    /// Service account client_secret
    client_secret: SecretString,
    /// Cached admin token with issue time (TTL 50s, under Keycloak's 60s default)
    token_cache: Arc<Mutex<Option<(String, Instant)>>>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct ClientSecretResponse {
    value: String,
}

/// Result of resolving an OIDC client from Keycloak by clientId.
pub struct ResolvedClient {
    pub name: String,
    pub url: String,
}

/// Result of registering a new OIDC client in Keycloak.
pub struct RegisteredClient {
    /// The Keycloak-internal UUID for the client (NOT the clientId).
    pub keycloak_uuid: String,
    /// The auto-generated client secret.
    pub client_secret: String,
}

impl KeycloakAdmin {
    /// Create a new KeycloakAdmin client.
    ///
    /// `issuer_url` — full issuer URL (e.g. `http://localhost:8080/realms/keasy`).
    /// `internal_base_url` — when set (e.g. `http://keycloak:8080`), HTTP requests use
    /// this URL instead of the host from `issuer_url`. Required inside Docker where the
    /// public issuer URL (`localhost:8080`) resolves to the server container, not Keycloak.
    pub fn new(
        issuer_url: &str,
        client_id: &str,
        client_secret: SecretString,
        internal_base_url: Option<&str>,
    ) -> Result<Self, String> {
        // Parse issuer URL: http://localhost:8080/realms/keasy
        // Extract base: http://localhost:8080, realm: keasy
        let parts: Vec<&str> = issuer_url.rsplitn(2, "/realms/").collect();
        if parts.len() != 2 {
            return Err(format!(
                "Invalid OIDC issuer URL '{}': expected format '{{base}}/realms/{{realm}}'",
                issuer_url
            ));
        }
        let realm = parts[0].to_string();
        let public_base = parts[1].to_string();

        // Use internal URL for HTTP if configured (Docker networking), otherwise public
        let base_url = match internal_base_url {
            Some(url) => url.trim_end_matches('/').to_string(),
            None => public_base,
        };

        Ok(Self {
            http: reqwest::Client::new(),
            base_url,
            realm,
            client_id: client_id.to_string(),
            client_secret,
            token_cache: Arc::new(Mutex::new(None)),
        })
    }

    /// Obtain an admin bearer token using the client credentials flow.
    /// Tokens are cached for 50s (under Keycloak's default 60s lifetime).
    async fn get_admin_token(&self) -> Result<String, String> {
        {
            let cache = self.token_cache.lock().await;
            if let Some((ref token, issued_at)) = *cache {
                if issued_at.elapsed() < std::time::Duration::from_secs(50) {
                    return Ok(token.clone());
                }
            }
        }

        let token_url = format!(
            "{}/realms/{}/protocol/openid-connect/token",
            self.base_url, self.realm
        );
        let resp = self
            .http
            .post(&token_url)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.expose_secret()),
            ])
            .send()
            .await
            .map_err(|e| format!("Keycloak token request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Keycloak token request returned {status}: {body}"
            ));
        }

        let token_resp: TokenResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak token response: {e}"))?;

        let mut cache = self.token_cache.lock().await;
        *cache = Some((token_resp.access_token.clone(), Instant::now()));

        Ok(token_resp.access_token)
    }

    /// Create an OIDC client in Keycloak and return the registered client info.
    ///
    /// The `client_id` here is the OIDC clientId string (e.g., "keasy-instance-{uuid}"),
    /// NOT the Keycloak-internal UUID.
    pub async fn create_client(
        &self,
        client_id: &str,
        name: &str,
        description: Option<&str>,
        redirect_uri: &str,
        web_origin: &str,
    ) -> Result<RegisteredClient, String> {
        let token = self.get_admin_token().await?;

        let create_url = format!(
            "{}/admin/realms/{}/clients",
            self.base_url, self.realm
        );

        let body = serde_json::json!({
            "clientId": client_id,
            "name": name,
            "description": description.unwrap_or(""),
            "enabled": true,
            "protocol": "openid-connect",
            "publicClient": false,
            "standardFlowEnabled": true,
            "serviceAccountsEnabled": false,
            "directAccessGrantsEnabled": false,
            "redirectUris": [redirect_uri],
            "webOrigins": [web_origin],
        });

        let resp = self
            .http
            .post(&create_url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Keycloak client creation failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Keycloak client creation returned {status}: {body}"
            ));
        }

        // Extract Keycloak-internal UUID from Location header
        let location = resp
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();

        let keycloak_uuid = location
            .split('/')
            .last()
            .unwrap_or_default()
            .to_string();

        if keycloak_uuid.is_empty() {
            return Err("Keycloak did not return a client UUID in Location header".to_string());
        }

        // Retrieve the auto-generated client secret
        let secret = self.get_client_secret(&token, &keycloak_uuid).await?;

        Ok(RegisteredClient {
            keycloak_uuid,
            client_secret: secret,
        })
    }

    /// Ensure the keasy:dataspaces protocol mapper exists on the specified client.
    /// Idempotent: if the mapper already exists, Keycloak returns 409 which is ignored.
    pub async fn ensure_protocol_mapper(&self, keycloak_client_id: &str) -> Result<(), String> {
        let token = self.get_admin_token().await?;

        // First, find the Keycloak-internal UUID for the clientId
        let clients_url = format!(
            "{}/admin/realms/{}/clients?clientId={}",
            self.base_url, self.realm, keycloak_client_id
        );
        let resp = self
            .http
            .get(&clients_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak client lookup failed: {e}"))?;

        let clients: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak clients response: {e}"))?;

        let client_uuid = clients
            .first()
            .and_then(|c| c["id"].as_str())
            .ok_or_else(|| format!("Client '{}' not found in Keycloak", keycloak_client_id))?
            .to_string();

        // Create the protocol mapper
        let mapper_url = format!(
            "{}/admin/realms/{}/clients/{}/protocol-mappers/models",
            self.base_url, self.realm, client_uuid
        );

        let mapper_body = serde_json::json!({
            "name": "keasy-dataspaces",
            "protocol": "openid-connect",
            "protocolMapper": "oidc-usermodel-attribute-mapper",
            "config": {
                "user.attribute": "keasy.dataspaces",
                "claim.name": "keasy:dataspaces",
                "jsonType.label": "String",
                "multivalued": "true",
                "id.token.claim": "true",
                "access.token.claim": "false",
                "userinfo.token.claim": "false"
            }
        });

        let resp = self
            .http
            .post(&mapper_url)
            .bearer_auth(&token)
            .json(&mapper_body)
            .send()
            .await
            .map_err(|e| format!("Keycloak protocol mapper creation failed: {e}"))?;

        match resp.status().as_u16() {
            201 => {
                tracing::info!("Created keasy:dataspaces protocol mapper in Keycloak");
                Ok(())
            }
            409 => {
                tracing::debug!("keasy:dataspaces protocol mapper already exists");
                Ok(())
            }
            status => {
                let body = resp.text().await.unwrap_or_default();
                Err(format!(
                    "Keycloak protocol mapper creation returned {status}: {body}"
                ))
            }
        }
    }

    /// Add a workspace client_id to a Keycloak user's `keasy.dataspaces` attribute.
    ///
    /// Reads the user's current attributes, appends the client_id (deduped),
    /// and PUTs the updated attributes back.
    pub async fn add_user_workspace(
        &self,
        keycloak_user_id: &str,
        client_id: &str,
    ) -> Result<(), String> {
        let token = self.get_admin_token().await?;

        // GET current user representation
        let user_url = format!(
            "{}/admin/realms/{}/users/{}",
            self.base_url, self.realm, keycloak_user_id
        );
        let resp = self
            .http
            .get(&user_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak get user failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak get user returned {status}: {body}"));
        }

        let mut user: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak user response: {e}"))?;

        // Read existing dataspaces attribute
        let mut dataspaces: Vec<String> = user
            .get("attributes")
            .and_then(|a| a.get("keasy.dataspaces"))
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        // Dedup — only add if not already present
        if !dataspaces.contains(&client_id.to_string()) {
            dataspaces.push(client_id.to_string());
        }

        // Update the user representation
        let attributes = user
            .as_object_mut()
            .ok_or("user is not an object")?
            .entry("attributes")
            .or_insert_with(|| serde_json::json!({}));
        attributes["keasy.dataspaces"] = serde_json::json!(dataspaces);

        // PUT updated user
        let resp = self
            .http
            .put(&user_url)
            .bearer_auth(&token)
            .json(&user)
            .send()
            .await
            .map_err(|e| format!("Keycloak update user failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak update user returned {status}: {body}"));
        }

        tracing::info!(
            user_id = %keycloak_user_id,
            client_id = %client_id,
            "Added dataspace to Keycloak user"
        );
        Ok(())
    }

    /// Resolve a Keycloak OIDC client by its clientId string.
    ///
    /// Returns the client's display name and base URL (from webOrigins[0]).
    /// Used by the workspace switcher to resolve unknown dataspaces on cache miss.
    pub async fn resolve_client(&self, client_id: &str) -> Option<ResolvedClient> {
        let token = self.get_admin_token().await.ok()?;

        let clients_url = format!(
            "{}/admin/realms/{}/clients?clientId={}",
            self.base_url, self.realm, client_id
        );
        let resp = self.http
            .get(&clients_url)
            .bearer_auth(&token)
            .send()
            .await
            .ok()?;

        let clients: Vec<serde_json::Value> = resp.json().await.ok()?;
        let client = clients.first()?;

        let name = client.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(client_id)
            .to_string();

        let url = client.get("webOrigins")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())?;

        Some(ResolvedClient { name, url })
    }

    /// Read the user's workspaces from Keycloak (`keasy.dataspaces` attribute).
    ///
    /// Returns the live list from Keycloak (not the stale ID token claim).
    pub async fn get_user_workspaces(&self, keycloak_user_id: &str) -> Result<Vec<String>, String> {
        let token = self.get_admin_token().await?;
        let user_url = format!(
            "{}/admin/realms/{}/users/{}",
            self.base_url, self.realm, keycloak_user_id
        );
        let resp = self.http.get(&user_url).bearer_auth(&token).send().await
            .map_err(|e| format!("get user: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("get user returned {status}: {body}"));
        }
        let user: serde_json::Value = resp.json().await
            .map_err(|e| format!("parse user: {e}"))?;
        let dataspaces: Vec<String> = user
            .get("attributes")
            .and_then(|a| a.get("keasy.dataspaces"))
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        Ok(dataspaces)
    }

    /// Retrieve the client secret for a given Keycloak-internal client UUID.
    async fn get_client_secret(
        &self,
        token: &str,
        keycloak_uuid: &str,
    ) -> Result<String, String> {
        let secret_url = format!(
            "{}/admin/realms/{}/clients/{}/client-secret",
            self.base_url, self.realm, keycloak_uuid
        );

        let resp = self
            .http
            .get(&secret_url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Keycloak get client secret failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Keycloak get client secret returned {status}: {body}"
            ));
        }

        let secret_resp: ClientSecretResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak client secret response: {e}"))?;

        Ok(secret_resp.value)
    }
}
