use std::fmt;

use object_store::path::Path as ObjectPath;

const S3: &[&str] = &["s3", "s3a"];
const AZURE: &[&str] = &["abfss", "abfs", "az", "azure", "adl"];
const AZURE_HOSTS: &[&str] = &[".dfs.core.windows.net", ".blob.core.windows.net"];
const GCS: &[&str] = &["gs", "gcs"];

/// The kind of store a location is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreKind {
    S3,
    Azure,
    Gcs,
}

/// The bucket a location is in, and for Azure the account that serves it: an
/// account is part of a container's identity, so a location names it — the
/// storage service opens nothing it has to guess. An S3 or GCS bucket names
/// itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Store {
    S3 { bucket: String },
    Azure { account: String, container: String },
    Gcs { bucket: String },
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
    /// `s3://bucket/a/b`, `abfss://container@account.dfs.core.windows.net/a`, `gs://bucket/a`.
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
        let bucket = |authority: &str| {
            if authority.contains(['@', ':']) {
                Err(format!("{s:?}: {authority:?} is not a bucket name"))
            } else {
                Ok(authority.to_string())
            }
        };
        let store = if S3.contains(&scheme.as_str()) {
            Store::S3 {
                bucket: bucket(authority)?,
            }
        } else if GCS.contains(&scheme.as_str()) {
            Store::Gcs {
                bucket: bucket(authority)?,
            }
        } else if AZURE.contains(&scheme.as_str()) {
            let (container, host) = authority.split_once('@').ok_or_else(|| {
                format!("{s:?} names no account: abfss://container@account.dfs.core.windows.net/")
            })?;
            let account = AZURE_HOSTS
                .iter()
                .find_map(|suffix| host.strip_suffix(suffix))
                .filter(|a| !a.is_empty() && !a.contains('.'))
                .ok_or_else(|| format!("{s:?}: {host:?} is not an Azure storage host"))?;
            Store::Azure {
                account: account.to_ascii_lowercase(),
                container: container.to_string(),
            }
        } else {
            return Err(format!(
                "{scheme}:// is not a store keasy reaches (s3://, abfss://, gs://)"
            ));
        };
        let path = ObjectPath::from_url_path(path).map_err(|e| format!("{s:?}: {e}"))?;
        Ok(Self { store, path })
    }

    pub fn kind(&self) -> StoreKind {
        match self.store {
            Store::S3 { .. } => StoreKind::S3,
            Store::Azure { .. } => StoreKind::Azure,
            Store::Gcs { .. } => StoreKind::Gcs,
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// The bucket (S3, GCS) or container (Azure).
    pub fn bucket(&self) -> &str {
        match &self.store {
            Store::S3 { bucket } | Store::Gcs { bucket } => bucket,
            Store::Azure { container, .. } => container,
        }
    }

    /// The object path under the bucket; empty for the bucket's root.
    pub fn path(&self) -> &ObjectPath {
        &self.path
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
            Store::S3 { bucket } => write!(f, "s3://{bucket}/")?,
            Store::Gcs { bucket } => write!(f, "gs://{bucket}/")?,
            Store::Azure { account, container } => {
                write!(f, "abfss://{container}@{account}.dfs.core.windows.net/")?
            }
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

    fn loc(s: &str) -> StorageLocation {
        StorageLocation::parse(s).unwrap()
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
        assert_eq!(
            loc("az://cont@ACCT.blob.core.windows.net/d").to_string(),
            "abfss://cont@acct.dfs.core.windows.net/d/"
        );
        assert_eq!(loc("gs://b/d").kind(), StoreKind::Gcs);
        assert_eq!(loc("gcs://b/d").to_string(), "gs://b/d/");
        for bad in [
            "https://example.org/x",
            "s3:///x",
            "not a url",
            "/tmp/x",
            "s3://user@b/x",
            "abfss://c@example.org/x",
            "az://container/x",
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
        assert!(
            !loc("abfss://c@one.dfs.core.windows.net/")
                .contains(&loc("abfss://c@two.dfs.core.windows.net/x"))
        );
        assert!(!loc("s3://b/").contains(&loc("gs://b/x")));
    }
}
