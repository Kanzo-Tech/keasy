#!/bin/sh
# Fetch the LDBC SNB example's data: LDBC SNB Interactive v1, SF0.1,
# CsvCompositeMergeForeign, StringDateFormatter — the official prebuilt
# archive, as LDBC publishes it. Nothing is rewritten: the files land in data/
# (gitignored) as the datagen wrote them, and the compose `s3-init` service
# uploads them. A second run is a no-op.
#
# The download lands in infra/dev/.cache/ (gitignored) and is checked against
# the digest pinned here.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cache="$(cd "$here/../.." && pwd)/.cache"

if command -v sha256sum >/dev/null; then sha256() { sha256sum "$@"; }
else sha256() { shasum -a 256 "$@"; }; fi
needs() {
  for tool in "$@"; do
    command -v "$tool" >/dev/null || { echo "seed: needs $tool" >&2; exit 1; }
  done
}
# fetch URL SHA256 FILE: download URL to FILE unless FILE already has SHA256.
fetch() {
  if [ ! -f "$3" ] || ! echo "$2  $3" | sha256 -c - >/dev/null 2>&1; then
    echo "seed: downloading $1"
    curl -fL --retry 5 --retry-all-errors -o "$3.part" "$1"
    mv "$3.part" "$3"
  fi
  echo "$2  $3" | sha256 -c -
}

url="https://datasets.ldbcouncil.org/snb-interactive-v1/social_network-sf0.1-CsvCompositeMergeForeign-StringDateFormatter.tar.zst"
digest="4e3e8753e501b7fb181425bab4e34f3c7520ed66f09a84b2b9c3815f235900e5"
archive="$cache/$(basename "$url")"
out="$here/data"

if [ -f "$out/.sha256" ] && [ "$(cat "$out/.sha256")" = "$digest" ]; then
  echo "seed: LDBC SNB SF0.1 already in $out"
  exit 0
fi
needs curl tar zstd
mkdir -p "$cache"
fetch "$url" "$digest" "$archive"

unpacked="$cache/ldbc"
rm -rf "$unpacked"
mkdir -p "$unpacked"
# Only the initial graph: the update streams and params.ini are the benchmark
# driver's, and the `.crc` files Hadoop's, not the graph's.
top=$(basename "$url" .tar.zst)
tar --use-compress-program=unzstd -xf "$archive" -C "$unpacked" --strip-components=1 \
  --exclude='*.crc' \
  "$top/static" "$top/dynamic"

rm -rf "$out/static" "$out/dynamic" "$out/.sha256"
mv "$unpacked/static" "$unpacked/dynamic" "$out/"
rmdir "$unpacked"
echo "$digest" > "$out/.sha256"
echo "seed: LDBC SNB SF0.1 ready in $out ($(du -sh "$out" | cut -f1)); \`make dev\` uploads it"
