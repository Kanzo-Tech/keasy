use serde::{Deserialize, Serialize};

use crate::settings::org::OrgSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcatInput {
    pub job_id: String,
    pub job_name: Option<String>,
    pub completed_at: String,
    pub org: OrgSettings,
    pub datasets: Vec<DatasetInfo>,
    /// Language tag for the catalog (e.g. "en", "es"). Defaults to "en".
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetInfo {
    pub type_name: String,
    pub source_name: Option<String>,
    pub rdf_type: Option<String>,
    pub fields: Vec<FieldInfo>,
    pub distributions: Vec<DistributionInfo>,
    #[serde(default)]
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldInfo {
    pub name: String,
    pub rdf_uri: Option<String>,
    /// XSD/GraphAr datatype from the pipeline spec; `None` ⇒ defaults to string.
    pub datatype: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionInfo {
    pub destination: String,
    pub media_type: String,
}
