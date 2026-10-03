use std::fmt;

use object_store::path::Path as ObjectPath;

use super::SecretSpec;

const S3: &[&str] = &["s3", "s3a"];
const AZURE: &[&str] = &["az", "azure", "abfs", "abfss", "adl"];
const AZURE_HOSTS: &[&str] = &[".dfs.core.windows.net", ".blob.core.windows.net"];

/// The kind of store a location is in, as a credential reaches it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreKind {
    S3,
    Azure,
}

impl StoreKind {
    /// The schemes that name this store, as a person would type them.
    pub fn spellings(self) -> String {
        let schemes = match self {
            Self::S3 => S3,
            Self::Azure => AZURE,
        };
        schemes
            .iter()
            .map(|s| format!("{s}://"))
            .collect::<Vec<_>>()
            .join(", ")
    }

    pub fn of(credential: &SecretSpec) -> Self {
        match credential {
            SecretSpec::S3 { .. } => Self::S3,
            SecretSpec::AzureAccountKey { .. } | SecretSpec::AzureServicePrincipal { .. } => {
                Self::Azure
            }
        }
    }
}

/// The bucket a location is in, and the service that serves it. The service
/// is part of the identity: `s3://data/` on MinIO and on AWS are two stores.
/// It is `None` until [`StorageLocation::within`] names it from a credential.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Store {
    S3 {
        endpoint: Option<String>,
        bucket: String,
    },
    Azure {
        account: Option<String>,
        container: String,
    },
}

/// A place in an object store, in one canonical form: the store, and a path
/// of whole segments under its bucket. Parsed once, from the text as written,
/// so what is authorised and what is signed are the same value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageLocation {
    store: Store,
    path: ObjectPath,
}

impl StorageLocation {
    /// `s3://bucket/a/b`, `az://container/a`, `abfss://container@account.dfs.core.windows.net/a`.
    ///
    /// The path is decoded segment by segment from the text itself, so `.`,
    /// `..` and their percent-encodings are refused rather than resolved — a
    /// URL parser resolves them first, and would hand back a place the text
    /// never named.
    pub fn parse(s: &str) -> Result<Self, String> {
        let (scheme, rest) = s
            .split_once("://")
            .ok_or_else(|| format!("{s:?} is not a storage URL"))?;
        let scheme = scheme.to_ascii_lowercase();
        let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
        if authority.is_empty() {
            return Err(format!("{s:?} names no bucket or container"));
        }
        let store = if S3.contains(&scheme.as_str()) {
            if authority.contains(['@', ':']) {
                return Err(format!("{s:?}: {authority:?} is not a bucket name"));
            }
            Store::S3 {
                endpoint: None,
                bucket: authority.to_string(),
            }
        } else if AZURE.contains(&scheme.as_str()) {
            match authority.split_once('@') {
                None => Store::Azure {
                    account: None,
                    container: authority.to_string(),
                },
                Some((container, host)) => {
                    let account = AZURE_HOSTS
                        .iter()
                        .find_map(|suffix| host.strip_suffix(suffix))
                        .filter(|a| !a.is_empty() && !a.contains('.'))
                        .ok_or_else(|| format!("{s:?}: {host:?} is not an Azure storage host"))?;
                    Store::Azure {
                        account: Some(account.to_string()),
                        container: container.to_string(),
                    }
                }
            }
        } else {
            return Err(format!(
                "{scheme}:// is not a store keasy reaches (s3://, az://, abfss://, …)"
            ));
        };
        let path = ObjectPath::from_url_path(path).map_err(|e| format!("{s:?}: {e}"))?;
        Ok(Self { store, path })
    }

