use async_trait::async_trait;
use diesel::prelude::*;

use crate::db::diesel_schema::org_gaiax;
use crate::db::Repos;
use crate::gaia_x::GaiaxState;

use super::repository::GaiaXRepository;

// ── Diesel models ──────────────────────────────────────────────────

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = org_gaiax)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct OrgGaiax {
    pub org_id: String,
    pub domain: Option<String>,
    pub public_key_jwk: Option<String>,
    pub cert_chain_pem: Option<String>,
    pub lrn_type: Option<String>,
    pub lrn_value: Option<String>,
    pub lrn_vc: Option<String>,
    pub lp_vc: Option<String>,
    pub tandc_vc: Option<String>,
    pub compliance_vc: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Insertable, AsChangeset)]
#[diesel(table_name = org_gaiax)]
pub struct UpsertOrgGaiax {
    pub org_id: String,
    pub domain: Option<String>,
    pub public_key_jwk: Option<String>,
    pub cert_chain_pem: Option<String>,
    pub root_ca_pem: Option<String>,
    pub lrn_type: Option<String>,
    pub lrn_value: Option<String>,
    pub lrn_vc: Option<String>,
    pub lp_vc: Option<String>,
    pub tandc_vc: Option<String>,
    pub compliance_vc: Option<String>,
    pub wizard_step: i32,
    pub updated_at: String,
}

use org_gaiax::dsl;

fn get_org_gaiax(
    conn: &mut diesel::SqliteConnection,
    org_id: &str,
) -> Result<Option<OrgGaiax>, diesel::result::Error> {
    dsl::org_gaiax
        .filter(dsl::org_id.eq(org_id))
        .select(OrgGaiax::as_select())
        .first::<OrgGaiax>(conn)
        .optional()
}

fn upsert_org_gaiax(
    conn: &mut diesel::SqliteConnection,
    g: &OrgGaiax,
) -> Result<(), diesel::result::Error> {
    let row = UpsertOrgGaiax {
        org_id: g.org_id.clone(),
        domain: g.domain.clone(),
        public_key_jwk: g.public_key_jwk.clone(),
        cert_chain_pem: g.cert_chain_pem.clone(),
        root_ca_pem: None,
        lrn_type: g.lrn_type.clone(),
        lrn_value: g.lrn_value.clone(),
        lrn_vc: g.lrn_vc.clone(),
        lp_vc: g.lp_vc.clone(),
        tandc_vc: g.tandc_vc.clone(),
        compliance_vc: g.compliance_vc.clone(),
        wizard_step: 0,
        updated_at: g.updated_at.clone(),
    };
    diesel::replace_into(dsl::org_gaiax)
        .values(&row)
        .execute(conn)?;
    Ok(())
}

// ── Conversions ────────────────────────────────────────────────────

fn from_gaiax(g: OrgGaiax) -> GaiaxState {
    GaiaxState {
        org_id: g.org_id,
        public_key_jwk: g.public_key_jwk,
        cert_chain_pem: g.cert_chain_pem,
        lrn_credential: g.lrn_vc,
        lp_credential: g.lp_vc,
        tc_credential: g.tandc_vc,
        compliance_vc: g.compliance_vc,
        lrn_type: g.lrn_type,
        lrn_value: g.lrn_value,
        domain: g.domain,
        updated_at: g.updated_at,
    }
}

fn to_gaiax(s: &GaiaxState) -> OrgGaiax {
    OrgGaiax {
        org_id: s.org_id.clone(),
        public_key_jwk: s.public_key_jwk.clone(),
        cert_chain_pem: s.cert_chain_pem.clone(),
        lrn_vc: s.lrn_credential.clone(),
        lp_vc: s.lp_credential.clone(),
        tandc_vc: s.tc_credential.clone(),
        compliance_vc: s.compliance_vc.clone(),
        lrn_type: s.lrn_type.clone(),
        lrn_value: s.lrn_value.clone(),
        domain: s.domain.clone(),
        updated_at: s.updated_at.clone(),
    }
}

// ── DieselGaiaXRepo ────────────────────────────────────────────────

pub struct DieselGaiaXRepo {
    repos: Repos,
}

impl DieselGaiaXRepo {
    pub fn new(repos: Repos) -> Self {
        Self { repos }
    }
}

#[async_trait]
impl GaiaXRepository for DieselGaiaXRepo {
    async fn get_gaiax_state(&self, org_id: &str) -> Result<Option<GaiaxState>, String> {
        let org_id = org_id.to_string();
        self.repos
            .diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| get_org_gaiax(conn, &org_id))
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map(|opt| opt.map(from_gaiax))
            .map_err(|e| format!("db: {e}"))
    }

    async fn upsert_gaiax_state(&self, state: &GaiaxState) -> Result<(), String> {
        let gaiax = to_gaiax(state);
        self.repos
            .diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| upsert_org_gaiax(conn, &gaiax))
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("db: {e}"))
    }
}
