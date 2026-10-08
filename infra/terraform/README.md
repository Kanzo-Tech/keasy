# infra/terraform — the keasy fleet as code

Terraform owns the whole deployment on Docker Swarm. Identity and the AI gateway are
platform services from kanzo-ui (`services/auth`, `services/ai`, at the tag the
Makefile's `KANZO_UI_REF` pins); keasy deploys them and registers itself with them.

```
platform/          phase 1 — keasy-edge overlay, Traefik, Keycloak + Postgres, the AI gateway (kanzo-ui services/ai/modules/gateway)
  ── phase 2 ──
  kanzo-ui services/auth/realm   the `kanzo` realm and its organizations (one per tenant)
  ../auth/                       keasy's one client `keasy`, its audience and roles (reader ⊂ editor ⊂ admin)
instances/         phase 3 — one server + web + sessions stack per organization
```

One client serves every instance. What tells them apart is `KEASY_ORG_ALIAS`: the tenant
**is** a Keycloak Organization, keyed by its alias, and a token's roles count only inside
it. Who belongs to an organization, and with which role (its groups), is the
organization admin's, in Keycloak — not Terraform's. There are no users in any of this.

## Apply

On a Swarm manager, once (`docker swarm init` if not already a manager). `make` runs from
the repo root; paths below are relative to `infra/terraform/`.

```sh
# Phase 1 — platform. Keycloak comes up empty; mints the DB, admin and gateway passwords.
# platform/terraform.tfvars: kc_hostname, acme_email, ai_upstream_keys, ai_tokens_per_hour
make deploy-platform
until curl -fsS https://auth.keasy.example.com/health/ready >/dev/null; do sleep 3; done

# Phase 2 — identity. Operator tfvars in infra/terraform/.operator/ (gitignored):
#   realm.tfvars  kc_url, issuer_base_url, organizations = { acme = { name, domain } },
#                 apis = { ai-gateway = "…" } (the gateway's client, which keasy's lists)
#   auth.tfvars   kc_url, redirect_uris (https://<alias>.<base_domain>/api/auth/callback each)
make deploy-auth       # kanzo-ui's realm, then infra/auth

# Phase 3 — the instances.
cp instances/terraform.tfvars.example instances/terraform.tfvars   # then edit
make deploy-instances  # passes infra/auth's client_secret
```

**Adding a tenant** = its organization in `realm.tfvars` (+ its callback in
`auth.tfvars`), an entry in `instances/terraform.tfvars`; then `deploy-auth`,
`deploy-instances`. Its people are invited into the organization from Keycloak.
Its model calls are charged to it by the organization in their token, not by a key.

- **State** holds every secret: platform's and instances' beside them, the realm's and
  auth root's in `.operator/`. All on the manager, gitignored. Back it up: each instance's
  credential-sealing key (`random_bytes.secret_key`) exists nowhere else, so losing the
  instances state leaves that tenant's `keasy.db` unreadable.
- **`release_version`** is the one version of record: every instance runs
  `ghcr.io/kanzo-tech/keasy-{server,web}:<release_version>`.

## Who holds what

The relying party is the **web** tier (`@kanzo-tech/auth/next`, mounted at `/api/auth`):
it mounts the shared `keasy-oidc` secret and seals the session cookie. The **server** is a
resource server — it validates the bearer token the web forwards against the realm's JWKS,
checks `aud` against `keasy-api` and reads the roles for its organization, so it needs no
OIDC secret. The API is not routed from the edge; the web's `/api/v1` forwards to it.

The AI gateway is reached the same way: the web forwards `/api/ai` to `ai-gateway:4000/v1`
with the person's token exchanged for the gateway's audience and the organization the
request addresses, and the gateway charges that organization. No instance holds a model
key; the upstreams' keys are the gateway's (`ai_upstream_keys`), and which upstream
answers each alias is `platform/ai-profile.yaml`.

Upstream SSO, SMTP and invitations are the realm's (kanzo-ui services/auth), not keasy's.
