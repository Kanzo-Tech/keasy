/// Wizard state CRUD for the gaia_x_wizard_state table.
///
/// Functions are designed to be called inside db.read() / db.write() closures.
use rusqlite::{Connection, Error, OptionalExtension, Row, params};

use crate::gaia_x::WizardState;

/// Map a SQLite row to a WizardState.
fn row_to_state(row: &Row<'_>) -> Result<WizardState, Error> {
    Ok(WizardState {
        org_id: row.get(0)?,
        current_step: row.get(1)?,
        public_key_jwk: row.get(2)?,
        cert_chain_pem: row.get(3)?,
        root_ca_pem: row.get(4)?,
        did_document: row.get(5)?,
        lrn_credential: row.get(6)?,
        lp_credential: row.get(7)?,
        tc_credential: row.get(8)?,
        compliance_vc: row.get(9)?,
        lrn_type: row.get(10)?,
        lrn_value: row.get(11)?,
        legal_name: row.get(12)?,
        country_code: row.get(13)?,
        domain: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

/// Fetch the wizard state for the given org, or None if it doesn't exist yet.
pub fn get_wizard_state(
    conn: &Connection,
    org_id: &str,
) -> Result<Option<WizardState>, Error> {
    conn.query_row(
        "SELECT org_id, current_step, public_key_jwk, cert_chain_pem, root_ca_pem,
                did_document, lrn_credential, lp_credential, tc_credential, compliance_vc,
                lrn_type, lrn_value, legal_name, country_code, domain, updated_at
         FROM gaia_x_wizard_state
         WHERE org_id = ?1",
        params![org_id],
        row_to_state,
    )
    .optional()
}

/// Insert or replace the wizard state for an org.
///
/// Uses INSERT OR REPLACE (upsert) — always overwrites any existing row for the org.
/// `state.updated_at` should be set to the current UTC ISO8601 timestamp by the caller.
pub fn upsert_wizard_state(conn: &Connection, state: &WizardState) -> Result<(), Error> {
    conn.execute(
        "INSERT OR REPLACE INTO gaia_x_wizard_state
             (org_id, current_step, public_key_jwk, cert_chain_pem, root_ca_pem,
              did_document, lrn_credential, lp_credential, tc_credential, compliance_vc,
              lrn_type, lrn_value, legal_name, country_code, domain, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            state.org_id,
            state.current_step,
            state.public_key_jwk,
            state.cert_chain_pem,
            state.root_ca_pem,
            state.did_document,
            state.lrn_credential,
            state.lp_credential,
            state.tc_credential,
            state.compliance_vc,
            state.lrn_type,
            state.lrn_value,
            state.legal_name,
            state.country_code,
            state.domain,
            state.updated_at,
        ],
    )?;
    Ok(())
}
