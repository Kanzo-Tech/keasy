//! Keycloak Admin REST API client.
//!
//! Provides methods to authenticate via client credentials flow and manage
//! OIDC client registrations. Uses the keasy-server service account.

use std::collections::HashMap;
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

/// A workspace the user belongs to, resolved from a Keycloak Organization.
/// Backs the workspace switcher (display name + home URL).
pub struct Workspace {
    /// The organization id.
    pub id: String,
    pub name: String,
    pub url: String,
}

/// A Keycloak Organization as listed by the control-plane — the source of truth
/// for the tenant fleet. `attributes` carries the keasy metadata (home URL,
/// owner email, per-tenant image pin) the provisioner stores there.
pub struct OrgSummary {
    /// Organization id (Keycloak-internal UUID).
    pub id: String,
    /// Organization alias — the tenant slug. `workspace_id` is `keasy-ws-{alias}`.
    pub alias: String,
    /// Display name.
    pub name: String,
    /// Home URL (the `keasy.url` attribute).
    pub url: String,
    /// Raw organization attributes (`key → [values]`), incl. `owner_email` and
    /// `server_image`.
    pub attributes: HashMap<String, Vec<String>>,
}

/// A workspace member as resolved from Keycloak client-role mappings — the
/// Keycloak-native replacement for the old local `org_members` row.
pub struct WorkspaceMember {
    pub user_id: String,
    /// `"owner"` or `"member"`.
    pub role: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    /// Keycloak user creation time in epoch milliseconds, if present.
    pub created_timestamp: Option<i64>,
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
            if let Some((ref token, issued_at)) = *cache
                && issued_at.elapsed() < std::time::Duration::from_secs(50) {
                    return Ok(token.clone());
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
            .next_back()
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

    /// Delete an OIDC client by its Keycloak-internal UUID. Used by the
    /// control-plane to roll back a half-provisioned workspace and to tear one
    /// down on `DELETE /workspaces/{id}`. A 404 is treated as success
    /// (idempotent — the client is already gone).
    pub async fn delete_client(&self, keycloak_uuid: &str) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/clients/{}",
            self.base_url, self.realm, keycloak_uuid
        );
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak client deletion failed: {e}"))?;

