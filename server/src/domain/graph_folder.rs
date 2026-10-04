/// The folder a graph's output lands in under the sink: one path segment the
/// member chose, spelled so it is the same on every store and in every URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphFolder(String);

impl GraphFolder {
    /// What [`parse`](Self::parse) accepts, as the spec publishes it: an
    /// ECMA-262 pattern a form runs with the `u` flag, beside [`MAX_LEN`](Self::MAX_LEN).
    pub const PATTERN: &str = "^[a-z0-9][a-z0-9-]*$";
    pub const MAX_LEN: usize = 63;

    pub fn parse(s: &str) -> Result<Self, String> {
        let mut chars = s.chars();
        match chars.next() {
            None => return Err("a folder is required".into()),
            Some(c) if !(c.is_ascii_lowercase() || c.is_ascii_digit()) => {
                return Err(format!(
                    "{s:?} must start with a lowercase letter or a digit"
                ));
            }
            _ => {}
        }
        if let Some(c) =
            chars.find(|c| !(c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-'))
        {
            return Err(format!(
                "{s:?} contains {c:?}: a folder is lowercase letters, digits and '-'"
            ));
        }
        if s.len() > Self::MAX_LEN {
            return Err(format!("a folder is at most {} characters", Self::MAX_LEN));
        }
        Ok(Self(s.to_string()))
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl utoipa::PartialSchema for GraphFolder {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{ObjectBuilder, Type};
        ObjectBuilder::new()
            .schema_type(Type::String)
            .description(Some(
                "The folder a graph's output lands in under the sink: lowercase letters, \
                 digits and `-`, starting with a letter or digit.",
            ))
            .pattern(Some(Self::PATTERN))
            .min_length(Some(1))
            .max_length(Some(Self::MAX_LEN))
            .into()
    }
}

impl utoipa::ToSchema for GraphFolder {}

impl AsRef<str> for GraphFolder {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::GraphFolder;

    const OK: [&str; 4] = ["people", "hr-2026", "0", "a-"];
    const BAD: [&str; 8] = ["", "-lead", "Upper", "a b", "a/b", "..", "a_b", "ñ"];

    #[test]
    fn a_folder_is_one_lowercase_slug() {
        for ok in OK.into_iter().chain([&*"x".repeat(63)]) {
            assert!(GraphFolder::parse(ok).is_ok(), "{ok}");
        }
        for bad in BAD.into_iter().chain([&*"x".repeat(64)]) {
            assert!(GraphFolder::parse(bad).is_err(), "{bad:?}");
        }
    }

    /// The pattern and length the spec publishes accept what `parse` does.
    #[test]
    fn the_published_pattern_is_the_parse_rule() {
        let pattern = regex::Regex::new(GraphFolder::PATTERN).unwrap();
        let x = |n: usize| "x".repeat(n);
        let corpus = OK.into_iter().chain(BAD).map(String::from);
        for s in corpus.chain([x(63), x(64), "a\n".into(), "a-b\u{0}".into()]) {
            let published = pattern.is_match(&s) && s.chars().count() <= GraphFolder::MAX_LEN;
            assert_eq!(published, GraphFolder::parse(&s).is_ok(), "{s:?}");
        }
    }
}
