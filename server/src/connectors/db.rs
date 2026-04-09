use std::collections::HashMap;

use diesel::prelude::*;

use crate::db::diesel_schema::connectors::dsl;
use crate::db::Repos;
use crate::jobs::models::now_iso8601;
use crate::tenant::{Tenant, TenantResource};

use super::models::{
    Connector, ConnectorChangeset, ConnectorRow, CreateConnectorRequest, NewConnector,
    UpdateConnectorRequest,
};
use super::secrets;
use super::types::ConnectorRegistry;

impl Repos {
    pub async fn create_connector(
        &self,
        registry: &ConnectorRegistry,
        tenant: &Tenant,
        req: CreateConnectorRequest,
    ) -> Result<Connector, String> {
        let now = now_iso8601();
        let (public_config, secret_values) =
            secrets::split(registry, &req.connector_type, &req.config);
        let config_json =
            serde_json::to_string(&public_config).map_err(|e| format!("invalid config JSON: {e}"))?;

        let new = NewConnector {
            id: uuid::Uuid::new_v4().to_string(),
            organization_id: tenant.org_id.as_str().to_string(),
            name: req.name,
            connector_type: req.connector_type,
            direction: req.direction.as_str().to_string(),
            config: config_json,
            created_at: now.clone(),
            updated_at: now,
        };

        let row: ConnectorRow = self
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

        // Store secrets
        if !secret_values.is_empty() {
            let blob =
                serde_json::to_string(&secret_values).map_err(|e| format!("serialize secrets: {e}"))?;
            self.set_secret(&secrets::key_for(&row.id), blob.as_bytes())
                .await;
        }

        let mut connector: Connector = row.into();
        connector.config = req.config; // return full config including secrets
        Ok(connector)
    }

    pub async fn get_connector(&self, resource: &TenantResource<'_>) -> Option<Connector> {
        let rid = resource.id.to_string();
        let org = resource.org_id.as_str().to_string();
        self.diesel_pool
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

    /// Get connector with secrets merged back — for internal use (storage ops, credential building).
    pub async fn get_connector_full(&self, resource: &TenantResource<'_>) -> Option<Connector> {
        let mut connector = self.get_connector(resource).await?;
        secrets::merge_from_db(self, &mut connector).await;
        Some(connector)
    }

    /// Get connector with secret fields redacted — for API responses.
    pub async fn get_connector_redacted(
        &self,
        registry: &ConnectorRegistry,
        resource: &TenantResource<'_>,
    ) -> Option<Connector> {
        let mut connector = self.get_connector(resource).await?;
        connector.config = secrets::redact(registry, &connector.connector_type, &connector.config);
        Some(connector)
    }

    pub async fn list_connectors(
        &self,
        tenant: &Tenant,
        direction_filter: Option<&str>,
    ) -> Vec<Connector> {
        let org = tenant.org_id.as_str().to_string();
        let dir = direction_filter.map(|d| d.to_string());

        let Ok(pc) = self.diesel_pool.get().await else {
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

                query.select(ConnectorRow::as_select()).load::<ConnectorRow>(conn)
            })
            .await;

        match result {
            Ok(Ok(rows)) => rows.into_iter().map(Connector::from).collect(),
            _ => vec![],
        }
    }

    /// List connectors with secret fields redacted — for API responses.
    pub async fn list_connectors_redacted(
        &self,
        registry: &ConnectorRegistry,
        tenant: &Tenant,
        direction_filter: Option<&str>,
    ) -> Vec<Connector> {
        let mut connectors = self.list_connectors(tenant, direction_filter).await;
        for c in &mut connectors {
            c.config = secrets::redact(registry, &c.connector_type, &c.config);
        }
        connectors
    }

    pub async fn update_connector(
        &self,
        registry: &ConnectorRegistry,
        resource: &TenantResource<'_>,
        req: UpdateConnectorRequest,
    ) -> Result<Option<Connector>, String> {
        let existing = self.get_connector(resource).await;
        let Some(mut connector) = existing else {
            return Ok(None);
        };

        if let Some(name) = req.name {
            connector.name = name;
        }
        if let Some(connector_type) = req.connector_type {
            connector.connector_type = connector_type;
        }
        if let Some(direction) = req.direction {
            connector.direction = direction;
        }

        // Handle config update with secret preservation
        if let Some(new_config) = req.config {
            let mut existing_secrets = HashMap::new();
            if let Some(bytes) = self.get_secret(&secrets::key_for(&connector.id)).await {
                if let Ok(s) = serde_json::from_slice::<HashMap<String, String>>(&bytes) {
                    existing_secrets = s;
                }
            }

            let secret_names = secrets::field_names(registry, &connector.connector_type);
            let mut full_config = new_config.clone();
            if let Some(obj) = full_config.as_object_mut() {
                for name in secret_names {
                    match obj.get(*name) {
                        Some(serde_json::Value::Bool(true)) => {
                            if let Some(existing_val) = existing_secrets.get(*name) {
                                obj.insert(
                                    (*name).to_string(),
                                    serde_json::Value::String(existing_val.clone()),
                                );
                            } else {
                                obj.remove(*name);
                            }
                        }
                        _ => {}
                    }
                }
            }

            let (public_config, new_secrets) =
                secrets::split(registry, &connector.connector_type, &full_config);
            connector.config = public_config;

            if new_secrets.is_empty() {
                self.delete_secret(&secrets::key_for(&connector.id)).await;
            } else {
                let blob = serde_json::to_string(&new_secrets)
                    .map_err(|e| format!("serialize secrets: {e}"))?;
                self.set_secret(&secrets::key_for(&connector.id), blob.as_bytes())
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

        self.diesel_pool
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

    pub async fn delete_connector(&self, resource: &TenantResource<'_>) -> bool {
        self.delete_secret(&secrets::key_for(resource.id)).await;

        let rid = resource.id.to_string();
        let org = resource.org_id.as_str().to_string();

        let result = self
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
