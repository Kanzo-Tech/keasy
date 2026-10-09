#!/bin/sh
# Fetch every dev example's data: each infra/dev/examples/<name>/fetch.sh pins
# its own downloads by digest and unpacks them into its gitignored data/, which
# the compose `s3-init` service uploads. A second run is a no-op.
set -eu

here=$(cd "$(dirname "$0")" && pwd)

for fetch in "$here"/examples/*/fetch.sh; do
  sh "$fetch"
done
