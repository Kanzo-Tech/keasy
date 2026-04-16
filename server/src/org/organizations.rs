use diesel::prelude::*;

use crate::db::diesel_schema::organizations;
use crate::db::Repos;

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
struct OrgIdentityChangeset {
    legal_name: String,
    country: String,
    registration_number: Option<String>,
    country_subdivision_code: Option<String>,
    registration_number_type: Option<String>,
    updated_at: String,
}

use organizations::dsl;

impl Repos {
    pub async fn create_organization(&self, org: &Organization) -> Result<(), String> {
        let org = org.clone();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(dsl::organizations)
                    .values(&org)
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to insert organization: {e}"))?;
        Ok(())
    }

    pub async fn get_organization(&self, id: &str) -> Option<Organization> {
        let id = id.to_string();
        self.diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                dsl::organizations
                    .filter(dsl::id.eq(&id))
                    .select(Organization::as_select())
                    .first::<Organization>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    /// Update an organization's identity fields.
    pub async fn update_org_identity(
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
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::update(dsl::organizations.filter(dsl::id.eq(&org_id)))
                    .set(&changeset)
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("update: {e}"))?;
        Ok(())
    }

    pub async fn list_organizations(&self) -> Vec<Organization> {
        let Ok(pc) = self.diesel_pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(|conn| {
                dsl::organizations
                    .order(dsl::name.asc())
                    .select(Organization::as_select())
                    .load::<Organization>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    pub async fn get_organization_by_slug(&self, slug: &str) -> Option<Organization> {
        let slug = slug.to_string();
        self.diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                dsl::organizations
                    .filter(dsl::slug.eq(&slug))
                    .select(Organization::as_select())
                    .first::<Organization>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    /// Generate a unique slug using the diesel pool, appending a numeric suffix if the base slug is taken.
    pub async fn generate_unique_slug(&self, name: &str) -> String {
        let base = generate_slug(name);
        let base_clone = base.clone();
        let Ok(pc) = self.diesel_pool.get().await else {
            return base;
        };
        let result = pc
            .interact(move |conn| {
                // Check if base slug exists
                let exists = dsl::organizations
                    .filter(dsl::slug.eq(&base_clone))
                    .select(dsl::id)
                    .first::<String>(conn)
                    .optional()
                    .unwrap_or(None)
                    .is_some();
                if !exists {
                    return base_clone;
                }
                for i in 2..100 {
                    let candidate = format!("{}-{}", base_clone, i);
                    let exists = dsl::organizations
                        .filter(dsl::slug.eq(&candidate))
                        .select(dsl::id)
                        .first::<String>(conn)
                        .optional()
                        .unwrap_or(None)
                        .is_some();
                    if !exists {
                        return candidate;
                    }
                }
                // Fallback: random suffix
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
}

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
