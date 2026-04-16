use std::sync::Arc;

use diesel::prelude::*;
use crate::db::diesel_schema::connectors::dsl;
use crate::db::Repos;
use crate::executor::path_resolver::{ConnectorEntry, KeasyPathResolver, PathResolver};
use crate::tenant::Tenant;

use crate::connectors::models::{Connector, ConnectorRow};
use crate::connectors::secrets;

impl Repos {
    async fn resolve_connectors(
        &self,
        tenant: &Tenant,
        connector_ids: &[String],
    ) -> Result<Vec<Connector>, String> {
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

        for connector in &mut rows {
            secrets::merge_from_db(self, connector).await;
        }

        for id in connector_ids {
            if !rows.iter().any(|c| c.id == *id) {
                return Err(format!("connector not found: {id}"));
            }
        }

        Ok(rows)
    }

    pub async fn build_path_resolver(
        &self,
        tenant: &Tenant,
        connector_ids: &[String],
    ) -> Result<Arc<dyn PathResolver>, String> {
        let connectors = self
            .resolve_connectors(tenant, connector_ids)
            .await?;
        let entries = connectors
            .iter()
            .map(build_entry)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Arc::new(KeasyPathResolver::new(entries)))
    }
}

fn build_entry(c: &Connector) -> Result<ConnectorEntry, String> {
    let cc = c.parse_config()?;
    let (store, _prefix) = cc.build_store()?;
    Ok(ConnectorEntry {
        name: c.name.clone(),
        base_url: cc.base_url(),
        store,
        secret_spec: cc.duckdb_secret(),
    })
}
