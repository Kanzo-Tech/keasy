use std::collections::HashMap;

use async_trait::async_trait;
use diesel::prelude::*;
use serde_json::Value;

use crate::db::diesel_schema::connectors::dsl;
use crate::db::Repos;
use crate::jobs::models::now_iso8601;
use crate::tenant::{Tenant, TenantResource};

use super::models::{
    Connector, ConnectorChangeset, ConnectorRow, CreateConnectorRequest, NewConnector,
    UpdateConnectorRequest,
};
use super::repository::ConnectorRepository;

// ── DieselConnectorRepo ─────────────────────────────────────────────

pub struct DieselConnectorRepo {
    repos: Repos,
}

impl DieselConnectorRepo {
    pub fn new(repos: Repos) -> Self {
        Self { repos }
    }
}

#[async_trait]
impl ConnectorRepository for DieselConnectorRepo {
    async fn create(&self, tenant: &Tenant, req: CreateConnectorRequest) -> Result<Connector, String> {
        let now = now_iso8601();
        let connector_type = req.config.kind().to_string();
        let config_value = serde_json::to_value(&req.config)
            .map_err(|e| format!("serialize config: {e}"))?;
        let (public_config, secret_values) = split(&connector_type, config_value);
        let config_json = serde_json::to_string(&public_config)
            .map_err(|e| format!("invalid config JSON: {e}"))?;

        let new = NewConnector {
            id: uuid::Uuid::new_v4().to_string(),
            organization_id: tenant.org_id.as_str().to_string(),
            name: req.name,
            connector_type,
            direction: req.direction.as_str().to_string(),
            config: config_json,
            created_at: now.clone(),
            updated_at: now,
        };

        let row: ConnectorRow = self
            .repos
            .diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(dsl::connectors)
                    .values(&new)
                    .returning(ConnectorRow::as_returning())
                    .get_result(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("insert: {e}"))?;

        if !secret_values.is_empty() {
            let blob = serde_json::to_string(&secret_values)
                .map_err(|e| format!("serialize secrets: {e}"))?;
            self.repos
                .set_secret(&secret_key_for(&row.id), blob.as_bytes())
                .await;
        }

        let mut connector: Connector = row.into();
        connector.config = merge_secrets(public_config, &secret_values);
        Ok(connector)
    }

    async fn get(&self, resource: &TenantResource<'_>) -> Option<Connector> {
        let rid = resource.id.to_string();
        let org = resource.org_id.as_str().to_string();
        self.repos
            .diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                dsl::connectors
                    .filter(dsl::id.eq(&rid).and(dsl::organization_id.eq(&org)))
                    .select(ConnectorRow::as_select())
                    .first::<ConnectorRow>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
            .map(Connector::from)
    }

    async fn get_with_secrets(&self, resource: &TenantResource<'_>) -> Option<Connector> {
        let mut connector = self.get(resource).await?;
        merge_secrets_from_db(&self.repos, &mut connector).await;
        Some(connector)
    }

    async fn list(&self, tenant: &Tenant, direction_filter: Option<&str>) -> Vec<Connector> {
        let org = tenant.org_id.as_str().to_string();
        let dir = direction_filter.map(|d| d.to_string());

        let Ok(pc) = self.repos.diesel_pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(move |conn| {
                let mut query = dsl::connectors
                    .filter(dsl::organization_id.eq(&org))
                    .order(dsl::name.asc())
                    .into_boxed();

                if let Some(ref d) = dir {
                    query = query.filter(dsl::direction.eq(d));
                }

                query
                    .select(ConnectorRow::as_select())
                    .load::<ConnectorRow>(conn)
            })
            .await;

        match result {
            Ok(Ok(rows)) => rows.into_iter().map(Connector::from).collect(),
            _ => vec![],
        }
    }

