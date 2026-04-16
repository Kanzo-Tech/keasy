use std::collections::HashMap;
use std::sync::Arc;

use crate::error::AppError;
use crate::org::models::{InviteToken, MemberRole, Organization};
use crate::org::repository::OrgRepository;

#[derive(Clone)]
pub struct OrgService {
    pub repo: Arc<dyn OrgRepository>,
}

impl OrgService {
    pub fn new(repo: Arc<dyn OrgRepository>) -> Self {
        Self { repo }
    }

    // ── Org identity ────────────────────────────────────────────────────────

    pub async fn update_org_identity(
        &self,
        org_id: &str,
        legal_name: &str,
        country: &str,
        registration_number: Option<&str>,
        country_subdivision_code: Option<&str>,
        registration_number_type: Option<&str>,
    ) -> Result<(), AppError> {
        self.repo
            .update_org_identity(
                org_id,
                legal_name,
                country,
                registration_number,
                country_subdivision_code,
                registration_number_type,
            )
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("failed to update org identity: {e}")))
    }

    // ── Member management ───────────────────────────────────────────────────

    pub async fn update_member_role(
        &self,
        user_id: &str,
        org_id: &str,
        role_str: &str,
    ) -> Result<(), AppError> {
        let role: MemberRole = role_str
            .parse()
            .map_err(|msg: String| AppError::Internal(anyhow::anyhow!(msg)))?;
        self.repo
            .update_member_role(user_id, org_id, role.as_str())
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))
    }

    pub async fn remove_member(&self, user_id: &str, org_id: &str) -> Result<(), AppError> {
        self.repo
            .remove_org_member(user_id, org_id)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))
    }

    // ── Org invite management ───────────────────────────────────────────────

    pub async fn create_org_invite(
        &self,
        org_id: &str,
        role_str: &str,
        created_by: &str,
    ) -> Result<(String, InviteToken), AppError> {
        let role: MemberRole = role_str
            .parse()
            .map_err(|msg: String| AppError::Internal(anyhow::anyhow!(msg)))?;

        let now = jiff::Timestamp::now().to_string();
        let token_value = uuid::Uuid::new_v4().to_string();
        let expires_at = {
            let ts = jiff::Timestamp::now();
            ts.checked_add(jiff::SignedDuration::from_hours(7 * 24))
                .unwrap_or(ts)
                .to_string()
        };

        let invite = InviteToken {
            token: token_value.clone(),
            org_id: org_id.to_string(),
            role: role.as_str().to_string(),
            created_by: created_by.to_string(),
            expires_at,
            created_at: now,
        };
        self.repo
            .create_invite_token(&invite)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;

        Ok((token_value, invite))
    }

    pub async fn revoke_org_invite(
        &self,
        token: &str,
        org_id: &str,
    ) -> Result<(), AppError> {
        let invite = self
            .repo
            .get_invite_token(token)
            .await
            .ok_or(AppError::NotFound)?;
        if invite.org_id != org_id {
            return Err(AppError::NotFound);
        }
        self.repo
            .delete_invite_token(token)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))
    }

    // ── Admin: create org + invite ──────────────────────────────────────────

    pub async fn create_org_and_invite(
        &self,
        name: &str,
        created_by: &str,
    ) -> Result<(Organization, String), AppError> {
        let now = jiff::Timestamp::now().to_string();

        let slug = self.repo.generate_unique_slug(name).await;
        let org = Organization {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            slug,
            legal_name: name.to_string(),
            registration_number: None,
            country_subdivision_code: None,
            registration_number_type: None,
            country: "EU".to_string(),
            role: "participant".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        self.repo
            .create_organization(&org)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;

        let token_value = uuid::Uuid::new_v4().to_string();
        let expires_at = {
            let ts = jiff::Timestamp::now();
            ts.checked_add(jiff::SignedDuration::from_hours(7 * 24))
                .unwrap_or(ts)
                .to_string()
        };
        let invite = InviteToken {
            token: token_value.clone(),
            org_id: org.id.clone(),
            role: "admin".to_string(),
            created_by: created_by.to_string(),
            expires_at,
            created_at: now,
        };
        self.repo
            .create_invite_token(&invite)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;

        Ok((org, token_value))
    }

    // ── Admin: list invites with org names ──────────────────────────────────

    pub async fn list_admin_invites(&self) -> (Vec<InviteToken>, HashMap<String, String>) {
        let tokens = self.repo.list_invite_tokens().await;
        let orgs = self.repo.list_organizations().await;
        let org_map: HashMap<String, String> = orgs
            .into_iter()
            .map(|o| (o.id.clone(), o.name.clone()))
            .collect();
        (tokens, org_map)
    }

    // ── Admin: revoke invite (no org ownership check) ───────────────────────

    pub async fn admin_revoke_invite(&self, token: &str) -> Result<(), AppError> {
        self.repo
            .delete_invite_token(token)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))
    }
}
