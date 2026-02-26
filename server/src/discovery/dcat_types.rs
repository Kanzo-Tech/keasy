use serde::{Deserialize, Serialize};

use crate::settings::org::OrgSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcatInput {
    pub job_id: String,
    pub job_name: Option<String>,
    pub completed_at: String,
    pub org: OrgSettings,
    pub datasets: Vec<DatasetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetInfo {
    pub type_name: String,
    pub source_name: Option<String>,
    pub rdf_subject: Option<String>,
    pub rdf_type: Option<String>,
    pub fields: Vec<FieldInfo>,
    pub distributions: Vec<DistributionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldInfo {
    pub name: String,
    pub rdf_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionInfo {
    pub destination: String,
    pub media_type: String,
}
