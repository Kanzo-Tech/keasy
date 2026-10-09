#!/usr/bin/env bash
# The deployment's secrets, in secrets.sops.env, encrypted with SOPS to the age keys .sops.yaml
# lists. Nothing is ever written to the disk in clear: each change is decrypted, edited and
# encrypted again through pipes.
#
#   secrets.sh               generate every secret that does not exist yet — on every deploy, so an
#                            organization added since the last one gets its sealing key here
#   secrets.sh set NAME      set NAME to a value read from the terminal (hidden), e.g. a provider's key
#
# Needs: bash, openssl, and Docker or sops (./sops).
set -euo pipefail
cd "$(dirname "$0")"

FILE=secrets.sops.env
SOPS=${SOPS:-./sops}

# Read through stdin rather than by path: a sops in a container (./sops) can see a file the host
# has just rewritten as it was a moment before.
current=""
[ -f "$FILE" ] && current=$($SOPS -d --input-type dotenv --output-type dotenv /dev/stdin < "$FILE")

write() {
  sed '/^$/d' <<<"$current" |
    $SOPS -e --input-type dotenv --output-type dotenv --filename-override "$FILE" /dev/stdin > "$FILE.tmp"
  mv "$FILE.tmp" "$FILE"
}

if [ "${1:-}" = set ]; then
  name=${2:?usage: secrets.sh set NAME}
  read -rsp "$name: " value; echo
  [ -n "$value" ] || { echo "secrets: $name left as it was" >&2; exit 1; }
  current=$(grep -v "^$name=" <<<"$current" || true)$'\n'"$name=$value"
  write
  echo "secrets: $name set"
  exit 0
fi

random() { openssl rand -hex 32; }
# The server's sealing key: 32 random bytes, handed over in base64.
sealing() { openssl rand -base64 32; }

added=()
want() {  # want NAME GENERATOR
  grep -q "^$1=" <<<"$current" && return 0
  current+=$'\n'"$1=$($2)"
  added+=("$1")
}

want KC_ADMIN_PASSWORD random
want KC_DB_PASSWORD random
want AI_DB_PASSWORD random
want KEASY_OIDC_CLIENT_SECRET random
want KEASY_SESSION_SECRET random
for org in orgs/*.yaml; do
  alias=$(basename "$org" .yaml)
  want "KEASY_SECRET_KEY_$(tr 'a-z-' 'A-Z_' <<<"$alias")" sealing
done

if [ ${#added[@]} -eq 0 ]; then
  echo "secrets: nothing to add"
  exit 0
fi
write
printf 'secrets: added %s\n' "${added[@]}"
