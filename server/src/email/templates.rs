/// Returns the plain-text body for an org invite email.
pub fn invite_email_body(invite_url: &str, org_name: &str) -> String {
    format!(
        "You've been invited to join {org_name} on Keasy.\n\nClick the link below to set up your account:\n\n{invite_url}\n\nThis link expires in 7 days."
    )
}
