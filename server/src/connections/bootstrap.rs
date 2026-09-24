//! The connections the environment declares, ensured at boot.
//!
//! `KEASY_BOOTSTRAP_CONNECTION_URL` and `_NAME` name a store this instance
//! should already know about the first time anyone opens it — in dev, the MinIO
//! bucket the compose overlay seeds. `KEASY_BOOTSTRAP_SINK_URL` names where job
//! output lands: the workspace sink, which belongs to the owner, so declaring it
//! here is what keeps trying a job in dev from needing a second login.
//! `KEASY_BOOTSTRAP_VOCAB_URL` and `_NAME` name where the SHAPES live — a
//! `vocab` connection, which is the kind the editor offers as a vocabulary and
//! the schema introspector deliberately skips. It is a separate prefix and not
//! the data bucket because a connection IS a prefix: pointed at the same place,
//! the two would list each other's files and the Vocabulary tab would offer
//! CSVs.
//!
//! The credentials are read from the env vars the provider schema already
//! declares for its own fields (`AWS_ACCESS_KEY_ID`, `AZURE_STORAGE_ACCOUNT_NAME`,
//! …), so declaring a connection invents no second vocabulary, and they travel
//! the ordinary `create_cloud_account` path — split into fields and secrets by
//! the schema, and encrypted. Both connections share the one declared account.
//!
//! Idempotent and non-fatal: an existing connection, sink or account is left
//! exactly as it is, and anything that goes wrong is logged and skipped — the
//! instance serves without it, and the next boot tries again.

use std::collections::HashMap;

use tracing::{error, info, warn};

use crate::cloud::models::CreateCloudAccountRequest;
use crate::cloud::reader;
use crate::db::{Database, DbResult};

use super::models::{ConnectionKind, CreateConnectionRequest, Direction, LocationType, SINK_NAME};

/// What a write check leaves behind and takes away again. Named so that a
/// reader of the bucket knows what it was, should the delete not land.
const WRITE_CHECK_OBJECT: &str = "keasy-sink-write-check";

pub async fn ensure_declared_connections(db: &Database) {
    if let Err(e) = declare_all(db).await {
        error!(error = %e, "declared connections: skipped");
    }
}

async fn declare_all(db: &Database) -> DbResult<()> {
    let (Some(name), Some(url)) = (
        env_nonblank("KEASY_BOOTSTRAP_CONNECTION_NAME"),
        env_nonblank("KEASY_BOOTSTRAP_CONNECTION_URL"),
    ) else {
        return Ok(());
    };

    let sink_url = env_nonblank("KEASY_BOOTSTRAP_SINK_URL");
    // Both halves or neither: a vocab connection is a NAME (programs reference
    // it as `@name/shape.shex`) at a URL, and half of that is not a connection.
    let vocab =
        env_nonblank("KEASY_BOOTSTRAP_VOCAB_NAME").zip(env_nonblank("KEASY_BOOTSTRAP_VOCAB_URL"));

    let needs_source = db.get_connection_by_name(&name).await?.is_none();
    let needs_vocab = match &vocab {
        Some((vocab_name, _)) => db.get_connection_by_name(vocab_name).await?.is_none(),
        None => false,
    };
    let needs_sink = match (&sink_url, db.get_sink_connection().await?) {
        (Some(_), Some(existing)) => {
            // One sink per workspace, and this one is already somebody's answer.
            info!(name = %existing.name, url = %existing.url, "declared sink: one already exists, left untouched");
            false
        }
        (Some(_), None) => true,
        (None, _) => false,
    };
    if !needs_source && !needs_vocab && !needs_sink {
        return Ok(());
    }

    let Some(account_id) = ensure_account(db, &name, &url).await? else {
        return Ok(());
    };
    let creds = db
        .build_storage_config(std::slice::from_ref(&account_id))
        .await?;

    if needs_source {
        declare(
            db,
            &creds,
            &account_id,
            &name,
            &url,
            ConnectionKind::Data,
            Direction::Source,
        )
        .await;
    }
    if let (true, Some((vocab_name, vocab_url))) = (needs_vocab, &vocab) {
        declare(
            db,
            &creds,
            &account_id,
            vocab_name,
            vocab_url,
            ConnectionKind::Vocab,
            Direction::Source,
        )
        .await;
    }
    if let (true, Some(sink_url)) = (needs_sink, sink_url) {
        declare(
            db,
            &creds,
            &account_id,
            SINK_NAME,
            &sink_url,
            ConnectionKind::Data,
            Direction::Sink,
        )
        .await;
    }
    Ok(())
}

/// The declared cloud account: the one already named so, or a new one built
/// from the provider's own env vars.
async fn ensure_account(db: &Database, name: &str, url: &str) -> DbResult<Option<String>> {
    if let Some(existing) = db
        .list_cloud_accounts()
        .await?
        .into_iter()
        .find(|a| a.name == name)
    {
        return Ok(Some(existing.id));
    }

    let provider = match crate::cloud::parse_cloud_url(url) {
        Ok((_, _, provider)) => provider,
        Err(e) => {
            error!(%url, error = %e, "declared connection: not a usable cloud URL");
            return Ok(None);
        }
    };

    let auth_method = env_nonblank("KEASY_BOOTSTRAP_CONNECTION_AUTH_METHOD");
    let mut fields = HashMap::new();
    for field in provider.active_fields(auth_method.as_deref()) {
        if let Some(env_var) = field.env_var
            && let Some(value) = env_nonblank(env_var)
        {
            fields.insert(field.name.to_string(), value);
        }
    }

    let request = CreateCloudAccountRequest {
        name: name.to_string(),
        provider_id: provider.id.to_string(),
        auth_method,
        fields,
    };
    Ok(Some(db.create_cloud_account(request).await?.id))
}

/// Prove the access the direction needs, then write the row. A source nobody
/// can read is not a connection; a sink nobody can write to is worse, because
/// it only says so at the end of a job.
async fn declare(
    db: &Database,
    creds: &HashMap<String, String>,
    account_id: &str,
    name: &str,
    url: &str,
    kind: ConnectionKind,
    direction: Direction,
) {
    let reachable = match direction {
        Direction::Source => reader::list_files(url, creds).await.map(|_| ()),
        Direction::Sink => write_check(url, creds).await,
    };
    if let Err(e) = reachable {
        error!(%name, %url, error = %e, "declared connection: store unusable for this direction");
        return;
    }

    let request = CreateConnectionRequest {
        name: name.to_string(),
        kind,
        location_type: LocationType::Cloud,
        direction,
        cloud_account_id: Some(account_id.to_string()),
        url: url.to_string(),
    };
    match db.create_connection(request).await {
        Ok(c) => {
            info!(%name, %url, kind = c.kind.as_str(), direction = direction.as_str(), "declared connection ready")
        }
        Err(e) => error!(%name, error = %e, "declared connection: rejected"),
    }
}

/// Put an object where output will go, then take it away. A listing would only
/// prove the credentials can read.
async fn write_check(base_url: &str, creds: &HashMap<String, String>) -> Result<(), String> {
    let probe = format!("{}/{WRITE_CHECK_OBJECT}", base_url.trim_end_matches('/'));
    reader::upload(&probe, Vec::new(), creds).await?;
    if let Err(e) = reader::delete(&probe, creds).await {
        warn!(url = %probe, error = %e, "declared sink: the write check could not clean up after itself");
    }
    Ok(())
}

pub(crate) fn env_nonblank(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
