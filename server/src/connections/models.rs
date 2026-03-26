use rusqlite::types::{FromSql, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    Data,
    Vocab,
}

impl ConnectionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Vocab => "vocab",
        }
    }
}

impl ToSql for ConnectionKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

impl FromSql for ConnectionKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        Ok(match s {
            "vocab" => Self::Vocab,
            _ => Self::Data,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LocationType {
    Cloud,
    Local,
}

impl LocationType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Cloud => "cloud",
            Self::Local => "local",
        }
    }
}

impl ToSql for LocationType {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

impl FromSql for LocationType {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        Ok(match s {
            "local" => Self::Local,
            _ => Self::Cloud,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub kind: ConnectionKind,
    pub location_type: LocationType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_account_id: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateConnectionRequest {
    pub name: String,
    pub kind: ConnectionKind,
    pub location_type: LocationType,
    pub cloud_account_id: Option<String>,
    pub url: String,
}

impl CreateConnectionRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("name is required".into());
        }
        if self.url.trim().is_empty() {
            return Err("url is required".into());
        }
        if self.location_type == LocationType::Cloud && self.cloud_account_id.is_none() {
            return Err("cloud_account_id is required for cloud connections".into());
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FileSchemaResponse {
    pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UploadFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateConnectionRequest {
    pub name: Option<String>,
    pub kind: Option<ConnectionKind>,
    pub location_type: Option<LocationType>,
    pub cloud_account_id: Option<String>,
    pub url: Option<String>,
}