    pub fn kind(&self) -> StoreKind {
        match self.store {
            Store::S3 { .. } => StoreKind::S3,
            Store::Azure { .. } => StoreKind::Azure,
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// The bucket (S3) or container (Azure).
    pub fn bucket(&self) -> &str {
        match &self.store {
            Store::S3 { bucket, .. } => bucket,
            Store::Azure { container, .. } => container,
        }
    }

    /// The object path under the bucket; empty for the bucket's root.
    pub fn path(&self) -> &ObjectPath {
        &self.path
    }

    /// This location as reached through `credential`: the credential names
    /// the service the text leaves implicit.
    pub fn within(mut self, credential: &SecretSpec) -> Result<Self, String> {
        if StoreKind::of(credential) != self.kind() {
            return Err(format!(
                "this credential reaches {} URLs, not {}",
                StoreKind::of(credential).spellings(),
                self.kind().spellings()
            ));
        }
        match (&mut self.store, credential) {
            (Store::S3 { endpoint, .. }, SecretSpec::S3 { endpoint: e, .. }) => {
                *endpoint = e
                    .as_deref()
                    .map(|e| e.trim_end_matches('/').to_ascii_lowercase());
            }
            (
                Store::Azure { account, .. },
                SecretSpec::AzureAccountKey { account: a, .. }
                | SecretSpec::AzureServicePrincipal { account: a, .. },
            ) => match account {
                Some(named) if named != a => {
                    return Err(format!(
                        "the URL names the account {named:?} and the credential {a:?}"
                    ));
                }
                _ => *account = Some(a.clone()),
            },
            _ => unreachable!("kinds were compared above"),
        }
        Ok(self)
    }

    /// Whether `other` lies at or under this location: the same store, and
    /// this path's segments a prefix of the other's.
    pub fn contains(&self, other: &Self) -> bool {
        self.store == other.store && other.path.prefix_match(&self.path).is_some()
    }

    /// Whether either location lies within the other.
    pub fn overlaps(&self, other: &Self) -> bool {
        self.contains(other) || other.contains(self)
    }

    /// The location one segment below this one.
    pub fn child(&self, segment: &str) -> Self {
        Self {
            store: self.store.clone(),
            path: self.path.child(segment),
        }
    }
}

/// The canonical text: one scheme per store, and a trailing `/` on every
/// non-root path, so appending a relative path is concatenation.
impl fmt::Display for StorageLocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.store {
            Store::S3 { bucket, .. } => write!(f, "s3://{bucket}/")?,
            Store::Azure {
                account: Some(account),
                container,
            } => write!(f, "abfss://{container}@{account}.dfs.core.windows.net/")?,
            Store::Azure {
                account: None,
                container,
            } => write!(f, "az://{container}/")?,
        }
        match self.path.as_ref() {
            "" => Ok(()),
            path => write!(f, "{path}/"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::SecretString;

    fn loc(s: &str) -> StorageLocation {
        StorageLocation::parse(s).unwrap()
    }

    fn s3(endpoint: Option<&str>) -> SecretSpec {
        SecretSpec::S3 {
            access_key_id: "AK".into(),
            secret_access_key: SecretString::from("SK"),
            region: "us-east-1".into(),
            endpoint: endpoint.map(Into::into),
            role_arn: None,
            external_id: None,
        }
    }

    #[test]
    fn a_location_names_a_store_a_bucket_and_a_path() {
        let l = loc("s3://bucket/data/x.csv");
        assert_eq!(l.kind(), StoreKind::S3);
        assert_eq!(l.bucket(), "bucket");
        assert_eq!(l.path().as_ref(), "data/x.csv");
        assert_eq!(loc("s3a://b/p").to_string(), "s3://b/p/");
        assert_eq!(loc("s3://b").to_string(), "s3://b/");
        assert_eq!(loc("s3://b/data/").to_string(), "s3://b/data/");
        let abfss = loc("abfss://cont@acct.dfs.core.windows.net/data/x.csv");
        assert_eq!(abfss.bucket(), "cont");
        assert_eq!(abfss.path().as_ref(), "data/x.csv");
        assert_eq!(
            abfss.to_string(),
            "abfss://cont@acct.dfs.core.windows.net/data/x.csv/"
        );
        for bad in [
            "https://example.org/x",
            "s3:///x",
            "not a url",
            "/tmp/x",
            "s3://user@b/x",
            "abfss://c@example.org/x",
        ] {
            assert!(StorageLocation::parse(bad).is_err(), "{bad}");
        }
    }

    /// The bypass this type exists to close: a dot segment, spelt any way, is
    /// refused where it is written instead of resolved into another place.
    #[test]
    fn a_dot_segment_is_refused_however_it_is_spelt() {
        for bad in [
            "s3://b/vocab/../output/graph/x.parquet",
            "s3://b/vocab/%2e%2e/output/graph/x.parquet",
            "s3://b/vocab/.%2e/output/graph/x.parquet",
            "s3://b/vocab/%2E%2E/output/graph/x.parquet",
            "s3://b/./output/graph/x.parquet",
            "s3://b/%2e/output/graph/x.parquet",
            "s3://b/a//b",
        ] {
            assert!(StorageLocation::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn containment_is_by_whole_segments_within_one_store() {
        let data = loc("s3://b/data/");
        assert!(data.contains(&loc("s3://b/data/x.csv")));
        assert!(data.contains(&loc("s3://b/data")));
        assert!(!data.contains(&loc("s3://b/data-private/x.csv")));
        assert!(!data.contains(&loc("s3://other/data/x.csv")));
        assert!(loc("s3://b/").contains(&loc("s3a://b/output/graph/x")));
        assert!(loc("s3://b/output/").overlaps(&loc("s3://b/output/graph")));
        assert!(!loc("s3://b/data/").overlaps(&loc("s3://b/output/")));
    }

    #[test]
    fn the_service_a_credential_reaches_is_part_of_the_identity() {
        let minio = loc("s3://b/data/")
            .within(&s3(Some("http://minio:9000/")))
            .unwrap();
        let aws = loc("s3://b/data/").within(&s3(None)).unwrap();
        assert!(!minio.overlaps(&aws));
        assert!(
            minio.contains(
                &loc("s3://b/data/x")
                    .within(&s3(Some("HTTP://MINIO:9000")))
                    .unwrap()
            )
        );
        let az = SecretSpec::AzureAccountKey {
            account: "acct".into(),
            key: SecretString::from("k"),
        };
        assert!(loc("s3://b/").within(&az).is_err());
        assert!(
            loc("abfss://c@other.dfs.core.windows.net/")
                .within(&az)
                .is_err()
        );
        assert_eq!(
            loc("az://c/p").within(&az).unwrap(),
            loc("abfss://c@acct.dfs.core.windows.net/p")
                .within(&az)
                .unwrap()
        );
    }
}
