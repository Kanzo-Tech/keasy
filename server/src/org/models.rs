use diesel::prelude::*;

use crate::db::diesel_schema::{invite_tokens, org_members, organizations};

// ── Organization ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, Queryable, Selectable, Insertable, utoipa::ToSchema)]
#[diesel(table_name = organizations)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub legal_name: String,
    pub registration_number: Option<String>,
    pub country_subdivision_code: Option<String>,
    pub registration_number_type: Option<String>,
    pub country: String,
    pub role: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = organizations)]
pub(crate) struct OrgIdentityChangeset {
    pub legal_name: String,
    pub country: String,
    pub registration_number: Option<String>,
    pub country_subdivision_code: Option<String>,
    pub registration_number_type: Option<String>,
    pub updated_at: String,
}

// ── OrgMember ───────────────────────────────────────────────────────────────

/// Role of a user within their organization.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
)]
#[strum(serialize_all = "snake_case")]
pub enum MemberRole {
    Admin,
    User,
}

/// An org member -- a Keycloak user's membership in a Keasy organization.
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

// ── InviteToken ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, Queryable, Selectable, Insertable, utoipa::ToSchema)]
#[diesel(table_name = invite_tokens)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct InviteToken {
    pub token: String,
    pub org_id: String,
    pub role: String,
    pub created_by: String,
    pub expires_at: String,
    pub created_at: String,
}

// ── Slug generation ─────────────────────────────────────────────────────────

/// Generate a URL-safe slug from an organization name.
/// Lowercase, only [a-z0-9-], max 63 chars, no leading/trailing hyphens.
pub fn generate_slug(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let truncated = if slug.len() > 63 { &slug[..63] } else { &slug };
    truncated.trim_end_matches('-').to_string()
}
