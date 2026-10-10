//! Secrets: who keasy is when it reaches a store. Models are not here: every
//! model call goes from the web to the platform's AI gateway with the person's
//! own token, exchanged for the gateway, and no server holds a model key.
//!
//! A spec comes twice. [`SecretSpec`] is what a request carries: its values
//! included, as [`SecretString`], and it only deserializes. [`SecretSpecView`]
//! is what a response carries: the same fields minus every value, so a value
//! cannot reach a response because no response type has a field to hold it.

use crate::authentication::permission::{Can, Kind, Securable};
use crate::authentication::role::Caller;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Actor, Grant, Provenance, ValidationReport};

fn us_east_1() -> String {
    "us-east-1".into()
}

/// A secret's spec as a request states it, its values included.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SecretSpec {
    #[schema(title = "Amazon S3")]
    S3 {
        access_key_id: String,
        #[schema(value_type = String, format = Password, write_only)]
        secret_access_key: SecretString,
        #[serde(default = "us_east_1")]
        #[schema(default = "us-east-1")]
        region: String,
        /// The role keasy assumes to vend a credential scoped to one prefix.
        /// AWS needs it.
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
    #[schema(title = "Amazon S3")]
    S3 {
        access_key_id: String,
        region: String,
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
                role_arn,
                external_id,
                ..
            } => SecretSpecView::S3 {
                access_key_id: access_key_id.clone(),
                region: region.clone(),
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
    /// Who owns it: its creator, or the workspace for what the instance
    /// declares. Its owner, its managers or an admin manages it.
    pub owner: Actor,
    /// Who else manages it, and who may use it: what the workspace does not
    /// own, an editor uses only by a grant.
    pub grants: Vec<Grant>,
    #[serde(flatten)]
    pub provenance: Provenance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
    /// What the caller may do to it: use it in a connection (by a grant),
    /// test it (any editor), manage it (its owner, a manager or an admin)
    /// and give it away (its owner or an admin). Its value is never returned
    /// to anyone.
    pub can: Can,
}

impl Securable for SecretView {
    fn kind(&self) -> Kind {
        Kind::Secret
    }

    fn owner(&self) -> &Actor {
        &self.owner
    }

    fn grants(&self) -> &[Grant] {
        &self.grants
    }
}

impl SecretView {
    /// The secret as `caller` sees it: [`Self::can`] filled in.
    pub fn seen_by(mut self, caller: &Caller) -> Self {
        self.can = caller.can(&self);
        self
    }
}

/// A stored secret, unsealed.
pub struct Credential {
    pub name: String,
    pub spec: SecretSpec,
    pub owner: Actor,
    pub grants: Vec<Grant>,
    pub provenance: Provenance,
    pub validation: Option<ValidationReport>,
}

impl Securable for Credential {
    fn kind(&self) -> Kind {
        Kind::Secret
    }

    fn owner(&self) -> &Actor {
        &self.owner
    }

    fn grants(&self) -> &[Grant] {
        &self.grants
    }
}

impl Credential {
    pub fn view(&self, used_by: Vec<String>) -> SecretView {
        SecretView {
            name: self.name.clone(),
            spec: self.spec.view(),
            used_by,
            owner: self.owner.clone(),
            grants: self.grants.clone(),
            provenance: self.provenance.clone(),
            validation: self.validation.clone(),
            can: Can::default(),
        }
    }
}
