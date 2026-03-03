/// Wizard state CRUD — bridges WizardState (gaia_x layer) and org_gaiax (DB layer).
use rusqlite::{Connection, Error};

use crate::db::org_gaiax::{OrgGaiax, get_org_gaiax, upsert_org_gaiax};
use crate::gaia_x::WizardState;

/// Fetch the wizard state for the given org, or None if it doesn't exist yet.
pub fn get_wizard_state(
    conn: &Connection,
    org_id: &str,
) -> Result<Option<WizardState>, Error> {
    let gaiax = get_org_gaiax(conn, org_id)?;
    Ok(gaiax.map(from_gaiax))
}

/// Insert or replace the wizard state for an org.
///
/// `state.updated_at` should be set to the current UTC ISO8601 timestamp by the caller.
pub fn upsert_wizard_state(conn: &Connection, state: &WizardState) -> Result<(), Error> {
    let gaiax = to_gaiax(state);
    upsert_org_gaiax(conn, &gaiax)
}

fn from_gaiax(g: OrgGaiax) -> WizardState {
    WizardState {
        org_id: g.org_id,
        current_step: g.wizard_step,
        public_key_jwk: g.public_key_jwk,
        cert_chain_pem: g.cert_chain_pem,
        root_ca_pem: g.root_ca_pem,
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

fn to_gaiax(s: &WizardState) -> OrgGaiax {
    OrgGaiax {
        org_id: s.org_id.clone(),
        wizard_step: s.current_step,
        public_key_jwk: s.public_key_jwk.clone(),
        cert_chain_pem: s.cert_chain_pem.clone(),
        root_ca_pem: s.root_ca_pem.clone(),
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