        if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Keycloak client deletion returned {status}: {body}"))
        }
    }

    /// Ensure a Keycloak Organization exists for this workspace — the native
    /// membership container AND (with `attributes`) the tenant's record of truth.
    /// Idempotent: if one already has `alias` its `attributes` are refreshed (PUT)
    /// and its id returned; otherwise it is created. The home URL is always stored
    /// as the `keasy.url` attribute; `attributes` carries the rest (`owner_email`,
    /// `server_image`).
    pub async fn ensure_organization(
        &self,
        name: &str,
        alias: &str,
        url: &str,
        attributes: &[(&str, &str)],
    ) -> Result<String, String> {
        // The attribute set the control-plane manages on the org (keasy.url is
        // always present; the caller supplies owner_email + server_image).
        let mut managed = serde_json::Map::new();
        managed.insert("keasy.url".to_string(), serde_json::json!([url]));
        for (k, v) in attributes {
            managed.insert((*k).to_string(), serde_json::json!([v]));
        }

        // Existing org: refresh the managed attributes in place and return its id.
        if let Some(id) = self.resolve_org_id(alias).await? {
            self.update_org_attributes(&id, &managed).await?;
            return Ok(id);
        }

        let token = self.get_admin_token().await?;
        let orgs_url = format!(
            "{}/admin/realms/{}/organizations",
            self.base_url, self.realm
        );
        let body = serde_json::json!({
            "name": name,
            "alias": alias,
            "domains": [{ "name": host_of(url), "verified": true }],
            "attributes": serde_json::Value::Object(managed)
        });
        let resp = self
            .http
            .post(&orgs_url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Keycloak create organization failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak create organization returned {status}: {b}"));
        }

        // The new org id arrives in the Location header; fall back to a lookup.
        if let Some(id) = resp
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .and_then(|l| l.rsplit('/').next())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
        {
            tracing::info!(alias = %alias, org_id = %id, "Created Keycloak organization");
            return Ok(id);
        }
        self.resolve_org_id(alias)
            .await?
            .ok_or_else(|| "organization created but not found".to_string())
    }

    /// Merge `managed` into an existing org's attributes (GET the representation,
    /// overwrite the managed keys, PUT it back). Keeps any other attributes Keycloak
    /// holds intact — only the keasy-managed keys are touched.
    async fn update_org_attributes(
        &self,
        org_id: &str,
        managed: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations/{}",
            self.base_url, self.realm, org_id
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak get organization failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak get organization returned {status}: {b}"));
        }
        let mut rep: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse organization: {e}"))?;
        let obj = rep
            .as_object_mut()
            .ok_or_else(|| "organization representation is not an object".to_string())?;
        let attrs = obj
            .entry("attributes")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(map) = attrs.as_object_mut() {
            for (k, v) in managed {
                map.insert(k.clone(), v.clone());
            }
        }
        let resp = self
            .http
            .put(&url)
            .bearer_auth(&token)
            .json(&rep)
            .send()
            .await
            .map_err(|e| format!("Keycloak update organization failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak update organization returned {status}: {b}"));
        }
        Ok(())
    }

    /// List every Keycloak Organization — the fleet of tenants. Each carries its
    /// `attributes` (incl. `owner_email` + `server_image`) so the control-plane can
    /// reconcile/list without any local registry.
    pub async fn list_organizations(&self) -> Result<Vec<OrgSummary>, String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations?max=1000",
            self.base_url, self.realm
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak list organizations failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak list organizations returned {status}: {b}"));
        }
        let orgs: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse organizations: {e}"))?;
        Ok(orgs
            .into_iter()
            .filter_map(|o| {
                let id = o.get("id").and_then(|v| v.as_str())?.to_string();
                let alias = o.get("alias").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let name = o.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let attributes = parse_attributes(&o);
                let url = attributes
                    .get("keasy.url")
                    .and_then(|v| v.first())
                    .cloned()
                    .unwrap_or_default();
                Some(OrgSummary { id, alias, name, url, attributes })
            })
            .collect())
    }

    /// Resolve a clientId string to its Keycloak-internal UUID, or `None` if no
    /// such client exists. Used by the control-plane to make provision/deprovision
    /// idempotent (skip create when the client is already there; skip delete when
    /// it is already gone).
    pub async fn get_client_uuid(&self, client_id: &str) -> Result<Option<String>, String> {
        let token = self.get_admin_token().await?;
        let clients_url = format!(
            "{}/admin/realms/{}/clients?clientId={}",
            self.base_url, self.realm, client_id
        );
        let resp = self
            .http
            .get(&clients_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak client lookup failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak client lookup returned {status}: {b}"));
        }
        let clients: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak clients response: {e}"))?;
        Ok(clients
            .first()
            .and_then(|c| c["id"].as_str())
            .map(|s| s.to_string()))
    }

    /// Resolve an organization's id by its alias. `None` if not found.
    pub async fn resolve_org_id(&self, alias: &str) -> Result<Option<String>, String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations?search={}",
            self.base_url, self.realm, alias
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak list organizations failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak list organizations returned {status}: {b}"));
        }
        let orgs: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse organizations: {e}"))?;
        Ok(orgs
            .into_iter()
            .find(|o| o.get("alias").and_then(|v| v.as_str()) == Some(alias))
            .and_then(|o| o.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())))
    }

    /// Delete an Organization by its Keycloak id — used to roll back a
    /// half-provisioned workspace so no orphan org is left behind. A 404 is
    /// treated as success (idempotent).
    pub async fn delete_organization(&self, org_id: &str) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations/{}",
            self.base_url, self.realm, org_id
        );
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak organization deletion failed: {e}"))?;
        if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Keycloak organization deletion returned {status}: {body}"))
        }
    }

    /// Add a user as a member of the workspace's organization. Idempotent:
    /// a 409 (already a member) is treated as success.
    pub async fn add_org_member(
        &self,
        org_id: &str,
        keycloak_user_id: &str,
    ) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations/{}/members",
            self.base_url, self.realm, org_id
        );
        // The body is the user id as a raw JSON string.
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&token)
            .json(&serde_json::json!(keycloak_user_id))
            .send()
            .await
            .map_err(|e| format!("Keycloak add org member failed: {e}"))?;
        match resp.status().as_u16() {
            200 | 201 | 204 | 409 => {
                tracing::info!(org_id = %org_id, user_id = %keycloak_user_id, "Added org member");
                Ok(())
            }
            status => {
                let b = resp.text().await.unwrap_or_default();
                Err(format!("Keycloak add org member returned {status}: {b}"))
            }
        }
    }

    /// Invite a person to the workspace's organization by **email** — the native
    /// Keycloak Organization invitation. Keycloak emails a registration link (or a
    /// confirm-membership link if the email already has an account); on accept the
    /// person is added to the org as a member. The owner/member client role is NOT
    /// assigned here — the tenant server grants it on first login. Requires the
    /// service account to hold the `manage-organizations` realm-management role and
    /// SMTP configured on the realm. The endpoint takes form-urlencoded `email` and
    /// returns 204; 200 is also treated as success.
    pub async fn invite_user_to_org(&self, org_id: &str, email: &str) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations/{}/members/invite-user",
            self.base_url, self.realm, org_id
        );
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&token)
            .form(&[("email", email)])
            .send()
            .await
            .map_err(|e| format!("Keycloak invite user to org failed: {e}"))?;
        match resp.status().as_u16() {
            200 | 204 => {
                tracing::info!(org_id = %org_id, email = %email, "Invited user to org");
                Ok(())
            }
            // Already a member — the invitation is a no-op (keeps reconcile, which
            // re-ensures every tenant, from failing on already-onboarded owners).
            409 => {
                tracing::debug!(org_id = %org_id, email = %email, "User already an org member");
                Ok(())
            }
            status => {
                let b = resp.text().await.unwrap_or_default();
                Err(format!("Keycloak invite user to org returned {status}: {b}"))
            }
        }
    }

    /// Remove a user from the workspace's organization. Idempotent (404 ok).
    pub async fn remove_org_member(
        &self,
        org_id: &str,
        keycloak_user_id: &str,
    ) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations/{}/members/{}",
            self.base_url, self.realm, org_id, keycloak_user_id
        );
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak remove org member failed: {e}"))?;
        if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(())
        } else {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            Err(format!("Keycloak remove org member returned {status}: {b}"))
        }
    }

    /// List the members of the workspace's organization. Every member defaults
    /// to role `"member"`; the route upgrades owners by intersecting with the
    /// `owner` client-role holders.
    pub async fn list_org_members(&self, org_id: &str) -> Result<Vec<WorkspaceMember>, String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/organizations/{}/members?max=1000",
            self.base_url, self.realm, org_id
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak list org members failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak list org members returned {status}: {b}"));
        }
        let users: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse org members: {e}"))?;
        Ok(users
            .into_iter()
            .filter_map(|u| {
                let user_id = u.get("id").and_then(|v| v.as_str())?.to_string();
                Some(WorkspaceMember {
                    user_id,
                    role: "member".to_string(),
                    email: u.get("email").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    first_name: u.get("firstName").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    last_name: u.get("lastName").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    created_timestamp: u.get("createdTimestamp").and_then(|v| v.as_i64()),
                })
            })
            .collect())
    }

    /// List the workspaces (organizations) a user belongs to — the native
    /// "my workspaces" query. Each org carries its display `name` and home URL
    /// (the `keasy.url` attribute).
    pub async fn list_user_organizations(
        &self,
        keycloak_user_id: &str,
    ) -> Result<Vec<Workspace>, String> {
        let token = self.get_admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/users/{}/organizations",
            self.base_url, self.realm, keycloak_user_id
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak list user organizations failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("Keycloak list user organizations returned {status}: {b}"));
        }
        let orgs: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse user organizations: {e}"))?;
        Ok(orgs
            .into_iter()
            .filter_map(|o| {
                let id = o.get("id").and_then(|v| v.as_str())?.to_string();
                let name = o.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let url = o
                    .get("attributes")
                    .and_then(|a| a.get("keasy.url"))
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                Some(Workspace { id, name, url })
            })
            .collect())
    }

    /// Ensure the `owner` and `member` client roles exist on the workspace
    /// client. These are the two hierarchical roles (owner ⊇ member) that drive
    /// authorization. Idempotent: a 409 (role already exists) is treated as
    /// success.
    ///
    /// `client_id` is the OIDC clientId string (e.g. "keasy-ws-{uuid}").
    pub async fn ensure_client_roles(&self, client_id: &str) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let client_uuid = self.lookup_client_uuid(&token, client_id).await?;

        let roles_url = format!(
            "{}/admin/realms/{}/clients/{}/roles",
            self.base_url, self.realm, client_uuid
        );

        for role in ["owner", "member"] {
            let resp = self
                .http
                .post(&roles_url)
                .bearer_auth(&token)
                .json(&serde_json::json!({ "name": role }))
                .send()
                .await
                .map_err(|e| format!("Keycloak create client role failed: {e}"))?;

            match resp.status().as_u16() {
                201 | 409 => {}
                status => {
                    let body = resp.text().await.unwrap_or_default();
                    return Err(format!(
                        "Keycloak create client role '{role}' returned {status}: {body}"
                    ));
                }
            }
        }

        tracing::info!(client_id = %client_id, "Ensured owner/member client roles in Keycloak");
        Ok(())
    }

    /// Ensure the `keasy:role` protocol mapper exists on the specified client.
    ///
    /// Maps the user's client roles *for this client* into a multivalued
    /// `keasy:role` ID token claim. The `usermodel.clientRoleMapping.clientId`
    /// restriction is critical: without it Keycloak would emit the user's roles
    /// across *all* clients, leaking other workspaces' roles into the token.
    /// Idempotent: a 409 (mapper already exists) is treated as success.
    ///
    /// `client_id` is the OIDC clientId string (e.g. "keasy-ws-{uuid}").
    pub async fn ensure_role_mapper(&self, client_id: &str) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let client_uuid = self.lookup_client_uuid(&token, client_id).await?;

        let mapper_url = format!(
            "{}/admin/realms/{}/clients/{}/protocol-mappers/models",
            self.base_url, self.realm, client_uuid
        );

        let mapper_body = serde_json::json!({
            "name": "keasy-role",
            "protocol": "openid-connect",
            "protocolMapper": "oidc-usermodel-client-role-mapper",
            "config": {
                "usermodel.clientRoleMapping.clientId": client_id,
                "claim.name": "keasy:role",
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
            .map_err(|e| format!("Keycloak role mapper creation failed: {e}"))?;

        match resp.status().as_u16() {
            201 => {
                tracing::info!("Created keasy:role protocol mapper in Keycloak");
                Ok(())
            }
            409 => {
                tracing::debug!("keasy:role protocol mapper already exists");
                Ok(())
            }
            status => {
                let body = resp.text().await.unwrap_or_default();
                Err(format!(
                    "Keycloak role mapper creation returned {status}: {body}"
                ))
            }
        }
    }

    /// Assign a client role (`owner` or `member`) to a user on the workspace
    /// client. Used by the control-plane to grant the owner role at
    /// provisioning, and by the server to grant `member` when an invite is
    /// accepted. Posting an existing mapping is idempotent in Keycloak.
    ///
    /// `client_id` is the OIDC clientId string (e.g. "keasy-ws-{uuid}").
    pub async fn assign_client_role(
        &self,
        keycloak_user_id: &str,
        client_id: &str,
        role_name: &str,
    ) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let client_uuid = self.lookup_client_uuid(&token, client_id).await?;

        // Fetch the role representation (Keycloak requires id + name to map it).
        let role_url = format!(
            "{}/admin/realms/{}/clients/{}/roles/{}",
            self.base_url, self.realm, client_uuid, role_name
        );
        let resp = self
            .http
            .get(&role_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak get client role failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Keycloak get client role '{role_name}' returned {status}: {body}"
            ));
        }

        let role: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak role response: {e}"))?;

        // POST the role-mapping to the user's client role mappings.
        let mapping_url = format!(
            "{}/admin/realms/{}/users/{}/role-mappings/clients/{}",
            self.base_url, self.realm, keycloak_user_id, client_uuid
        );
        let resp = self
            .http
            .post(&mapping_url)
            .bearer_auth(&token)
            .json(&serde_json::json!([role]))
            .send()
            .await
            .map_err(|e| format!("Keycloak assign client role failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Keycloak assign client role returned {status}: {body}"
            ));
        }

        tracing::info!(
            user_id = %keycloak_user_id,
            client_id = %client_id,
            role = %role_name,
            "Assigned client role to Keycloak user"
        );
        Ok(())
    }

    /// List the user ids holding a given client role (`owner`/`member`) on the
    /// workspace client. Used to mark which organization members are owners.
    ///
    /// `client_id` is the OIDC clientId string (e.g. "keasy-ws-{uuid}").
    pub async fn list_client_role_users(
        &self,
        client_id: &str,
        role_name: &str,
    ) -> Result<Vec<String>, String> {
        let token = self.get_admin_token().await?;
        let client_uuid = self.lookup_client_uuid(&token, client_id).await?;

        let url = format!(
            "{}/admin/realms/{}/clients/{}/roles/{}/users?max=1000",
            self.base_url, self.realm, client_uuid, role_name
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak list role users failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Keycloak list role '{role_name}' users returned {status}: {body}"
            ));
        }

        let users: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak role users response: {e}"))?;

        Ok(users
            .into_iter()
            .filter_map(|u| u.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect())
    }

    /// Drop all of a user's client-role mappings (`owner`/`member`) on the
    /// workspace client — the authorization half of removing a member. Org
    /// membership is removed separately via `remove_org_member`. Idempotent.
    ///
    /// `client_id` is the OIDC clientId string (e.g. "keasy-ws-{uuid}").
    pub async fn remove_client_roles(
        &self,
        keycloak_user_id: &str,
        client_id: &str,
    ) -> Result<(), String> {
        let token = self.get_admin_token().await?;
        let client_uuid = self.lookup_client_uuid(&token, client_id).await?;

        let mapping_url = format!(
            "{}/admin/realms/{}/users/{}/role-mappings/clients/{}",
            self.base_url, self.realm, keycloak_user_id, client_uuid
        );
        let resp = self
            .http
            .get(&mapping_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Keycloak get user client roles failed: {e}"))?;

        if resp.status().is_success() {
            let roles: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse user client roles: {e}"))?;
            if roles.as_array().is_some_and(|a| !a.is_empty()) {
                let del = self
                    .http
                    .delete(&mapping_url)
                    .bearer_auth(&token)
                    .json(&roles)
                    .send()
                    .await
                    .map_err(|e| format!("Keycloak delete user client roles failed: {e}"))?;
                if !del.status().is_success() {
                    let status = del.status();
                    let body = del.text().await.unwrap_or_default();
                    return Err(format!(
                        "Keycloak delete client roles returned {status}: {body}"
                    ));
                }
            }
        }
        Ok(())
    }

    /// Resolve a clientId string to its Keycloak-internal UUID. Shared by all
    /// client-scoped admin operations (mappers, roles, role assignment).
    async fn lookup_client_uuid(&self, token: &str, client_id: &str) -> Result<String, String> {
        let clients_url = format!(
            "{}/admin/realms/{}/clients?clientId={}",
            self.base_url, self.realm, client_id
        );
        let resp = self
            .http
            .get(&clients_url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Keycloak client lookup failed: {e}"))?;

        let clients: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Keycloak clients response: {e}"))?;

        clients
            .first()
            .and_then(|c| c["id"].as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Client '{}' not found in Keycloak", client_id))
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

/// Parse a Keycloak `attributes` object (`{ key: [values] }`) from an org/user
/// representation into a plain `HashMap<String, Vec<String>>`.
fn parse_attributes(rep: &serde_json::Value) -> HashMap<String, Vec<String>> {
    rep.get("attributes")
        .and_then(|a| a.as_object())
        .map(|map| {
            map.iter()
                .map(|(k, v)| {
                    let values = v
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    (k.clone(), values)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Extract the bare host from a URL for use as an organization domain
/// (`https://acme.keasy.tech/x` → `acme.keasy.tech`, `http://localhost:3000` → `localhost`).
fn host_of(url: &str) -> String {
    url.trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_string()
}
