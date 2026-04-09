use diesel::prelude::*;

use crate::db::diesel_schema::org_gaiax;

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

pub fn get_org_gaiax(
    conn: &mut diesel::SqliteConnection,
    org_id: &str,
) -> Result<Option<OrgGaiax>, diesel::result::Error> {
    dsl::org_gaiax
        .filter(dsl::org_id.eq(org_id))
        .select(OrgGaiax::as_select())
        .first::<OrgGaiax>(conn)
        .optional()
}

pub fn upsert_org_gaiax(
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
