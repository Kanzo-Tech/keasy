/// Gaia-X state CRUD — bridges GaiaxState (gaia_x layer) and OrgGaiax (DB layer).
use crate::db::Repos;
use crate::db::org_gaiax::{OrgGaiax, get_org_gaiax, upsert_org_gaiax};
use crate::gaia_x::GaiaxState;

impl Repos {
    /// Fetch the Gaia-X state for the given org, or None if it doesn't exist yet.
    pub async fn get_gaiax_state(&self, org_id: &str) -> Result<Option<GaiaxState>, String> {
        let org_id = org_id.to_string();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| get_org_gaiax(conn, &org_id))
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map(|opt| opt.map(from_gaiax))
            .map_err(|e| format!("db: {e}"))
    }

    /// Insert or replace the Gaia-X state for an org.
    pub async fn upsert_gaiax_state(&self, state: &GaiaxState) -> Result<(), String> {
        let gaiax = to_gaiax(state);
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| upsert_org_gaiax(conn, &gaiax))
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("db: {e}"))
    }
}

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
