//! Credentials: who keasy is when it reaches a store or a model provider.
//!
//! Each family comes twice. `…Input` is what a request carries: the secrets
//! included, as [`SecretString`], and it only deserializes. `…View` is what a
//! response carries: the same fields minus every secret, so a secret cannot
//! reach a response because no response type has a field to hold it.

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::validation::ValidationReport;

/// What a credential, and every connection that uses it, is for.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Purpose {
    Storage,
    Model,
}

fn us_east_1() -> String {
    "us-east-1".into()
}

/// A credential as a request states it, secrets included.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CredentialSpecInput {
    Storage(StorageCredentialInput),
    Model(ModelCredentialInput),
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StorageCredentialInput {
    #[schema(title = "Amazon S3 / S3-compatible")]
    S3 {
        access_key_id: String,
        #[schema(value_type = String, format = Password, write_only)]
        secret_access_key: SecretString,
        #[serde(default = "us_east_1")]
        #[schema(default = "us-east-1")]
        region: String,
        /// MinIO, R2 or a gateway. An `http://` endpoint opts into plain HTTP.
        #[serde(default)]
        #[schema(format = "uri")]
        endpoint: Option<String>,
    },
    #[schema(title = "Azure Blob — account key")]
    AzureAccountKey {
        account: String,
        #[schema(value_type = String, format = Password, write_only)]
        key: SecretString,
    },
    #[schema(title = "Azure Blob — SAS token")]
    AzureSas {
        account: String,
        #[schema(value_type = String, format = Password, write_only)]
        sas_token: SecretString,
    },
    #[schema(title = "Azure Blob — service principal")]
    AzureServicePrincipal {
        account: String,
        tenant_id: String,
        client_id: String,
        #[schema(value_type = String, format = Password, write_only)]
        client_secret: SecretString,
    },
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModelCredentialInput {
    #[schema(title = "Anthropic")]
    Anthropic {
        #[schema(value_type = String, format = Password, write_only)]
        api_key: SecretString,
    },
    #[schema(title = "OpenAI")]
    Openai {
        #[schema(value_type = String, format = Password, write_only)]
        api_key: SecretString,
        /// An OpenAI-compatible API root. Empty is `https://api.openai.com/v1`.
        #[serde(default)]
        #[schema(format = "uri")]
        base_url: Option<String>,
    },
}

/// A credential as a response shows it: no secret field exists here.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CredentialSpecView {
    Storage(StorageCredentialView),
    Model(ModelCredentialView),
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StorageCredentialView {
    #[schema(title = "Amazon S3 / S3-compatible")]
    S3 {
        access_key_id: String,
        region: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
    },
    #[schema(title = "Azure Blob — account key")]
    AzureAccountKey { account: String },
    #[schema(title = "Azure Blob — SAS token")]
    AzureSas { account: String },
    #[schema(title = "Azure Blob — service principal")]
    AzureServicePrincipal {
        account: String,
        tenant_id: String,
        client_id: String,
    },
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModelCredentialView {
    #[schema(title = "Anthropic")]
    Anthropic {},
    #[schema(title = "OpenAI")]
    Openai {
        #[serde(skip_serializing_if = "Option::is_none")]
        base_url: Option<String>,
    },
}

impl CredentialSpecInput {
    pub fn purpose(&self) -> Purpose {
        match self {
            Self::Storage(_) => Purpose::Storage,
            Self::Model(_) => Purpose::Model,
        }
    }

    pub fn view(&self) -> CredentialSpecView {
        match self {
            Self::Storage(s) => CredentialSpecView::Storage(s.view()),
            Self::Model(m) => CredentialSpecView::Model(m.view()),
        }
    }
}

impl StorageCredentialInput {
    pub fn view(&self) -> StorageCredentialView {
        match self {
            Self::S3 {
                access_key_id,
                region,
                endpoint,
                ..
            } => StorageCredentialView::S3 {
                access_key_id: access_key_id.clone(),
                region: region.clone(),
                endpoint: endpoint.clone(),
            },
            Self::AzureAccountKey { account, .. } => StorageCredentialView::AzureAccountKey {
                account: account.clone(),
            },
            Self::AzureSas { account, .. } => StorageCredentialView::AzureSas {
                account: account.clone(),
            },
            Self::AzureServicePrincipal {
                account,
                tenant_id,
                client_id,
                ..
            } => StorageCredentialView::AzureServicePrincipal {
                account: account.clone(),
                tenant_id: tenant_id.clone(),
                client_id: client_id.clone(),
            },
        }
    }
}

impl ModelCredentialInput {
    pub fn view(&self) -> ModelCredentialView {
        match self {
            Self::Anthropic { .. } => ModelCredentialView::Anthropic {},
            Self::Openai { base_url, .. } => ModelCredentialView::Openai {
                base_url: base_url.clone(),
            },
        }
    }

    /// The model a connection that names none runs.
    pub fn default_model(&self) -> &'static str {
        match self {
            Self::Anthropic { .. } => "claude-sonnet-4-20250514",
            Self::Openai { .. } => "gpt-4o",
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCredentialRequest {
    pub name: String,
    pub spec: CredentialSpecInput,
    /// A storage URL to LIST before the credential is stored. A storage
    /// credential has no location of its own, so without one it is only
    /// checked to build a client.
    #[serde(default)]
    #[schema(format = "uri")]
    pub probe_url: Option<String>,
}

/// A rename, a rotation or both. `spec` replaces the whole spec, secrets
/// included, and is stored only if every connection using the credential
/// still validates with it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCredentialRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub spec: Option<CredentialSpecInput>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CredentialView {
    pub name: String,
    pub spec: CredentialSpecView,
    /// The connections that use this credential.
    pub used_by: Vec<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_by: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PurposeQuery {
    /// Only those of this purpose.
    pub purpose: Option<Purpose>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ValidateCredentialRequest {
    /// A storage URL to LIST besides the connections that use the credential.
    #[serde(default)]
    #[schema(format = "uri")]
    pub url: Option<String>,
}
