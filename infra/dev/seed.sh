#!/bin/sh
# Fetch the dev seed: LDBC SNB Interactive v1, SF0.1, CsvCompositeMergeForeign,
# StringDateFormatter — the official prebuilt archive, as LDBC publishes it.
#
# The archive is downloaded into infra/dev/.cache/, checked against the digest
# pinned here, and unpacked into infra/dev/seed/ldbc/ (both gitignored), which
# the compose `minio-init` service uploads to s3://keasy-dev/ldbc/. Nothing is
# rewritten: the files land as the datagen wrote them. A second run is a no-op.
set -eu

URL="https://datasets.ldbcouncil.org/snb-interactive-v1/social_network-sf0.1-CsvCompositeMergeForeign-StringDateFormatter.tar.zst"
SHA256="4e3e8753e501b7fb181425bab4e34f3c7520ed66f09a84b2b9c3815f235900e5"

here=$(cd "$(dirname "$0")" && pwd)
cache="$here/.cache"
archive="$cache/$(basename "$URL")"
out="$here/seed/ldbc"

if [ -f "$out/.sha256" ] && [ "$(cat "$out/.sha256")" = "$SHA256" ]; then
  echo "seed: LDBC SNB SF0.1 already in $out"
  exit 0
fi

for tool in curl tar zstd; do
  command -v "$tool" >/dev/null || { echo "seed: needs $tool" >&2; exit 1; }
done
if command -v sha256sum >/dev/null; then sha256() { sha256sum "$@"; }
else sha256() { shasum -a 256 "$@"; }; fi

mkdir -p "$cache"
if [ ! -f "$archive" ] || ! echo "$SHA256  $archive" | sha256 -c - >/dev/null 2>&1; then
  echo "seed: downloading $URL"
  curl -fL --retry 5 --retry-all-errors -o "$archive.part" "$URL"
  mv "$archive.part" "$archive"
fi
echo "$SHA256  $archive" | sha256 -c -

unpacked="$cache/ldbc"
rm -rf "$unpacked"
mkdir -p "$unpacked"
# Only the initial graph: the update streams and params.ini are the benchmark
# driver's, and the `.crc` files Hadoop's, not the graph's.
top=$(basename "$URL" .tar.zst)
tar --use-compress-program=unzstd -xf "$archive" -C "$unpacked" --strip-components=1 \
  --exclude='*.crc' \
  "$top/static" "$top/dynamic"

rm -rf "$out/static" "$out/dynamic" "$out/.sha256"
mv "$unpacked/static" "$unpacked/dynamic" "$out/"
rmdir "$unpacked"
echo "$SHA256" > "$out/.sha256"
echo "seed: LDBC SNB SF0.1 ready in $out ($(du -sh "$out" | cut -f1)); \`make dev\` uploads it"
