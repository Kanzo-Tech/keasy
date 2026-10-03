//! Secrets: who keasy is when it reaches a store. Models are not here: every
//! model call goes through the platform's AI gateway with the workspace's own
//! key (`KEASY_AI_URL`), which is configuration, not a stored secret.
//!
//! A spec comes twice. [`SecretSpec`] is what a request carries: its values
//! included, as [`SecretString`], and it only deserializes. [`SecretSpecView`]
//! is what a response carries: the same fields minus every value, so a value
//! cannot reach a response because no response type has a field to hold it.

use crate::authentication::role::Caller;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Provenance, ValidationReport};

fn us_east_1() -> String {
    "us-east-1".into()
}

/// A secret's spec as a request states it, its values included.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SecretSpec {
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

/// A secret's spec as a response shows it: what names it, never what signs with it.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SecretSpecView {
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

impl SecretSpec {
    pub fn view(&self) -> SecretSpecView {
        match self {
            Self::S3 {
                access_key_id,
                region,
                endpoint,
                role_arn,
                external_id,
                ..
            } => SecretSpecView::S3 {
                access_key_id: access_key_id.clone(),
                region: region.clone(),
                endpoint: endpoint.clone(),
                role_arn: role_arn.clone(),
                external_id: external_id.clone(),
            },
            Self::AzureAccountKey { account, .. } => SecretSpecView::AzureAccountKey {
                account: account.clone(),
            },
            Self::AzureServicePrincipal {
                account,
                tenant_id,
                client_id,
                ..
            } => SecretSpecView::AzureServicePrincipal {
                account: account.clone(),
                tenant_id: tenant_id.clone(),
                client_id: client_id.clone(),
            },
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SecretView {
    pub name: String,
    pub spec: SecretSpecView,
    /// The connections that use this secret.
    pub used_by: Vec<String>,
    #[serde(flatten)]
    pub provenance: Provenance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
    /// Whether the caller may change or delete it: its creator or an admin.
    /// Any editor may use it in a connection; its value is never returned.
    #[serde(default)]
    pub can_modify: bool,
}

impl SecretView {
    /// The secret as `caller` sees it: [`Self::can_modify`] filled in.
    pub fn seen_by(mut self, caller: &Caller) -> Self {
        self.can_modify = caller.may_modify(&self.provenance.created_by.id);
        self
    }
}

/// A stored secret, unsealed.
pub struct Credential {
    pub name: String,
    pub spec: SecretSpec,
    pub provenance: Provenance,
    pub validation: Option<ValidationReport>,
}

impl Credential {
    pub fn view(&self, used_by: Vec<String>) -> SecretView {
        SecretView {
            name: self.name.clone(),
            spec: self.spec.view(),
            used_by,
            provenance: self.provenance.clone(),
            validation: self.validation.clone(),
            can_modify: false,
        }
    }
}
