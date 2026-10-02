//! Credentials: who keasy is when it reaches a store. Models are not here:
//! every model call goes through the platform's AI gateway with the workspace's
//! own key (`KEASY_AI_URL`), which is configuration, not a stored credential.
//!
//! Each family comes twice. `…Input` is what a request carries: the secrets
//! included, as [`SecretString`], and it only deserializes. `…View` is what a
//! response carries: the same fields minus every secret, so a secret cannot
//! reach a response because no response type has a field to hold it.

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::ValidationReport;

fn us_east_1() -> String {
    "us-east-1".into()
}

/// A credential as a request states it, secrets included.
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
        /// The role keasy assumes to vend a credential scoped to one prefix.
        /// AWS needs it. With an endpoint and no role, keasy asks for
        /// `arn:aws:iam::000000000000:role/keasy-vended`; a store that validates
        /// roles (Ceph RGW, SeaweedFS) needs that role declared, or this set.
        #[serde(default)]
        role_arn: Option<String>,
        /// AWS's guard against the confused deputy, when the role's trust
        /// policy asks for one.
        #[serde(default)]
        external_id: Option<String>,
    },
    #[schema(title = "Azure Blob — account key")]
    AzureAccountKey {
        account: String,
        #[schema(value_type = String, format = Password, write_only)]
        key: SecretString,
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

/// A credential as a response shows it: what names it, never what signs with it.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StorageCredentialView {
    #[schema(title = "Amazon S3 / S3-compatible")]
    S3 {
        access_key_id: String,
        region: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        role_arn: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        external_id: Option<String>,
    },
    #[schema(title = "Azure Blob — account key")]
    AzureAccountKey { account: String },
    #[schema(title = "Azure Blob — service principal")]
    AzureServicePrincipal {
        account: String,
        tenant_id: String,
        client_id: String,
    },
}

impl StorageCredentialInput {
    pub fn view(&self) -> StorageCredentialView {
        match self {
            Self::S3 {
                access_key_id,
                region,
                endpoint,
                role_arn,
                external_id,
                ..
            } => StorageCredentialView::S3 {
                access_key_id: access_key_id.clone(),
                region: region.clone(),
                endpoint: endpoint.clone(),
                role_arn: role_arn.clone(),
                external_id: external_id.clone(),
            },
            Self::AzureAccountKey { account, .. } => StorageCredentialView::AzureAccountKey {
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

#[derive(Debug, Serialize, ToSchema)]
pub struct CredentialView {
    pub name: String,
    pub spec: StorageCredentialView,
    /// The connections that use this credential.
    pub used_by: Vec<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_by: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
}

/// A stored credential, unsealed.
pub struct Credential {
    pub name: String,
    pub spec: StorageCredentialInput,
    pub created_by: String,
    pub created_at: String,
    pub updated_by: String,
    pub updated_at: String,
    pub validation: Option<ValidationReport>,
}

impl Credential {
    pub fn view(&self, used_by: Vec<String>) -> CredentialView {
        CredentialView {
            name: self.name.clone(),
            spec: self.spec.view(),
            used_by,
            created_by: self.created_by.clone(),
            created_at: self.created_at.clone(),
            updated_by: self.updated_by.clone(),
            updated_at: self.updated_at.clone(),
            validation: self.validation.clone(),
        }
    }
}
