/// A client-supplied path under a base URL: relative, no scheme, no `..`
/// leaving the base, no quote to close a SQL literal with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelativePath(String);

impl RelativePath {
    pub fn parse(path: &str) -> Result<Self, String> {
        let invalid = |why: &str| Err(format!("{path:?} {why}"));
        if path.is_empty() {
            return invalid("is empty");
        }
        if path.starts_with(['/', '\\']) || path.contains(':') {
            return invalid("must be relative");
        }
        if path.split(['/', '\\']).any(|segment| segment == "..") {
            return invalid("must not leave its base");
        }
        if path.contains(['\'', '"', '\0']) {
            return invalid("must not contain quotes");
        }
        Ok(Self(path.to_string()))
    }
}

impl AsRef<str> for RelativePath {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::RelativePath;

    #[test]
    fn a_client_path_stays_under_its_base() {
        for ok in ["Person.parquet", "vertex/Person/chunk0.parquet"] {
            assert!(RelativePath::parse(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../other-job/Person.parquet",
            "vertex/../../x.parquet",
            "s3://elsewhere/x.parquet",
            "it's.parquet",
            "a\"b.parquet",
        ] {
            assert!(RelativePath::parse(bad).is_err(), "{bad}");
        }
    }
}
