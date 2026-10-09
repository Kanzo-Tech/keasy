#!/usr/bin/env bash
# realm-migrate (platform.yaml) on the states a development stack can hold: none, the old one alone,
# both — the realm re-created since — and one of the two modules already moved. Each case must end
# with both of keasy's modules in the realm's state and the old state retired.
#
# Needs: bash, docker, python3.  Run from the repository root.
set -euo pipefail
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
docker compose config --format json | python3 -c \
  "import json,sys; print(json.load(sys.stdin)['services']['realm-migrate']['command'][0].replace('\$\$', '\$'))" > "$work/run.sh"

state() {  # state FILE MODULE… — a state holding one resource in each module
  python3 - "$@" <<'PY'
import json, sys
f, mods = sys.argv[1], sys.argv[2:]
res = [{"module": m, "mode": "managed", "type": "terraform_data", "name": "t",
        "provider": "provider[\"terraform.io/builtin/terraform\"]",
        "instances": [{"schema_version": 0, "attributes": {"id": m}}]} for m in mods]
json.dump({"version": 4, "terraform_version": "1.14.0", "serial": 1, "lineage": f,
           "outputs": {}, "resources": res}, open(f, "w"))
PY
}

app='module.application["keasy"]'; api='module.application_api["keasy"]'
case_() {  # case_ NAME OLD-MODULES… -- REALM-MODULES…
  local name=$1; shift; local dir="$work/$name"; mkdir -p "$dir/provision/auth" "$dir/realm"
  local old=() realm=() side=old
  for m in "$@"; do if [ "$m" = -- ]; then side=realm; elif [ $side = old ]; then old+=("$m"); else realm+=("$m"); fi; done
  [ ${#old[@]} -gt 0 ] && state "$dir/provision/auth/terraform.tfstate" "${old[@]}"
  [ ${#realm[@]} -gt 0 ] && state "$dir/realm/terraform.tfstate" "${realm[@]}"
  docker run --rm -v "$dir/provision:/provision" -v "$dir/realm:/realm" -v "$work/run.sh:/run.sh:ro" -w /tmp \
    --entrypoint sh hashicorp/terraform:1.14 -ec \
    'sh -e /run.sh >/dev/null; [ ! -e /provision/auth/terraform.tfstate ];
     [ ! -s /realm/terraform.tfstate ] || terraform state list -state=/realm/terraform.tfstate' > "$dir/out" ||
    { echo "FAIL $name: realm-migrate failed or left the old state"; exit 1; }
  if [ ${#old[@]} -gt 0 ] || [ ${#realm[@]} -gt 0 ]; then
    if ! grep -qF "$app" "$dir/out" || ! grep -qF "$api" "$dir/out"; then
      echo "FAIL $name: $(tr '\n' ' ' < "$dir/out")"; exit 1
    fi
  fi
  echo "ok   $name"
}

case_ new
case_ old-only module.keasy module.keasy_api --
case_ both module.keasy module.keasy_api -- "$app" "$api"
case_ one-moved module.keasy module.keasy_api -- "$app"
