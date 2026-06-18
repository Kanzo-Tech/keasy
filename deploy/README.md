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

Operator-run, on demand: `make reconcile` (or `infra/stack/cp.sh reconcile`) on a
manager re-reads this dir and converges the fleet — provisioning new tenant manifests
and rolling out version-pin changes. There is no standing reconcile daemon; re-run it
after editing a manifest or `versions.env` (or wire it to CI on merge).

A rollout is health-gated — `docker stack deploy --detach=false` only succeeds once
the new image passes the instance's health check. **Rollback = `git revert`** the
`versions.env` (or tenant file) change and reconcile.

> Files ending in `.example` are templates and are NOT loaded (only `*.yaml` / `*.yml`).
