/// A credential's or a connection's name: its primary key, a URL path segment,
/// and — for a connection — what a program writes after `@`. A job's name is
/// spelled by the same rule: one name rule across keasy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceName(String);

impl ResourceName {
    /// What [`parse`](Self::parse) accepts, as the spec publishes it: an
    /// ECMA-262 pattern a form runs with the `u` flag, beside [`MAX_LEN`](Self::MAX_LEN)
    /// counted in characters. `\p{White_Space}` is `str::trim`'s whitespace,
    /// where `\s` would also refuse U+FEFF; `\p{Cc}` is `char::is_control`.
    pub const PATTERN: &str =
        r"^[^\p{White_Space}/@\\\p{Cc}](?:[^/@\\\p{Cc}]*[^\p{White_Space}/@\\\p{Cc}])?$";
    pub const MAX_LEN: usize = 100;

    pub fn parse(s: &str) -> Result<Self, String> {
        if s.trim().is_empty() {
            return Err("a name is required".into());
        }
        if s.trim() != s {
            return Err(format!("{s:?} starts or ends with whitespace"));
        }
        if s.chars().count() > Self::MAX_LEN {
            return Err(format!("a name is at most {} characters", Self::MAX_LEN));
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

impl utoipa::PartialSchema for ResourceName {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{ObjectBuilder, Type};
        ObjectBuilder::new()
            .schema_type(Type::String)
            .description(Some(
                "A credential's, a connection's or a job's name: no leading or trailing \
                 whitespace, and no `/`, `@`, `\\` or control character.",
            ))
            .pattern(Some(Self::PATTERN))
            .min_length(Some(1))
            .max_length(Some(Self::MAX_LEN))
            .into()
    }
}

impl utoipa::ToSchema for ResourceName {}

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

    const OK: [&str; 4] = ["minio", "MinIO dev bucket", "hr-data_2", "claude-fast"];
    const BAD: [&str; 7] = ["", "  ", " lead", "trail ", "a/b", "@a", "a\nb"];

    #[test]
    fn a_name_is_what_a_reference_can_spell() {
        for ok in OK.into_iter().chain([&*"x".repeat(100)]) {
            assert!(ResourceName::parse(ok).is_ok(), "{ok}");
        }
        for bad in BAD.into_iter().chain([&*"x".repeat(101)]) {
            assert!(ResourceName::parse(bad).is_err(), "{bad:?}");
        }
    }

    /// The pattern and length the spec publishes accept what `parse` does.
    #[test]
    fn the_published_pattern_is_the_parse_rule() {
        let pattern = regex::Regex::new(ResourceName::PATTERN).unwrap();
        let more = [
            "x".repeat(100),
            "x".repeat(101),
            "é".repeat(100),
            "é".repeat(101),
            "a".into(),
            "a b".into(),
            "a\\b".into(),
            "a\u{7f}b".into(),
            "a\u{85}".into(),
            "\u{a0}a".into(),
            "a\u{3000}".into(),
            "\u{feff}a".into(),
            "a\u{200b}".into(),
            "\t".into(),
            "Ünïcode name".into(),
        ];
        for s in OK.into_iter().chain(BAD).map(String::from).chain(more) {
            let published = pattern.is_match(&s) && s.chars().count() <= ResourceName::MAX_LEN;
            assert_eq!(published, ResourceName::parse(&s).is_ok(), "{s:?}");
        }
    }
}
