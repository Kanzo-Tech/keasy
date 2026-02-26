pub mod templates;

use std::sync::Arc;

/// SMTP configuration, read from environment variables.
#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
    pub from: String,
}

/// Email service. Supports SMTP delivery and dev fallback (logs invite URL).
///
/// Clone is cheap — SmtpConfig is wrapped in Arc.
#[derive(Debug, Clone)]
pub struct EmailService {
    smtp_config: Option<Arc<SmtpConfig>>,
}

impl EmailService {
    /// Build an EmailService from environment variables.
    ///
    /// Required for SMTP: KEASY_SMTP_HOST, KEASY_SMTP_USER, KEASY_SMTP_PASS.
    /// Optional: KEASY_SMTP_PORT (default 587), KEASY_SMTP_FROM (default "noreply@keasy.local").
    /// If any required var is missing, SMTP is disabled and invite links are logged.
    pub fn from_env() -> Self {
        let host = std::env::var("KEASY_SMTP_HOST").ok();
        let user = std::env::var("KEASY_SMTP_USER").ok();
        let pass = std::env::var("KEASY_SMTP_PASS").ok();

        let smtp_config = match (host, user, pass) {
            (Some(host), Some(user), Some(pass)) if !host.is_empty() && !user.is_empty() && !pass.is_empty() => {
                let port = std::env::var("KEASY_SMTP_PORT")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(587u16);
                let from = std::env::var("KEASY_SMTP_FROM")
                    .unwrap_or_else(|_| "noreply@keasy.local".to_string());
                Some(Arc::new(SmtpConfig { host, port, user, pass, from }))
            }
            _ => None,
        };

        Self { smtp_config }
    }

    /// Send an invite email.
    ///
    /// If SMTP is configured, sends via STARTTLS. Otherwise logs the invite URL
    /// so developers can complete the flow without a real mail server.
    pub async fn send_invite_email(
        &self,
        to: &str,
        token: &str,
        base_url: &str,
        org_name: &str,
    ) -> Result<(), String> {
        let invite_url = format!("{base_url}/register?token={token}");
        let body = templates::invite_email_body(&invite_url, org_name);

        match &self.smtp_config {
            Some(cfg) => {
                use lettre::message::header::ContentType;
                use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
                use lettre::transport::smtp::authentication::Credentials;

                let email = Message::builder()
                    .from(
                        cfg.from
                            .parse()
                            .map_err(|e| format!("invalid from address: {e}"))?,
                    )
                    .to(to.parse().map_err(|e| format!("invalid to address: {e}"))?)
                    .subject(format!("You've been invited to join {org_name} on Keasy"))
                    .header(ContentType::TEXT_PLAIN)
                    .body(body)
                    .map_err(|e| format!("build email: {e}"))?;

                let creds = Credentials::new(cfg.user.clone(), cfg.pass.clone());
                let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.host)
                    .map_err(|e| format!("SMTP relay setup: {e}"))?
                    .credentials(creds)
                    .port(cfg.port)
                    .build();

                mailer
                    .send(email)
                    .await
                    .map_err(|e| format!("SMTP send: {e}"))?;

                Ok(())
            }
            None => {
                tracing::warn!(
                    to = %to,
                    invite_url = %invite_url,
                    "SMTP not configured — invite link logged for dev use"
                );
                Ok(())
            }
        }
    }
}
