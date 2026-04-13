use std::sync::Arc;

use diesel::prelude::*;
use fossil_lang::resolver::PathResolver;

use crate::db::diesel_schema::connectors::dsl;
use crate::db::Repos;
use crate::jobs::path_resolver::KeasyPathResolver;
use crate::tenant::Tenant;

use super::models::{Connector, ConnectorRow};
use super::secrets;
use super::types::ConnectorRegistry;

impl Repos {
    /// Bulk-fetch connectors by IDs (single query) and resolve their types.
    async fn resolve_connectors<'a>(
        &self,
        registry: &'a ConnectorRegistry,
        tenant: &Tenant,
        connector_ids: &[String],
    ) -> Result<
        Vec<(
            Connector,
            &'a Arc<dyn super::types::ConnectorType>,
        )>,
        String,
    > {
        if connector_ids.is_empty() {
            return Ok(vec![]);
        }

        let ids_owned: Vec<String> = connector_ids.to_vec();
        let org = tenant.org_id.as_str().to_string();

        let mut rows: Vec<Connector> = {
            let pc = self
                .diesel_pool
                .get()
                .await
                .map_err(|e| format!("pool: {e}"))?;
            let db_rows: Vec<ConnectorRow> = pc
                .interact(move |conn| {
                    dsl::connectors
                        .filter(
                            dsl::id
                                .eq_any(&ids_owned)
                                .and(dsl::organization_id.eq(&org)),
                        )
                        .order(dsl::name.asc())
                        .select(ConnectorRow::as_select())
                        .load::<ConnectorRow>(conn)
                })
                .await
                .map_err(|e| format!("interact: {e}"))?
                .map_err(|e| format!("query: {e}"))?;

            db_rows.into_iter().map(Connector::from).collect()
        };

        // Merge secrets for each connector
        for connector in &mut rows {
            secrets::merge_from_db(self, connector).await;
        }

        // Validate all requested IDs were found
        for id in connector_ids {
            if !rows.iter().any(|c| c.id == *id) {
                return Err(format!("connector not found: {id}"));
            }
        }

        // Resolve connector types
        rows.into_iter()
            .map(|c| {
                let ct = registry
                    .get(&c.connector_type)
                    .ok_or_else(|| format!("unknown connector type: {}", c.connector_type))?;
                Ok((c, ct))
            })
            .collect()
    }

    /// Build a PathResolver from specific connector IDs.
    pub async fn build_path_resolver(
        &self,
        registry: &ConnectorRegistry,
        tenant: &Tenant,
        connector_ids: &[String],
    ) -> Result<Arc<dyn PathResolver>, String> {
        let resolved = self
            .resolve_connectors(registry, tenant, connector_ids)
            .await?;
        let entries: Vec<_> = resolved
            .iter()
            .map(|(c, ct)| {
                (
                    c.name.clone(),
                    ct.base_url(&c.config),
                    ct.cloud_config(&c.config),
                )
            })
            .collect();
        Ok(Arc::new(KeasyPathResolver::from_connectors(entries)))
    }

    /// Build a PathResolver from ALL connectors in an org.
    pub async fn build_path_resolver_for_org(
        &self,
        registry: &ConnectorRegistry,
        tenant: &Tenant,
    ) -> Result<Arc<dyn PathResolver>, String> {
        let mut connectors = self.list_connectors(tenant, None).await;
        // Merge secrets for each connector
        for connector in &mut connectors {
            secrets::merge_from_db(self, connector).await;
        }
        let entries: Vec<_> = connectors
            .iter()
            .filter_map(|c| {
                let ct = registry.get(&c.connector_type)?;
                Some((
                    c.name.clone(),
                    ct.base_url(&c.config),
                    ct.cloud_config(&c.config),
                ))
            })
            .collect();
        Ok(Arc::new(KeasyPathResolver::from_connectors(entries)))
    }

    /// Build a signing-capable store for a job's output URL.
    pub async fn build_signing_store_for_job(
        &self,
        registry: &ConnectorRegistry,
        tenant: &Tenant,
        connector_ids: &[String],
        target_url: &str,
    ) -> Result<(super::types::CloudStore, object_store::path::Path), String> {
        let resolved = self
            .resolve_connectors(registry, tenant, connector_ids)
            .await?;
        for (c, ct) in &resolved {
            let base = ct.base_url(&c.config);
            if target_url.starts_with(&base) {
                let (store, connector_prefix) = ct.build_store(&c.config)?;
                // Append the sub-path from rdf_base that goes beyond the connector's base_url
                let sub = target_url[base.len()..].trim_start_matches('/');
                let full_prefix = if connector_prefix.as_ref().is_empty() {
                    object_store::path::Path::from(sub)
                } else if sub.is_empty() {
                    connector_prefix
                } else {
                    object_store::path::Path::from(format!("{connector_prefix}/{sub}"))
                };
                return Ok((store, full_prefix));
            }
        }
        Err(format!("no connector found matching URL: {target_url}"))
    }
}
