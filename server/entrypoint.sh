#!/bin/sh
# keasy-server entrypoint. When a Litestream replica is configured, restore each
# SQLite store from the replica if this node has none yet (fresh node / instance
# migration), then run the server under continuous replication. Unset → run the
# server directly, no durability layer (dev / local / unconfigured).
set -e

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  # Replica credentials arrive as a Swarm secret file of `KEY=value` lines
  # (LITESTREAM_ACCESS_KEY_ID/…, or LITESTREAM_AZURE_ACCOUNT_KEY); `set -a`
  # exports them so the litestream child process inherits them.
  if [ -f /run/secrets/litestream ]; then
    set -a; . /run/secrets/litestream; set +a
  fi
  # Restore keasy.db on a fresh node before the server starts. The DuckLake
  # catalog (catalog.sqlite) is NOT restored — the reconciler rebuilds it from
  # the jobs once the server is up.
  litestream restore -if-db-not-exists -if-replica-exists -config /etc/litestream.yml /var/lib/keasy/keasy.db
  exec litestream replicate -config /etc/litestream.yml -exec keasy-server
fi

exec keasy-server
