use async_trait::async_trait;

use crate::org::models::{InviteToken, OrgMember, Organization};

/// Repository trait for the org domain (organizations + members + invites).
#[async_trait]
pub trait OrgRepository: Send + Sync {
    // ── Organizations ───────────────────────────────────────────────────────
    async fn create_organization(&self, org: &Organization) -> Result<(), String>;
    async fn get_organization(&self, id: &str) -> Option<Organization>;
    async fn list_organizations(&self) -> Vec<Organization>;
    async fn get_organization_by_slug(&self, slug: &str) -> Option<Organization>;
    async fn generate_unique_slug(&self, name: &str) -> String;
    async fn update_org_identity(
        &self,
        org_id: &str,
        legal_name: &str,
        country: &str,
        registration_number: Option<&str>,
        country_subdivision_code: Option<&str>,
        registration_number_type: Option<&str>,
    ) -> Result<(), String>;

    // ── Members ─────────────────────────────────────────────────────────────
    async fn upsert_org_member(
        &self,
        user_id: &str,
        org_id: &str,
        role: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String>;
    async fn sync_member_profile(
        &self,
        user_id: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String>;
    async fn get_org_membership(&self, user_id: &str) -> Option<OrgMember>;
    async fn list_org_members(&self, org_id: &str) -> Vec<OrgMember>;
    async fn update_member_role(
        &self,
        user_id: &str,
        org_id: &str,
        new_role: &str,
    ) -> Result<(), String>;
    async fn remove_org_member(&self, user_id: &str, org_id: &str) -> Result<(), String>;

    // ── Invites ─────────────────────────────────────────────────────────────
    async fn get_invite_token(&self, token: &str) -> Option<InviteToken>;
    async fn list_invite_tokens(&self) -> Vec<InviteToken>;
    async fn list_invite_tokens_for_org(&self, org_id: &str) -> Vec<InviteToken>;
    async fn create_invite_token(&self, token: &InviteToken) -> Result<(), String>;
    async fn delete_invite_token(&self, token: &str) -> Result<(), String>;

    // ── Sessions ────────────────────────────────────────────────────────────
    async fn upsert_user_session(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<Option<String>, String>;
    async fn delete_user_session(&self, user_id: &str) -> Result<(), String>;
    async fn get_user_session_id(&self, user_id: &str) -> Option<String>;
}
