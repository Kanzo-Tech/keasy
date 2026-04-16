use async_trait::async_trait;
use diesel::prelude::*;

use crate::db::{DbPool, Repos};
use crate::db::diesel_schema::{invite_tokens, org_members, organizations, user_sessions};
use crate::org::models::{
    generate_slug, InviteToken, OrgIdentityChangeset, OrgMember, Organization,
};
use crate::org::repository::OrgRepository;

use invite_tokens::dsl as it_dsl;
use org_members::dsl as om_dsl;
use organizations::dsl as org_dsl;
use user_sessions::dsl as us_dsl;

#[derive(Clone)]
pub struct DieselOrgRepo {
    pool: DbPool,
}

impl DieselOrgRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl OrgRepository for DieselOrgRepo {
    // ── Organizations ───────────────────────────────────────────────────────

    async fn create_organization(&self, org: &Organization) -> Result<(), String> {
        let org = org.clone();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(org_dsl::organizations)
                    .values(&org)
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to insert organization: {e}"))?;
        Ok(())
    }

    async fn get_organization(&self, id: &str) -> Option<Organization> {
        let id = id.to_string();
        self.pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                org_dsl::organizations
                    .filter(org_dsl::id.eq(&id))
                    .select(Organization::as_select())
                    .first::<Organization>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    async fn list_organizations(&self) -> Vec<Organization> {
        let Ok(pc) = self.pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(|conn| {
                org_dsl::organizations
                    .order(org_dsl::name.asc())
                    .select(Organization::as_select())
                    .load::<Organization>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    async fn get_organization_by_slug(&self, slug: &str) -> Option<Organization> {
        let slug = slug.to_string();
        self.pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                org_dsl::organizations
                    .filter(org_dsl::slug.eq(&slug))
                    .select(Organization::as_select())
                    .first::<Organization>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    async fn generate_unique_slug(&self, name: &str) -> String {
        let base = generate_slug(name);
        let base_clone = base.clone();
        let Ok(pc) = self.pool.get().await else {
            return base;
        };
        let result = pc
            .interact(move |conn| {
                let exists = org_dsl::organizations
                    .filter(org_dsl::slug.eq(&base_clone))
                    .select(org_dsl::id)
                    .first::<String>(conn)
                    .optional()
                    .unwrap_or(None)
                    .is_some();
                if !exists {
                    return base_clone;
                }
                for i in 2..100 {
                    let candidate = format!("{}-{}", base_clone, i);
                    let exists = org_dsl::organizations
                        .filter(org_dsl::slug.eq(&candidate))
                        .select(org_dsl::id)
                        .first::<String>(conn)
                        .optional()
                        .unwrap_or(None)
                        .is_some();
                    if !exists {
                        return candidate;
                    }
                }
                format!(
                    "{}-{}",
                    base_clone,
                    uuid::Uuid::new_v4()
                        .to_string()
                        .split('-')
                        .next()
                        .unwrap()
                )
            })
            .await;
        match result {
            Ok(slug) => slug,
            Err(_) => base,
        }
    }

    async fn update_org_identity(
        &self,
        org_id: &str,
        legal_name: &str,
        country: &str,
        registration_number: Option<&str>,
        country_subdivision_code: Option<&str>,
        registration_number_type: Option<&str>,
    ) -> Result<(), String> {
        let changeset = OrgIdentityChangeset {
            legal_name: legal_name.to_string(),
            country: country.to_string(),
            registration_number: registration_number.map(String::from),
            country_subdivision_code: country_subdivision_code.map(String::from),
            registration_number_type: registration_number_type.map(String::from),
            updated_at: jiff::Timestamp::now().to_string(),
        };
        let org_id = org_id.to_string();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::update(org_dsl::organizations.filter(org_dsl::id.eq(&org_id)))
                    .set(&changeset)
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("update: {e}"))?;
        Ok(())
    }

    // ── Members ─────────────────────────────────────────────────────────────

    async fn upsert_org_member(
        &self,
        user_id: &str,
        org_id: &str,
        role: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let member = OrgMember {
            user_id: user_id.to_string(),
            org_id: org_id.to_string(),
            role: role.to_string(),
            email: email.to_string(),
            first_name: first_name.to_string(),
            last_name: last_name.to_string(),
            joined_at: now,
        };
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(om_dsl::org_members)
                    .values(&member)
                    .on_conflict((om_dsl::user_id, om_dsl::org_id))
                    .do_update()
                    .set((
                        om_dsl::role.eq(&member.role),
                        om_dsl::email.eq(&member.email),
                        om_dsl::first_name.eq(&member.first_name),
                        om_dsl::last_name.eq(&member.last_name),
                    ))
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to upsert org member: {e}"))?;
        Ok(())
    }

    async fn sync_member_profile(
        &self,
        user_id: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String> {
        let user_id = user_id.to_string();
        let email = email.to_string();
        let first_name = first_name.to_string();
        let last_name = last_name.to_string();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::update(om_dsl::org_members.filter(om_dsl::user_id.eq(&user_id)))
                    .set((
                        om_dsl::email.eq(&email),
                        om_dsl::first_name.eq(&first_name),
                        om_dsl::last_name.eq(&last_name),
                    ))
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to sync member profile: {e}"))?;
        Ok(())
    }

    async fn get_org_membership(&self, user_id: &str) -> Option<OrgMember> {
        let user_id = user_id.to_string();
        self.pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                om_dsl::org_members
                    .filter(om_dsl::user_id.eq(&user_id))
                    .select(OrgMember::as_select())
                    .first::<OrgMember>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    async fn list_org_members(&self, org_id: &str) -> Vec<OrgMember> {
        let org_id = org_id.to_string();
        let Ok(pc) = self.pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(move |conn| {
                om_dsl::org_members
                    .filter(om_dsl::org_id.eq(&org_id))
                    .order(om_dsl::email.asc())
                    .select(OrgMember::as_select())
                    .load::<OrgMember>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    async fn update_member_role(
        &self,
        user_id: &str,
        org_id: &str,
        new_role: &str,
    ) -> Result<(), String> {
        let user_id = user_id.to_string();
        let org_id = org_id.to_string();
        let new_role = new_role.to_string();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::update(
                    om_dsl::org_members
                        .filter(om_dsl::user_id.eq(&user_id).and(om_dsl::org_id.eq(&org_id))),
                )
                .set(om_dsl::role.eq(&new_role))
                .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to update member role: {e}"))?;
        Ok(())
    }

    async fn remove_org_member(&self, user_id: &str, org_id: &str) -> Result<(), String> {
        let user_id = user_id.to_string();
        let org_id = org_id.to_string();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::delete(
                    om_dsl::org_members
                        .filter(om_dsl::user_id.eq(&user_id).and(om_dsl::org_id.eq(&org_id))),
                )
                .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to remove org member: {e}"))?;
        Ok(())
    }

    // ── Invites ─────────────────────────────────────────────────────────────

    async fn get_invite_token(&self, token: &str) -> Option<InviteToken> {
        let token = token.to_string();
        self.pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                it_dsl::invite_tokens
                    .filter(it_dsl::token.eq(&token))
                    .select(InviteToken::as_select())
                    .first::<InviteToken>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    async fn list_invite_tokens(&self) -> Vec<InviteToken> {
        let Ok(pc) = self.pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(|conn| {
                it_dsl::invite_tokens
                    .order(it_dsl::created_at.desc())
                    .select(InviteToken::as_select())
                    .load::<InviteToken>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    async fn list_invite_tokens_for_org(&self, org_id: &str) -> Vec<InviteToken> {
        let org_id = org_id.to_string();
        let Ok(pc) = self.pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(move |conn| {
                it_dsl::invite_tokens
                    .filter(it_dsl::org_id.eq(&org_id))
                    .order(it_dsl::created_at.desc())
                    .select(InviteToken::as_select())
                    .load::<InviteToken>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    async fn create_invite_token(&self, token: &InviteToken) -> Result<(), String> {
        let token = token.clone();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(it_dsl::invite_tokens)
                    .values(&token)
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to insert invite token: {e}"))?;
        Ok(())
    }

    async fn delete_invite_token(&self, token: &str) -> Result<(), String> {
        let token = token.to_string();
        let affected = self
            .pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::delete(it_dsl::invite_tokens.filter(it_dsl::token.eq(&token))).execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to delete invite token: {e}"))?;
        if affected == 0 {
            return Err("invite token not found".to_string());
        }
        Ok(())
    }

    // ── Sessions ────────────────────────────────────────────────────────────

    async fn upsert_user_session(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<Option<String>, String> {
        let now = jiff::Timestamp::now().to_string();
        let user_id = user_id.to_string();
        let session_id = session_id.to_string();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                let old_session_id: Option<String> = us_dsl::user_sessions
                    .filter(us_dsl::user_id.eq(&user_id))
                    .select(us_dsl::session_id)
                    .first::<String>(conn)
                    .optional()
                    .map_err(|e| format!("query old session: {e}"))?;

                diesel::replace_into(us_dsl::user_sessions)
                    .values((
                        us_dsl::user_id.eq(&user_id),
                        us_dsl::session_id.eq(&session_id),
                        us_dsl::created_at.eq(&now),
                    ))
                    .execute(conn)
                    .map_err(|e| format!("failed to upsert user session: {e}"))?;

                Ok(old_session_id)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
    }

    async fn delete_user_session(&self, user_id: &str) -> Result<(), String> {
        let user_id = user_id.to_string();
        self.pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::delete(us_dsl::user_sessions.filter(us_dsl::user_id.eq(&user_id)))
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to delete user session: {e}"))?;
        Ok(())
    }

    async fn get_user_session_id(&self, user_id: &str) -> Option<String> {
        let user_id = user_id.to_string();
        self.pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                us_dsl::user_sessions
                    .filter(us_dsl::user_id.eq(&user_id))
                    .select(us_dsl::session_id)
                    .first::<String>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }
}

// ── impl Repos (delegation for cross-module callers: auth, middleware, gaia_x, jobs) ──

impl Repos {
    fn org_repo(&self) -> DieselOrgRepo {
        DieselOrgRepo::new(self.diesel_pool.clone())
    }

    pub async fn get_organization(&self, id: &str) -> Option<Organization> {
        self.org_repo().get_organization(id).await
    }

    pub async fn get_organization_by_slug(&self, slug: &str) -> Option<Organization> {
        self.org_repo().get_organization_by_slug(slug).await
    }

    pub async fn get_org_membership(&self, user_id: &str) -> Option<OrgMember> {
        self.org_repo().get_org_membership(user_id).await
    }

    pub async fn get_invite_token(&self, token: &str) -> Option<InviteToken> {
        self.org_repo().get_invite_token(token).await
    }

    pub async fn upsert_user_session(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<Option<String>, String> {
        self.org_repo().upsert_user_session(user_id, session_id).await
    }

    pub async fn delete_user_session(&self, user_id: &str) -> Result<(), String> {
        self.org_repo().delete_user_session(user_id).await
    }

    pub async fn get_user_session_id(&self, user_id: &str) -> Option<String> {
        self.org_repo().get_user_session_id(user_id).await
    }

    pub async fn upsert_org_member(
        &self,
        user_id: &str,
        org_id: &str,
        role: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String> {
        self.org_repo().upsert_org_member(user_id, org_id, role, email, first_name, last_name).await
    }

    pub async fn sync_member_profile(
        &self,
        user_id: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String> {
        self.org_repo().sync_member_profile(user_id, email, first_name, last_name).await
    }
}
