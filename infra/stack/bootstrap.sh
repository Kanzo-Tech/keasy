#!/usr/bin/env bash
# One-time, idempotent bootstrap of the keasy fleet base stack on a Swarm manager.
# Generates every secret itself and wires each to BOTH consumers (no hand-matching,
# no `change-me`): the control-plane secret is minted once and injected into the
# Swarm secret AND the rendered Keycloak realm. Re-runnable: existing secrets and a
# rendered realm are left as-is. Reads/writes deploy/environments/prod/.env.
#
#   infra/stack/bootstrap.sh        # or: make deploy-base
set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root (keasy/)

ENV_FILE="${KEASY_ENV_FILE:-deploy/environments/prod/.env}"
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found — copy deploy/environments/prod/.env.example"; exit 1; }
# .env carries operator secrets + hostnames; the fleet image pins are git-tracked
# fleet-config in the sibling versions.env (one pin, one place). Source both.
VERSIONS_FILE="$(dirname "$ENV_FILE")/versions.env"
set -a; . "$ENV_FILE"; [ -f "$VERSIONS_FILE" ] && . "$VERSIONS_FILE"; set +a

req() { eval "v=\${$1:-}"; [ -n "$v" ] || { echo "✗ missing required env: $1 (in $ENV_FILE)"; exit 1; }; }
for v in KC_HOSTNAME KEASY_BASE_DOMAIN ACME_EMAIL \
         KEASY_SERVER_IMAGE KEASY_WEB_IMAGE KEASY_CONTROL_PLANE_IMAGE KEASY_DEPLOY_DIR; do req "$v"; done

# Generate any secret the operator didn't pin, persisting it to .env so re-runs
# (and the realm render below) reuse the exact value — Swarm secrets are
# write-only, so .env is our single source for the generated material.
gen() {  # <ENV_VAR>
  eval "cur=\${$1:-}"; [ -n "$cur" ] && return
  val="$(openssl rand -hex 24)"
  printf '%s=%s\n' "$1" "$val" >> "$ENV_FILE"
  export "$1=$val"
  echo "✓ generated $1"
}
gen KC_DB_PASSWORD
gen KC_ADMIN_PASSWORD
# The provisioner CLI authenticates to Keycloak as the keasy-control-plane client
# with this secret (passed via .env by cp.sh, and injected into the rendered realm
# below — same value both sides). No Swarm secret: the CLI is not a service.
gen CP_OIDC_SECRET

# 1. Swarm + the shared overlay (both idempotent). keasy-edge is created HERE, not
#    by base.yml, so it outlives `docker stack rm keasy-base` — tenants and cp.sh keep
#    reaching Keycloak across a base redeploy, and the stack never races the overlay GC.
docker info 2>/dev/null | grep -q 'Swarm: active' || docker swarm init
if docker network inspect keasy-edge >/dev/null 2>&1; then
  echo "• network keasy-edge exists"
else
  docker network create --driver overlay --attachable keasy-edge >/dev/null
  echo "✓ created network keasy-edge"
fi

# 2. Swarm secrets — created only if absent, from the (now-present) env value.
secret() {  # <secret-name> <env-var>
  docker secret inspect "$1" >/dev/null 2>&1 && { echo "• secret $1 exists"; return; }
  eval "val=\${$2}"
  printf '%s' "$val" | docker secret create "$1" - >/dev/null && echo "✓ created secret $1"
}
secret kc-db-password    KC_DB_PASSWORD
secret kc-admin-password KC_ADMIN_PASSWORD
if [ -n "${KEASY_LITESTREAM_REPLICA_BASE:-}" ] && ! docker secret inspect keasy-litestream >/dev/null 2>&1; then
  [ -n "${KEASY_LITESTREAM_CREDS:-}" ] || { echo "✗ KEASY_LITESTREAM_REPLICA_BASE set but KEASY_LITESTREAM_CREDS missing"; exit 1; }
  printf '%s' "$KEASY_LITESTREAM_CREDS" | docker secret create keasy-litestream - >/dev/null && echo "✓ created secret keasy-litestream"
fi

# 3. Render the realm with CP_OIDC_SECRET injected into the keasy-control-plane
#    client → the control-plane's Swarm secret and the imported realm carry the SAME
#    generated value, automatically. Also overrides the realm's smtpServer with the
#    production relay (KEASY_SMTP_*) — the source JSON carries dev (mailpit) values, so
#    prod points Keycloak at a real transactional sender for Organization invitations.
#    Always re-rendered from the source (gitignored, bound by base.yml into Keycloak's
#    import dir): the render is pure (source + .env → output), so a fix to
#    keasy-realm.json flows on the next `make deploy-base` with no manual step. Keycloak
#    imports it with IGNORE_EXISTING, so re-rendering only matters on a fresh DB and
#    never clobbers an already-seeded realm.
RENDERED=infra/keycloak/realm-rendered
mkdir -p "$RENDERED"
python3 - infra/keycloak/realm-import/keasy-realm.json "$RENDERED/keasy-realm.json" "$CP_OIDC_SECRET" <<'PY'
import json, os, sys
src, dst, secret = sys.argv[1:4]
realm = json.load(open(src))
for c in realm.get("clients", []):
    if c.get("clientId") == "keasy-control-plane":
        c["secret"] = secret
# Production SMTP relay (Organization invitations need a real sender; the source JSON's
# mailpit values are dev-only). Set when KEASY_SMTP_HOST is present; auth fields are
# optional (omit user/password for an open relay).
host = os.environ.get("KEASY_SMTP_HOST")
if host:
    smtp = {
        "host": host,
        "port": os.environ.get("KEASY_SMTP_PORT", "587"),
        "from": os.environ.get("KEASY_SMTP_FROM", "noreply@" + os.environ.get("KEASY_BASE_DOMAIN", "")),
        "fromDisplayName": os.environ.get("KEASY_SMTP_FROM_NAME", "Keasy"),
        "ssl": os.environ.get("KEASY_SMTP_SSL", "false"),
        "starttls": os.environ.get("KEASY_SMTP_STARTTLS", "true"),
    }
    user = os.environ.get("KEASY_SMTP_USER")
    if user:
        smtp["auth"] = "true"
        smtp["user"] = user
        smtp["password"] = os.environ.get("KEASY_SMTP_PASSWORD", "")
    else:
        smtp["auth"] = "false"
    realm["smtpServer"] = smtp
json.dump(realm, open(dst, "w"), indent=2)
PY
echo "✓ rendered realm with the control-plane secret${KEASY_SMTP_HOST:+ + prod SMTP relay} injected"

# 4. Deploy the base stack (Traefik + Keycloak [native realm import] + control-plane).
docker stack deploy --detach=false -c infra/stack/base.yml keasy-base
echo "✓ base stack up. Add a tenant: make tenant slug=acme name='Acme' owner=owner@acme.com"
