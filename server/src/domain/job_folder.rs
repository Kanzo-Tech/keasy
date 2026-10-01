/// The folder a job's output lands in under the sink: one path segment the
/// member chose, spelled so it is the same on every store and in every URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobFolder(String);

const MAX_LEN: usize = 63;

impl JobFolder {
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
        if s.len() > MAX_LEN {
            return Err(format!("a folder is at most {MAX_LEN} characters"));
        }
        Ok(Self(s.to_string()))
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl AsRef<str> for JobFolder {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::JobFolder;

    #[test]
    fn a_folder_is_one_lowercase_slug() {
        for ok in ["people", "hr-2026", "0", "a-", &"x".repeat(63)] {
            assert!(JobFolder::parse(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "-lead",
            "Upper",
            "a b",
            "a/b",
            "..",
            "a_b",
            "ñ",
            &"x".repeat(64),
        ] {
            assert!(JobFolder::parse(bad).is_err(), "{bad:?}");
        }
    }
}
