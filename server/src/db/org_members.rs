use std::fmt;

use diesel::prelude::*;

use crate::db::diesel_schema::org_members;
use super::Repos;

/// Role of a user within their organization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberRole {
    Admin,
    User,
}

impl MemberRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemberRole::Admin => "admin",
            MemberRole::User => "user",
        }
    }
}

impl std::str::FromStr for MemberRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "admin" => Ok(MemberRole::Admin),
            "user" => Ok(MemberRole::User),
            other => Err(format!("invalid role: '{other}', expected 'admin' or 'user'")),
        }
    }
}

impl fmt::Display for MemberRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An org member — a Keycloak user's membership in a Keasy organization.
/// Profile fields (email, first_name, last_name) are cached from OIDC tokens.
#[derive(Debug, Clone, serde::Serialize, Queryable, Selectable, Insertable, utoipa::ToSchema)]
#[diesel(table_name = org_members)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct OrgMember {
    pub user_id: String,
    pub org_id: String,
    pub role: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub joined_at: String,
}

use org_members::dsl;

impl Repos {
    /// Upsert an org membership when a user accepts an invite.
    /// Creates or updates the row for (user_id, org_id), setting role and profile fields.
    pub async fn upsert_org_member(
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
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(dsl::org_members)
                    .values(&member)
                    .on_conflict((dsl::user_id, dsl::org_id))
                    .do_update()
                    .set((
                        dsl::role.eq(&member.role),
                        dsl::email.eq(&member.email),
                        dsl::first_name.eq(&member.first_name),
                        dsl::last_name.eq(&member.last_name),
                    ))
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to upsert org member: {e}"))?;
        Ok(())
    }

    /// Update cached profile fields for all orgs a user belongs to.
    /// Called on every OIDC login so profile changes from Keycloak propagate.
    pub async fn sync_member_profile(
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
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::update(dsl::org_members.filter(dsl::user_id.eq(&user_id)))
                    .set((
                        dsl::email.eq(&email),
                        dsl::first_name.eq(&first_name),
                        dsl::last_name.eq(&last_name),
                    ))
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to sync member profile: {e}"))?;
        Ok(())
    }

    /// Get the org membership for a user (single-org model — returns first match).
    pub async fn get_org_membership(&self, user_id: &str) -> Option<OrgMember> {
        let user_id = user_id.to_string();
        self.diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                dsl::org_members
                    .filter(dsl::user_id.eq(&user_id))
                    .select(OrgMember::as_select())
                    .first::<OrgMember>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    /// List all members in an organization.
    pub async fn list_org_members(&self, org_id: &str) -> Vec<OrgMember> {
        let org_id = org_id.to_string();
        let Ok(pc) = self.diesel_pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(move |conn| {
                dsl::org_members
                    .filter(dsl::org_id.eq(&org_id))
                    .order(dsl::email.asc())
                    .select(OrgMember::as_select())
                    .load::<OrgMember>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    /// Update a member's role within their organization.
    pub async fn update_member_role(
        &self,
        user_id: &str,
        org_id: &str,
        new_role: &str,
    ) -> Result<(), String> {
        let user_id = user_id.to_string();
        let org_id = org_id.to_string();
        let new_role = new_role.to_string();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::update(
                    dsl::org_members.filter(dsl::user_id.eq(&user_id).and(dsl::org_id.eq(&org_id))),
                )
                .set(dsl::role.eq(&new_role))
                .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to update member role: {e}"))?;
        Ok(())
    }

    /// Remove a user from an organization.
    pub async fn remove_org_member(&self, user_id: &str, org_id: &str) -> Result<(), String> {
        let user_id = user_id.to_string();
        let org_id = org_id.to_string();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::delete(
                    dsl::org_members.filter(dsl::user_id.eq(&user_id).and(dsl::org_id.eq(&org_id))),
                )
                .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to remove org member: {e}"))?;
        Ok(())
    }
}
