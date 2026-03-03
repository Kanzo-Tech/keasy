/// Real GXDCH HTTP client — calls the live Notary and Compliance Service APIs.
use serde_json::{Value, json};

/// Real GXDCH client with configurable endpoint URLs.
#[derive(Clone)]
pub struct RealGxdch {
    pub notary_url: String,
    pub compliance_url: String,
}

impl RealGxdch {
    /// Request a signed LRN Verifiable Credential from the GXDCH Notary.
    pub async fn request_lrn_credential(
        &self,
        domain: &str,
        lrn_type: &str,
        lrn_value: &str,
    ) -> Result<Value, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("failed to create HTTP client: {e}"))?;

        let lrn_key = format!("gx:{lrn_type}");
        let vc_id = format!("https://{}/.well-known/lrn.json", domain);

        let body = json!({
            "@context": [
                "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/participant"
            ],
            "type": "gx:legalRegistrationNumber",
            "id": &vc_id,
            lrn_key: lrn_value
        });

        let url = format!("{}?vcid={}", self.notary_url, urlencoding::encode(&vc_id));

        let resp = client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("GXDCH Notary unreachable: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!("GXDCH Notary returned {status}: {err_body}"));
        }

        resp.json::<Value>()
            .await
            .map_err(|e| format!("failed to parse GXDCH Notary response: {e}"))
    }

    /// Submit a Verifiable Presentation to the GXDCH Compliance Service.
    pub async fn submit_compliance(&self, vp: &Value) -> Result<Value, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| format!("failed to create HTTP client: {e}"))?;

        let resp = client
            .post(&self.compliance_url)
            .json(vp)
            .send()
            .await
            .map_err(|e| format!("GXDCH Compliance Service unreachable: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "GXDCH Compliance Service returned {status}: {err_body}"
            ));
        }

        resp.json::<Value>()
            .await
            .map_err(|e| format!("failed to parse GXDCH Compliance Service response: {e}"))
    }
}
