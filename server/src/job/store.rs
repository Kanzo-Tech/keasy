use dashmap::DashMap;
use std::sync::Arc;

use super::types::Job;

#[derive(Clone)]
pub struct JobStore {
    jobs: Arc<DashMap<String, Job>>,
}

impl JobStore {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(DashMap::new()),
        }
    }

    pub fn insert(&self, job: Job) {
        self.jobs.insert(job.id.clone(), job);
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.jobs.get(id).map(|entry| entry.clone())
    }

    pub fn update(&self, id: &str, f: impl FnOnce(&mut Job)) -> Option<Job> {
        let mut entry = self.jobs.get_mut(id)?;
        f(&mut entry);
        Some(entry.clone())
    }

    pub fn remove(&self, id: &str) -> Option<Job> {
        self.jobs.remove(id).map(|(_, job)| job)
    }

    pub fn list_all(&self) -> Vec<Job> {
        self.jobs.iter().map(|entry| entry.value().clone()).collect()
    }
}
