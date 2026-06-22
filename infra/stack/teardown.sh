#!/usr/bin/env bash
# Remove a Swarm stack and wait for its services to fully drain. keasy-edge is an
# EXTERNAL network (created by bootstrap.sh, not owned by any stack), so removing
# keasy-base never touches the shared overlay or the live tenant stacks on it — no
# network race, no orphan-holds-the-network failure. Used by `make redeploy-base` /
# `make reset-keycloak`.
#
#   infra/stack/teardown.sh keasy-base
set -euo pipefail
stack="${1:?usage: teardown.sh <stack>}"

docker stack rm "$stack" 2>/dev/null || true
echo "waiting for ${stack} services to drain..."
while docker service ls --format '{{.Name}}' | grep -q "^${stack}_"; do sleep 2; done
echo "✓ ${stack} drained"
