#!/usr/bin/env bash
# Run the keasy provisioner CLI against this manager's Docker Engine.
#
#   infra/stack/cp.sh provision --name "Acme" --handle acme --owner-email <email>
#   infra/stack/cp.sh reconcile          # converge all git tenant manifests
#   infra/stack/cp.sh deprovision <id>
#   infra/stack/cp.sh list
#
# Operator-only: it owns the Docker socket and authenticates to Keycloak as the
# keasy-control-plane client. There is no long-running control-plane service —
# this runs the `keasy-control-plane` image one-shot. Run it FROM A MANAGER (it
# shells out to `docker stack deploy`). Git (deploy/environments/<env>/tenants/*.yaml)
# is the desired-state inventory; the registry volume `control-plane-data` is the
# CLI's local bookkeeping across runs.
set -euo pipefail

ENV_FILE="${KEASY_ENV_FILE:-deploy/environments/prod/.env}"
[ -f "$ENV_FILE" ] || { echo "✗ env file not found: $ENV_FILE (run bootstrap first)"; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${KC_HOSTNAME:?KC_HOSTNAME missing in $ENV_FILE}"
: "${KEASY_BASE_DOMAIN:?KEASY_BASE_DOMAIN missing in $ENV_FILE}"
: "${CP_OIDC_SECRET:?CP_OIDC_SECRET missing in $ENV_FILE (bootstrap generates it)}"
: "${KEASY_CONTROL_PLANE_IMAGE:?KEASY_CONTROL_PLANE_IMAGE missing in $ENV_FILE}"

# Attach to the keasy-edge overlay so the CLI reaches Keycloak at its internal
# address (same as the old service did). The overlay is `attachable: true`.
exec docker run --rm \
  --network keasy-edge \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v control-plane-data:/var/lib/keasy \
  -v "$(pwd)/deploy:/deploy:ro" \
  -e CP_OIDC_ISSUER_URL="https://${KC_HOSTNAME}/auth/realms/keasy" \
  -e CP_OIDC_INTERNAL_BASE_URL="http://keycloak:8080/auth" \
  -e CP_OIDC_CLIENT_ID=keasy-control-plane \
  -e CP_OIDC_CLIENT_SECRET="${CP_OIDC_SECRET}" \
  -e CP_BASE_DOMAIN="${KEASY_BASE_DOMAIN}" \
  -e CP_SERVER_IMAGE="${KEASY_SERVER_IMAGE}" \
  -e CP_WEB_IMAGE="${KEASY_WEB_IMAGE}" \
  -e CP_NETWORK=keasy-edge \
  -e CP_STACKS_DIR=/var/lib/keasy/stacks \
  -e CP_DB_PATH=/var/lib/keasy/control-plane.db \
  -e CP_DEPLOY_DIR=/deploy/environments/prod \
  -e CP_LITESTREAM_REPLICA_BASE="${KEASY_LITESTREAM_REPLICA_BASE:-}" \
  "${KEASY_CONTROL_PLANE_IMAGE}" "$@"
