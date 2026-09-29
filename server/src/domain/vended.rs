use std::collections::BTreeMap;

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize, Serializer};
use utoipa::ToSchema;

/// What a vended credential lets its holder do under its prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    Read,
    Write,
}

/// A credential scoped to one prefix, for a lifetime — Iceberg REST's
/// `StorageCredential`, keys and all (`s3.access-key-id`, `s3.session-token`,
/// `s3.session-token-expires-at-ms`, `adls.sas-token.<host>`, …), so any
/// reader of vended credentials reads it. Handing it out is the point, so
/// this is the one response type that carries a secret: its values stay
/// [`SecretString`] until the moment they are written into the response.
#[derive(Debug, Serialize, ToSchema)]
pub struct VendedCredential {
    /// The canonical prefix it opens, ending in `/`.
    pub prefix: String,
    #[serde(serialize_with = "exposed")]
    #[schema(value_type = BTreeMap<String, String>)]
    pub config: BTreeMap<String, SecretString>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VendedCredentials {
    /// One per prefix; a reader picks the longest prefix that holds a path.
    pub storage_credentials: Vec<VendedCredential>,
}

fn exposed<S: Serializer>(
    config: &BTreeMap<String, SecretString>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.collect_map(config.iter().map(|(k, v)| (k, v.expose_secret())))
}
