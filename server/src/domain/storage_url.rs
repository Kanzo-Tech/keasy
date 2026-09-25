use object_store::path::Path as ObjectPath;
use url::Url;

/// The object stores keasy signs for, by URL scheme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageScheme {
    S3,
    Azure,
}

const S3: &[&str] = &["s3", "s3a"];
const AZURE: &[&str] = &["az", "azure", "abfs", "abfss", "adl"];

impl StorageScheme {
    fn of(scheme: &str) -> Option<Self> {
        if S3.contains(&scheme) {
            Some(Self::S3)
        } else if AZURE.contains(&scheme) {
            Some(Self::Azure)
        } else {
            None
        }
    }

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
}

/// A location in an object store: `s3://bucket/prefix/…` or
/// `az://container/prefix/…`.
#[derive(Debug, Clone)]
pub struct StorageUrl {
    raw: String,
    scheme: StorageScheme,
    bucket: String,
    path: ObjectPath,
}

impl StorageUrl {
    pub fn parse(s: &str) -> Result<Self, String> {
        let url = Url::parse(s).map_err(|e| format!("{s:?} is not a URL: {e}"))?;
        let scheme = StorageScheme::of(url.scheme()).ok_or_else(|| {
            format!(
                "{}:// is not a store keasy reaches (s3://, az://, abfss://, …)",
                url.scheme()
            )
        })?;
        let bucket = url
            .host_str()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| format!("{s:?} names no bucket or container"))?
            .to_string();
        let key = url.path().trim_start_matches('/');
        let path = if key.is_empty() {
            ObjectPath::from("")
        } else {
            ObjectPath::parse(key).map_err(|e| format!("{s:?}: {e}"))?
        };
        Ok(Self {
            raw: s.to_string(),
            scheme,
            bucket,
            path,
        })
    }

    pub fn scheme(&self) -> StorageScheme {
        self.scheme
    }

    pub fn bucket(&self) -> &str {
        &self.bucket
    }

    /// The object path under the bucket; empty for the bucket's root.
    pub fn path(&self) -> &ObjectPath {
        &self.path
    }
}

impl AsRef<str> for StorageUrl {
    fn as_ref(&self) -> &str {
        &self.raw
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_storage_url_names_a_store_a_bucket_and_a_path() {
        let url = StorageUrl::parse("s3://bucket/data/x.csv").unwrap();
        assert_eq!(url.scheme(), StorageScheme::S3);
        assert_eq!(url.bucket(), "bucket");
        assert_eq!(url.path().as_ref(), "data/x.csv");
        assert_eq!(
            StorageUrl::parse("abfss://c/").unwrap().scheme(),
            StorageScheme::Azure
        );
        assert_eq!(StorageUrl::parse("s3://b").unwrap().path().as_ref(), "");
        for bad in ["https://example.org/x", "s3:///x", "not a url", "/tmp/x"] {
            assert!(StorageUrl::parse(bad).is_err(), "{bad}");
        }
    }
}
