/// A credential's or a connection's name: its primary key, a URL path segment,
/// and — for a connection — what a program writes after `@`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceName(String);

const MAX_LEN: usize = 100;

impl ResourceName {
    pub fn parse(s: &str) -> Result<Self, String> {
        if s.trim().is_empty() {
            return Err("a name is required".into());
        }
        if s.trim() != s {
            return Err(format!("{s:?} starts or ends with whitespace"));
        }
        if s.chars().count() > MAX_LEN {
            return Err(format!("a name is at most {MAX_LEN} characters"));
        }
        if let Some(c) = s
            .chars()
            .find(|c| matches!(c, '/' | '@' | '\\') || c.is_control())
        {
            return Err(format!("{s:?} contains {c:?}, which a name may not"));
        }
        Ok(Self(s.to_string()))
    }
}

impl AsRef<str> for ResourceName {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ResourceName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::ResourceName;

    #[test]
    fn a_name_is_what_a_reference_can_spell() {
        for ok in ["minio", "MinIO dev bucket", "hr-data_2", "claude-fast"] {
            assert!(ResourceName::parse(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "  ",
            " lead",
            "trail ",
            "a/b",
            "@a",
            "a\nb",
            &"x".repeat(101),
        ] {
            assert!(ResourceName::parse(bad).is_err(), "{bad:?}");
        }
    }
}
