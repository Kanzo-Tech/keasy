//! Keycloak Admin REST API client.
//!
//! Provides methods to authenticate via client credentials flow and manage
//! OIDC client registrations. Uses the keasy-server service account.

use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;

/// Client for interacting with the Keycloak Admin REST API.
#[derive(Clone)]
pub struct KeycloakAdmin {
    http: reqwest::Client,
    /// Internal Keycloak base URL (e.g., http://keycloak:8080/auth)
    base_url: String,
    /// Keycloak realm name
    realm: String,
    /// Service account client_id
    client_id: String,
    /// Service account client_secret
    client_secret: SecretString,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct ClientSecretResponse {
    value: String,
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
    /// `issuer_url` should be the full issuer URL (e.g., http://keycloak:8080/auth/realms/keasy).
    /// The base URL and realm are extracted from it.
    pub fn new(
        issuer_url: &str,
        client_id: &str,
        client_secret: SecretString,
    ) -> Result<Self, String> {
        // Parse issuer URL: http://keycloak:8080/auth/realms/keasy
        // Extract base: http://keycloak:8080/auth, realm: keasy
        let parts: Vec<&str> = issuer_url.rsplitn(2, "/realms/").collect();
        if parts.len() != 2 {
            return Err(format!(
                "Invalid OIDC issuer URL '{}': expected format '{{base}}/realms/{{realm}}'",
                issuer_url
            ));
        }
        let realm = parts[0].to_string();
        let base_url = parts[1].to_string();

        Ok(Self {
            http: reqwest::Client::new(),
            base_url,
            realm,
            client_id: client_id.to_string(),
            client_secret,
        })
    }

    /// Obtain an admin bearer token using the client credentials flow.
    async fn get_admin_token(&self) -> Result<String, String> {
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
