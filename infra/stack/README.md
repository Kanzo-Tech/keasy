# infra/stack — the keasy fleet on Docker Swarm

The reference deployment substrate. **Swarm** owns the generic ops (health-gated
rolling updates, automatic rollback, encrypted secrets, overlay isolation);
**Traefik v3** owns ingress + TLS via service labels; the **control-plane** owns
the keasy-specific provisioning (Keycloak + rendering each tenant's stack). See
`/Users/angel.ip/.claude/plans/lively-wibbling-muffin.md` for the full design.

## Topology

- `base.yml` — one shared stack: Traefik (edge), Keycloak + Postgres (identity),
  control-plane (provisioner), and the **central onboarding instance** (keasy-server
  + web at the apex `KEASY_BASE_DOMAIN`, central mode). Defines the `keasy-edge` overlay.
- **Per-tenant stacks** — rendered + `docker stack deploy`-ed by the control-plane
  (one per workspace, project name = workspace id). They attach to `keasy-edge`;
  Traefik routes `<slug>.<base_domain>` to them from their `deploy.labels`. No edit
  to `base.yml` is needed to add/remove a tenant.

## One-time bootstrap (single manager node)

```sh
# 1. Init Swarm (single node is fine; can grow to multi-node later).
docker swarm init

# 2. The three base secrets (created out-of-band; never in git).
printf '%s' "$KC_DB_PASSWORD"    | docker secret create kc-db-password -
printf '%s' "$KC_ADMIN_PASSWORD" | docker secret create kc-admin-password -
printf '%s' "$CP_OIDC_SECRET"    | docker secret create cp-oidc-secret -

# 3. Required env (the control-plane image must ship the `docker` CLI).
export KC_HOSTNAME=auth.keasy.example.com
export KEASY_BASE_DOMAIN=keasy.example.com
export ACME_EMAIL=ops@kanzo.tech
export KEASY_SERVER_IMAGE=ghcr.io/kanzo-tech/keasy-server:0.4.0
export KEASY_WEB_IMAGE=ghcr.io/kanzo-tech/keasy-web:0.4.0
export KEASY_CONTROL_PLANE_IMAGE=ghcr.io/kanzo-tech/keasy-control-plane:0.4.0
export KEASY_DEPLOY_DIR=/opt/keasy/keasy   # this repo's keasy/ on the manager

# 4. Deploy the base stack.
docker stack deploy -c infra/stack/base.yml keasy-base
```

DNS: point `*.${KEASY_BASE_DOMAIN}` and `${KC_HOSTNAME}` at the manager's IP.
Traefik issues per-host certs via the ACME TLS-challenge automatically.

## Durability — Litestream (optional but recommended)

Each tenant's `keasy.db` (connections, jobs, encrypted secrets, settings) lives on
a local Swarm volume. To survive a node loss / instance migration, the server
image runs it under **Litestream**, continuously replicating to a **keasy-operated
bucket** (one bucket, per-tenant prefix) and restoring on a fresh node before the
server starts. The DuckLake `catalog.sqlite` is **not** replicated — it is a
derived projection the reconciler rebuilds from the jobs. Off unless configured —
the server then runs with no replication.

```sh
# 1. The shared replica credentials, as a KEY=value env-file secret. S3:
printf 'LITESTREAM_ACCESS_KEY_ID=%s\nLITESTREAM_SECRET_ACCESS_KEY=%s\n' \
  "$AKID" "$SECRET" | docker secret create keasy-litestream -
#    …or Azure: LITESTREAM_AZURE_ACCOUNT_KEY=<key>  (account is in the abs:// URL).

# 2. Point the control-plane at the bucket base (each tenant gets <base>/<id>/).
export KEASY_LITESTREAM_REPLICA_BASE=s3://keasy-backups/litestream
#    …or abs://<container>@<account>.blob.core.windows.net/litestream
```

The control-plane injects `LITESTREAM_REPLICA_URL` + the `keasy-litestream` secret
into every rendered tenant stack. Leave `KEASY_LITESTREAM_REPLICA_BASE` unset to
disable.

## Per-tenant lifecycle (driven by `deploy/`)

`deploy/environments/prod/tenants/<slug>.yaml` is the source of truth. The
control-plane reconciles the live fleet toward it every `CP_RECONCILE_INTERVAL_SECS`
(or on `POST /reconcile`): it mints the tenant's Swarm secrets, renders the stack,
and `docker stack deploy`s it. Rollback = `git revert` the pin (or Swarm's automatic
rollback on a failed health-gate). See `deploy/README.md`.

## Users (identity is runtime, never seeded in the realm)

The realm import carries only structure (clients, scopes, roles) — never people.
Onboarding is **self-service** (first-user-becomes-owner), no admin step:

1. A person opens the app at `https://${KEASY_BASE_DOMAIN}` (the central instance)
   and signs up — Keycloak self-registration is enabled on the `keasy` realm.
2. On first login with no workspace, the central server provisions their workspace
   via the control-plane (server-to-server, keyed with `cp-api-key`) and makes the
   verified token sub the **owner**; the user lands in it.
3. **Members are invited** to the workspace's Keycloak Organization (the control-plane's
   `add_org_member` + `assign_client_role` wire membership + owner/member authz).

The registry (control-plane SQLite) is the source of truth for which workspaces
exist. The git manifests + `make tenant slug=… name=… owner=<sub>` remain an
optional **seed / break-glass** path (import-if-absent + version pin) — deleting a
manifest no longer deprovisions.

The only non-human users in the realm are the **service accounts** — the machine
identities of keasy-server and the control-plane (OAuth2 client-credentials), which
carry the `realm-management` roles those services need to call the admin API.

> **Secret rotation:** `cp-api-key` is shared by the control-plane and the central
> server — rotating it means redeploying both. `bootstrap.sh` generates it (plus the
> central client/session/api-key secrets) on first run and persists them in `.env`.

## On-the-fly version switch

Bump `deploy/environments/prod/versions.env` (fleet) or a tenant override →
reconcile. Swarm performs a **start-first** rolling update (new task healthy before
the old retires = zero-downtime) and auto-rolls-back on health failure — both from
the `update_config`/`rollback_config` the control-plane renders into each stack.

> NOTE: the dev loop still uses `docker compose` (`docker-compose*.yml` + Caddy).
> The Caddy ingress is superseded by Traefik for the Swarm/prod path; `infra/caddy/**`
> is removed as part of the prod cutover.
