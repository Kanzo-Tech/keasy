#!/usr/bin/env bash
# Apply the keasy realm (infra/keycloak/terraform) with a one-shot `hashicorp/terraform`
# container on the keasy-edge overlay — no terraform install on the manager. Mirrors
# cp.sh. Run on a manager. Called by bootstrap.sh after the base stack is up; also
# re-runnable standalone to roll a realm config change (idempotent — apply reconciles
# in place, NO Postgres volume wipe).
#
#   infra/stack/tf.sh                 # terraform init + apply
#   TF_CMD="plan" infra/stack/tf.sh   # dry-run
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE="${KEASY_ENV_FILE:-deploy/environments/prod/.env}"
VERSIONS_FILE="$(dirname "$ENV_FILE")/versions.env"
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found (run bootstrap first)"; exit 1; }
set -a; . "$ENV_FILE"; [ -f "$VERSIONS_FILE" ] && . "$VERSIONS_FILE"; set +a

: "${KC_TF_CLIENT_SECRET:?KC_TF_CLIENT_SECRET missing (bootstrap generates it)}"
: "${CP_OIDC_SECRET:?CP_OIDC_SECRET missing (bootstrap generates it)}"
: "${KEASY_TERRAFORM_IMAGE:?KEASY_TERRAFORM_IMAGE missing in versions.env}"
: "${KEASY_DEPLOY_DIR:?KEASY_DEPLOY_DIR missing in $ENV_FILE}"

TF_CMD="${TF_CMD:-apply}"
APPLY_FLAGS=""
[ "$TF_CMD" = "apply" ] && APPLY_FLAGS="-auto-approve"

# Wait for Keycloak's health endpoint on the overlay before applying (the apply targets
# the internal http://keycloak:8080, before Traefik/ACME is involved).
echo "waiting for Keycloak health..."
until docker run --rm --network keasy-edge curlimages/curl:latest \
    -fsS http://keycloak:8080/auth/health/ready >/dev/null 2>&1; do sleep 3; done

# State + provider plugins persist in the bind-mounted dir on the manager.
exec docker run --rm \
  --network keasy-edge \
  -v "${KEASY_DEPLOY_DIR}/infra/keycloak/terraform:/work" -w /work \
  -e TF_VAR_kc_url="http://keycloak:8080" \
  -e TF_VAR_tf_client_secret="${KC_TF_CLIENT_SECRET}" \
  -e TF_VAR_cp_oidc_secret="${CP_OIDC_SECRET}" \
  -e TF_VAR_server_oidc_secret="${KEASY_SERVER_OIDC_SECRET:-keasy-dev-secret}" \
  -e TF_VAR_smtp_host="${KEASY_SMTP_HOST:-}" \
  -e TF_VAR_smtp_port="${KEASY_SMTP_PORT:-587}" \
  -e TF_VAR_smtp_from="${KEASY_SMTP_FROM:-noreply@${KEASY_BASE_DOMAIN:-}}" \
  -e TF_VAR_smtp_from_name="${KEASY_SMTP_FROM_NAME:-Keasy}" \
  -e TF_VAR_smtp_user="${KEASY_SMTP_USER:-}" \
  -e TF_VAR_smtp_password="${KEASY_SMTP_PASSWORD:-}" \
  --entrypoint /bin/sh \
  "${KEASY_TERRAFORM_IMAGE}" -c "terraform init -input=false && terraform ${TF_CMD} -input=false ${APPLY_FLAGS}"
