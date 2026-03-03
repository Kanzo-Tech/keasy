use rusqlite::{Connection, Error, OptionalExtension, params};

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

pub fn get_org_gaiax(conn: &Connection, org_id: &str) -> Result<Option<OrgGaiax>, Error> {
    conn.query_row(
        "SELECT org_id, domain, public_key_jwk, cert_chain_pem,
                lrn_type, lrn_value, lrn_vc, lp_vc, tandc_vc, compliance_vc,
                updated_at
         FROM org_gaiax WHERE org_id = ?1",
        params![org_id],
        |row| {
            Ok(OrgGaiax {
                org_id: row.get(0)?,
                domain: row.get(1)?,
                public_key_jwk: row.get(2)?,
                cert_chain_pem: row.get(3)?,
                lrn_type: row.get(4)?,
                lrn_value: row.get(5)?,
                lrn_vc: row.get(6)?,
                lp_vc: row.get(7)?,
                tandc_vc: row.get(8)?,
                compliance_vc: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )
    .optional()
}

pub fn upsert_org_gaiax(conn: &Connection, g: &OrgGaiax) -> Result<(), Error> {
    conn.execute(
        "INSERT OR REPLACE INTO org_gaiax
             (org_id, domain, public_key_jwk, cert_chain_pem, root_ca_pem,
              lrn_type, lrn_value, lrn_vc, lp_vc, tandc_vc, compliance_vc,
              wizard_step, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11)",
        params![
            g.org_id,
            g.domain,
            g.public_key_jwk,
            g.cert_chain_pem,
            g.lrn_type,
            g.lrn_value,
            g.lrn_vc,
            g.lp_vc,
            g.tandc_vc,
            g.compliance_vc,
            g.updated_at,
        ],
    )?;
    Ok(())
}
