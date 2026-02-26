use fossil_lang::runtime::storage::StorageConfig;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use crate::db::Database;
use crate::settings::types::Connection;
use crate::tenant::TenantScoped;

pub struct ResolvedScript {
    pub script: String,
    pub storage: StorageConfig,
}

struct ConnectionRef {
    connection_name: String,
}

static REF_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"@([a-zA-Z0-9_-]+)/([a-zA-Z0-9_./-]+)").unwrap()
});

static STRING_LITERAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#""([^"\\]|\\.)*""#).unwrap()
});

pub async fn resolve(script: &str, db: &Database) -> Result<ResolvedScript, String> {
    validate_no_direct_paths(script)?;

    let refs = parse_refs(script);
    let mut connection_map = HashMap::new();
    for r in &refs {
        if !connection_map.contains_key(&r.connection_name) {
            // Phase 1 placeholder — Phase 4 will pass real org_id from session
            let ctx = TenantScoped::placeholder_with(r.connection_name.as_str());
            if let Some(connection) = db.get_connection_by_name(&ctx).await {
                connection_map.insert(connection.name.clone(), connection);
            }
        }
    }

    let resolved = if !refs.is_empty() {
        rewrite(script, &connection_map)?
    } else {
        script.to_string()
    };

    let account_ids: Vec<String> = connection_map
        .values()
        .filter_map(|c| c.cloud_account_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    // Phase 1 placeholder — Phase 4 will pass real org_id from session
    let ctx = TenantScoped::placeholder();
    let storage = db.build_storage_config(&ctx, &account_ids).await;

    Ok(ResolvedScript {
        script: resolved,
        storage,
    })
}

fn parse_refs(script: &str) -> Vec<ConnectionRef> {
    REF_PATTERN
        .captures_iter(script)
        .map(|cap| ConnectionRef {
            connection_name: cap[1].to_string(),
        })
        .collect()
}

fn rewrite(
    script: &str,
    connections: &HashMap<String, Connection>,
) -> Result<String, String> {
    let rewritten = REF_PATTERN.replace_all(script, |caps: &regex::Captures| {
        let connection_name = &caps[1];
        let path = &caps[2];

        match connections.get(connection_name) {
            Some(connection) => {
                let base = connection.url.trim_end_matches('/');
                let clean_path = path.trim_start_matches('/');
                format!("\"{base}/{clean_path}\"")
            }
            None => {
                caps[0].to_string()
            }
        }
    });

    let missing: Vec<String> = REF_PATTERN
        .captures_iter(rewritten.as_ref())
        .filter_map(|cap| {
            let name = &cap[1];
            if !connections.contains_key(name) {
                Some(name.to_string())
            } else {
                None
            }
        })
        .collect();

    if !missing.is_empty() {
        let unique: Vec<String> = missing.into_iter().collect::<HashSet<_>>().into_iter().collect();
        return Err(format!("Unknown connection references: {}", unique.join(", ")));
    }

    Ok(rewritten.into_owned())
}

fn validate_no_direct_paths(script: &str) -> Result<(), String> {
    for m in STRING_LITERAL.find_iter(script) {
        let content = &m.as_str()[1..m.as_str().len() - 1];
        if crate::cloud::is_data_path(content) {
            return Err(format!(
                "Direct file paths are not supported. Use @connection/path syntax instead: {}",
                m.as_str()
            ));
        }
    }
    Ok(())
}