    async fn update(
        &self,
        resource: &TenantResource<'_>,
        req: UpdateConnectorRequest,
    ) -> Result<Option<Connector>, String> {
        let Some(mut connector) = self.get_with_secrets(resource).await else {
            return Ok(None);
        };

        if let Some(name) = req.name {
            connector.name = name;
        }
        if let Some(direction) = req.direction {
            connector.direction = direction;
        }

        if let Some(new_config) = req.config {
            let existing_config = serde_json::from_value::<super::config::ConnectorConfig>(
                connector.config.clone(),
            )
            .map_err(|e| format!("parse existing config: {e}"))?;

            let merged = new_config.merge_existing_secrets(&existing_config);
            let connector_type = merged.kind().to_string();
            let config_value = serde_json::to_value(&merged)
                .map_err(|e| format!("serialize config: {e}"))?;
            let (public_config, new_secrets) = split(&connector_type, config_value);
            connector.config = public_config;
            connector.connector_type = connector_type;

            if new_secrets.is_empty() {
                self.repos
                    .delete_secret(&secret_key_for(&connector.id))
                    .await;
            } else {
                let blob = serde_json::to_string(&new_secrets)
                    .map_err(|e| format!("serialize secrets: {e}"))?;
                self.repos
                    .set_secret(&secret_key_for(&connector.id), blob.as_bytes())
                    .await;
            }
        }

        connector.updated_at = now_iso8601();

        let config_json = serde_json::to_string(&connector.config)
            .map_err(|e| format!("invalid config JSON: {e}"))?;

        let changeset = ConnectorChangeset {
            name: Some(connector.name.clone()),
            connector_type: Some(connector.connector_type.clone()),
            direction: Some(connector.direction.as_str().to_string()),
            config: Some(config_json),
            updated_at: Some(connector.updated_at.clone()),
        };

        let rid = resource.id.to_string();
        let org = resource.org_id.as_str().to_string();

        self.repos
            .diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::update(
                    dsl::connectors.filter(dsl::id.eq(&rid).and(dsl::organization_id.eq(&org))),
                )
                .set(&changeset)
                .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("update: {e}"))?;

        Ok(Some(connector))
    }

    async fn delete(&self, resource: &TenantResource<'_>) -> bool {
        self.repos
            .delete_secret(&secret_key_for(resource.id))
            .await;

        let rid = resource.id.to_string();
        let org = resource.org_id.as_str().to_string();

        let result = self
            .repos
            .diesel_pool
            .get()
            .await
            .ok()
            .map(|pc| async move {
                pc.interact(move |conn| {
                    diesel::delete(
                        dsl::connectors
                            .filter(dsl::id.eq(&rid).and(dsl::organization_id.eq(&org))),
                    )
                    .execute(conn)
                })
                .await
            });

        match result {
            Some(fut) => match fut.await {
                Ok(Ok(rows)) => rows > 0,
                _ => false,
            },
            None => false,
        }
    }
}

// ── Secret split/merge (absorbed from secrets.rs) ───────────────────

fn field_names_for_kind(kind: &str) -> &'static [&'static str] {
    match kind {
        "s3" => &["secret_access_key", "session_token"],
        "gcs" => &["service_account_json", "hmac_secret"],
        "azure_blob" => &["connection_string"],
        _ => &[],
    }
}

fn split(connector_type: &str, config: Value) -> (Value, HashMap<String, String>) {
    let secret_names = field_names_for_kind(connector_type);
    let mut public = config;
    let mut secrets = HashMap::new();
    if let Some(obj) = public.as_object_mut() {
        for name in secret_names {
            if let Some(val) = obj.remove(*name) {
                if let Some(s) = val.as_str() {
                    secrets.insert((*name).to_string(), s.to_string());
                }
            }
        }
    }
    (public, secrets)
}

fn merge_secrets(config: Value, secrets: &HashMap<String, String>) -> Value {
    let mut merged = config;
    if let Some(obj) = merged.as_object_mut() {
        for (k, v) in secrets {
            obj.insert(k.clone(), Value::String(v.clone()));
        }
    }
    merged
}

pub fn secret_key_for(connector_id: &str) -> String {
    format!("connector:{connector_id}")
}

pub async fn merge_secrets_from_db(repos: &Repos, connector: &mut Connector) {
    if let Some(bytes) = repos.get_secret(&secret_key_for(&connector.id)).await {
        if let Ok(secrets) = serde_json::from_slice::<HashMap<String, String>>(&bytes) {
            connector.config = merge_secrets(std::mem::take(&mut connector.config), &secrets);
        }
    }
}
