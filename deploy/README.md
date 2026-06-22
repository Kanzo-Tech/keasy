# deploy/ — environment config for the VPS fleet

> **The tenant fleet is no longer declared here.** A tenant **is** a Keycloak
> Organization (the source of truth); the control-plane has no git inventory and no
> local registry. The `tenants/*.yaml` files are **obsolete** — tenants live in
> Keycloak, not git — and are kept only as historical artifacts.

```
deploy/environments/<env>/
  .env                  # operator secrets + hostnames (gitignored) — NO image pins
  versions.env          # fleet image pins (git-tracked fleet-config) — the live source
  tenants/              # OBSOLETE — tenants live in Keycloak, not git
```

## Image pins (live)

The fleet default images are the three `KEASY_*_IMAGE` pins in
`deploy/environments/<env>/versions.env` — git-tracked fleet-config (no per-tenant
data, no PII; just the fleet's version). `infra/stack/bootstrap.sh` and
`infra/stack/cp.sh` source it alongside `.env` (which holds only operator secrets +
hostnames), so the pin lives in exactly one place. `cp.sh` passes them on as
`CP_SERVER_IMAGE` / `CP_WEB_IMAGE`. To canary a single tenant, set its org
`server_image` attribute instead of bumping the fleet default.

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
