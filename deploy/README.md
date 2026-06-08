# deploy/ — declarative source of truth for the VPS fleet

Each environment is a directory the control-plane reconciles the live fleet toward.
Git history here is the audit log: **add a tenant file → provision**, **delete it →
deprovision**, **bump `versions.env` → roll every tenant to the new image**.

```
deploy/environments/<env>/
  versions.env          # image pins for the whole environment (the rollout knob)
  tenants/
    acme.yaml           # one file per workspace; filename stem = default slug
    globex.yaml
```

## `versions.env`

```
KEASY_SERVER_IMAGE=ghcr.io/kanzo-tech/keasy-server:0.3.0
KEASY_WEB_IMAGE=ghcr.io/kanzo-tech/keasy-web:0.3.0
```

Renovate bumps these when a new keasy release is published; merging the bump rolls
the fleet on the next reconcile.

## `tenants/<slug>.yaml`

```yaml
name: Acme Corp              # display name
owner_keycloak_sub: <uuid>   # the Keycloak user who owns the workspace
# slug: acme                 # optional; defaults to the filename stem
# server_image: ...          # optional per-tenant override (canary a pilot tenant)
# web_image: ...             # optional override
```

## Reconcile

- **Pull-based** (default off): set `CP_RECONCILE_INTERVAL_SECS` + `CP_DEPLOY_DIR`
  on the control-plane; it re-reads this dir every interval and converges.
- **On demand**: `POST /reconcile` against the control-plane.

A rollout is health-gated — `docker compose up --wait` only succeeds once the new
image passes the instance's `/healthz/live` check. **Rollback = `git revert`** the
`versions.env` (or tenant file) change and reconcile.

> Files ending in `.example` are templates and are NOT loaded (only `*.yaml` / `*.yml`).
