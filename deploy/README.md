# deploy/ — environment config for the VPS fleet

> **The tenant fleet is no longer declared here.** A tenant **is** a Keycloak
> Organization (the source of truth); the control-plane has no git inventory and no
> local registry. The `tenants/*.yaml` files and `versions.env` are **obsolete** —
> the control-plane does not read them. They are kept only as historical artifacts.

```
deploy/environments/<env>/
  .env                  # operator env: hostnames, secrets, fleet image pins (live)
  versions.env          # OBSOLETE — no longer read by the control-plane
  tenants/              # OBSOLETE — tenants live in Keycloak, not git
```

## Image pins (live)

The fleet default images come from `KEASY_SERVER_IMAGE` / `KEASY_WEB_IMAGE` in
`deploy/environments/<env>/.env` (consumed by `infra/stack/cp.sh` as
`CP_SERVER_IMAGE` / `CP_WEB_IMAGE`). To canary a single tenant, pin its org
`server_image` attribute instead of the fleet default.

## Tenant lifecycle

Operator-run on a manager (no standing daemon):

- **Provision:** `make tenant slug=… name=… owner=<email>` → `cp.sh provision`
  creates the Keycloak Organization (the tenant record) + OIDC client and brings the
  stack up. Idempotent.
- **Reconcile:** `make reconcile` lists every Organization and re-ensures its stack
  at the org's pinned `server_image` attribute (or the fleet default) — drift heal +
  version rollout. A rollout is health-gated (`docker stack deploy --detach=false`)
  and Swarm auto-rolls-back on health failure.
- **Deprovision:** `make deprovision slug=…` tears down the stack, OIDC client, and
  Organization.
