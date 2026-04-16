use std::sync::Arc;

use diesel::prelude::*;
use crate::db::diesel_schema::connectors::dsl;
use crate::db::Repos;
use crate::jobs::path_resolver::{ConnectorEntry, KeasyPathResolver, PathResolver};
use crate::tenant::Tenant;

use super::models::{Connector, ConnectorRow};
use super::secrets;
use super::types::{ConnectorRegistry, ConnectorType};

impl Repos {
    /// Bulk-fetch connectors by IDs (single query) and resolve their types.
    async fn resolve_connectors<'a>(
        &self,
        registry: &'a ConnectorRegistry,
        tenant: &Tenant,
        connector_ids: &[String],
    ) -> Result<Vec<(Connector, &'a Arc<dyn ConnectorType>)>, String> {
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

    /// Build a `PathResolver` for a job from explicit connector IDs. For
    /// each connector this constructs the `Arc<dyn CloudStore>` and the
    /// `DuckDbSecretSpec` once and stashes them in a `ConnectorEntry`,
    /// so the runner can install secrets and resolve paths without
    /// re-touching the registry or rebuilding stores per request.
    pub async fn build_path_resolver(
        &self,
        registry: &ConnectorRegistry,
        tenant: &Tenant,
        connector_ids: &[String],
    ) -> Result<Arc<dyn PathResolver>, String> {
        let resolved = self
            .resolve_connectors(registry, tenant, connector_ids)
            .await?;
        let entries = resolved
            .into_iter()
            .map(|(c, ct)| build_entry(&c, ct))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Arc::new(KeasyPathResolver::new(entries)))
    }
}

/// Project a `(Connector, ConnectorType)` pair into the `ConnectorEntry`
/// that the path resolver and the rest of the job lifecycle consume.
/// Single point where credentials cross from the JSON config into runtime
/// state — `build_store` and `duckdb_secret` are both called once here.
fn build_entry(c: &Connector, ct: &Arc<dyn ConnectorType>) -> Result<ConnectorEntry, String> {
    let (store, _prefix) = ct.build_store(&c.config)?;
    Ok(ConnectorEntry {
        name: c.name.clone(),
        base_url: ct.base_url(&c.config),
        store,
        secret_spec: ct.duckdb_secret(&c.config),
    })
}
