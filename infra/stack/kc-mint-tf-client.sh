#!/usr/bin/env bash
# Mint the dedicated, least-privilege `keasy-terraform` client that Terraform
# authenticates as — so the IaC never runs as the master admin USER. Idempotent:
# re-runs only re-assert the secret + role. Run on a manager (it shells out to
# `docker run` on the keasy-edge overlay). Called by bootstrap.sh after the base stack
# is up; the master admin password is used ONLY here.
#
# Least privilege: the client gets only the master `create-realm` role. When Terraform
# (as this client) creates the `keasy` realm, Keycloak auto-grants the creator admin on
# that realm — so no broad master-admin role is needed.
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE="${KEASY_ENV_FILE:-deploy/environments/prod/.env}"
VERSIONS_FILE="$(dirname "$ENV_FILE")/versions.env"
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found (run bootstrap first)"; exit 1; }
set -a; . "$ENV_FILE"; [ -f "$VERSIONS_FILE" ] && . "$VERSIONS_FILE"; set +a

: "${KC_ADMIN_PASSWORD:?KC_ADMIN_PASSWORD missing (bootstrap generates it)}"
: "${KC_TF_CLIENT_SECRET:?KC_TF_CLIENT_SECRET missing (bootstrap generates it)}"
: "${KEASY_KEYCLOAK_IMAGE:?KEASY_KEYCLOAK_IMAGE missing in versions.env}"

exec docker run --rm --network keasy-edge \
  -e KC_PW="$KC_ADMIN_PASSWORD" \
  -e TF_SECRET="$KC_TF_CLIENT_SECRET" \
  --entrypoint /bin/bash "$KEASY_KEYCLOAK_IMAGE" -c '
    set -euo pipefail
    kc() { /opt/keycloak/bin/kcadm.sh "$@"; }
    echo "waiting for Keycloak admin API..."
    until kc config credentials --server http://keycloak:8080/auth \
        --realm master --user admin --password "$KC_PW" >/dev/null 2>&1; do sleep 3; done

    cid="$(kc get clients -r master -q clientId=keasy-terraform --fields id --format csv --noquotes || true)"
    if [ -z "$cid" ]; then
      kc create clients -r master \
        -s clientId=keasy-terraform -s enabled=true -s publicClient=false \
        -s serviceAccountsEnabled=true -s standardFlowEnabled=false \
        -s directAccessGrantsEnabled=false -s secret="$TF_SECRET" >/dev/null
      echo "✓ created keasy-terraform client"
    else
      kc update "clients/$cid" -r master -s secret="$TF_SECRET" >/dev/null
      echo "• keasy-terraform client exists (secret re-asserted)"
    fi

    # Only create-realm — creating the keasy realm auto-grants this SA admin on it.
    kc add-roles -r master --uusername service-account-keasy-terraform \
      --rolename create-realm >/dev/null 2>&1 || true
    echo "✓ keasy-terraform service account has create-realm"
  '
