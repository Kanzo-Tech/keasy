use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// What a probe tried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    /// Listed under a storage URL.
    List,
    /// Wrote an object under a sink.
    Write,
    /// Deleted the object the write left.
    Delete,
    /// Listed the provider's models.
    Models,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Pass,
    Fail,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Check {
    pub operation: Operation,
    pub result: Outcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// One probe of a credential or a connection, check by check.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ValidationReport {
    pub at: String,
    pub results: Vec<Check>,
}

impl ValidationReport {
    /// No check failed.
    pub fn passed(&self) -> bool {
        self.results.iter().all(|c| c.result != Outcome::Fail)
    }

    /// The failed checks, one line each.
    pub fn failures(&self) -> String {
        self.results
            .iter()
            .filter(|c| c.result == Outcome::Fail)
            .map(|c| {
                format!(
                    "{:?} failed: {}",
                    c.operation,
                    c.message.as_deref().unwrap_or("no detail")
                )
            })
            .collect::<Vec<_>>()
            .join("; ")
    }
}
