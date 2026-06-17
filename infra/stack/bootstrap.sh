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
set -a; . "$ENV_FILE"; set +a

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
gen CP_OIDC_SECRET

# 1. Swarm (idempotent).
docker info 2>/dev/null | grep -q 'Swarm: active' || docker swarm init

# 2. Swarm secrets — created only if absent, from the (now-present) env value.
secret() {  # <secret-name> <env-var>
  docker secret inspect "$1" >/dev/null 2>&1 && { echo "• secret $1 exists"; return; }
  eval "val=\${$2}"
  printf '%s' "$val" | docker secret create "$1" - >/dev/null && echo "✓ created secret $1"
}
secret kc-db-password    KC_DB_PASSWORD
secret kc-admin-password KC_ADMIN_PASSWORD
secret cp-oidc-secret    CP_OIDC_SECRET
if [ -n "${KEASY_LITESTREAM_REPLICA_BASE:-}" ] && ! docker secret inspect keasy-litestream >/dev/null 2>&1; then
  [ -n "${KEASY_LITESTREAM_CREDS:-}" ] || { echo "✗ KEASY_LITESTREAM_REPLICA_BASE set but KEASY_LITESTREAM_CREDS missing"; exit 1; }
  printf '%s' "$KEASY_LITESTREAM_CREDS" | docker secret create keasy-litestream - >/dev/null && echo "✓ created secret keasy-litestream"
fi

# 3. Render the realm with CP_OIDC_SECRET injected into the keasy-control-plane
#    client → the control-plane's Swarm secret and Keycloak's import are the SAME
#    generated value, automatically. Rendered once (gitignored); base.yml binds it.
RENDERED=infra/keycloak/realm-rendered
if [ ! -f "$RENDERED/keasy-realm.json" ]; then
  mkdir -p "$RENDERED"
  python3 - infra/keycloak/realm-import/keasy-realm.json "$RENDERED/keasy-realm.json" "$CP_OIDC_SECRET" <<'PY'
import json, sys
src, dst, secret = sys.argv[1:4]
realm = json.load(open(src))
for c in realm.get("clients", []):
    if c.get("clientId") == "keasy-control-plane":
        c["secret"] = secret
json.dump(realm, open(dst, "w"), indent=2)
PY
  echo "✓ rendered realm with the control-plane secret injected"
fi

# 4. Deploy the base stack (Traefik + Keycloak [auto realm-import] + control-plane).
docker stack deploy --detach=false -c infra/stack/base.yml keasy-base
echo "✓ base stack up. Add a tenant: make tenant slug=acme name='Acme' owner=<keycloak-sub>"
