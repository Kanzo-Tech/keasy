pub mod db;
pub mod errors;
pub mod models;
pub mod routes;

/// Where a job's output lives: the destination the member chose, plus the job's
/// own id. **This is the one place keasy composes an output path**, and it is
/// keasy's to compose — a job's home is the host's decision, not the language's.
/// Everything below it (relation names, file names, tile names) belongs to
/// fossil and travels from fossil.
pub fn dataset_dest(base: &str, job_id: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), job_id)
}
