#!/bin/sh
# Fetch the dev seed: two graphs, each pinned by digest and unpacked into a
# gitignored folder under infra/dev/seed/ that the compose `s3-init` service
# uploads. A second run is a no-op.
#
# - ldbc/: LDBC SNB Interactive v1, SF0.1, CsvCompositeMergeForeign,
#   StringDateFormatter — the official prebuilt archive, as LDBC publishes it.
#   Nothing is rewritten: the files land as the datagen wrote them.
# - geo/: OpenFlights airports and routes (ODbL; geo/NOTICE): the airports some
#   direct route touches, and the routes between them. The two upstream files
#   are pinned to one commit of jpatokal/openflights and to their digests, and
#   the subset derived from them to its own: the derivation is deterministic,
#   so a different subset is a failure here, not a different dev graph.
#
# Downloads land in infra/dev/.cache/ (gitignored) and are checked against the
# digests pinned here.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cache="$here/.cache"

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
mkdir -p "$cache"

ldbc() {
  url="https://datasets.ldbcouncil.org/snb-interactive-v1/social_network-sf0.1-CsvCompositeMergeForeign-StringDateFormatter.tar.zst"
  digest="4e3e8753e501b7fb181425bab4e34f3c7520ed66f09a84b2b9c3815f235900e5"
  archive="$cache/$(basename "$url")"
  out="$here/seed/ldbc"

  if [ -f "$out/.sha256" ] && [ "$(cat "$out/.sha256")" = "$digest" ]; then
    echo "seed: LDBC SNB SF0.1 already in $out"
    return
  fi
  needs curl tar zstd
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
}

geo() {
  # The last commit to touch either file (airports.dat, 2019-05-13).
  base="https://raw.githubusercontent.com/jpatokal/openflights/e3bc6dedbcceb8b7b74248a00dcd6207254da6bd/data"
  airports_dat="9387cdb38df5bd664da823f8ccb69fdd9b33a1888f5b7cca09c34a3cd9ff59f9"
  routes_dat="bd373706238134f619c624c606dccc74c05c2582a977c489c81de501735f2390"
  # What the derivation below writes from those two: 3,218 airports, 36,906 routes.
  airports_csv="890ed517a7b354326234357262552fc0f555cd86c52030e9b377a4db556f3f0a"
  routes_csv="7a74be1409b3b458ca331170c2916736552c1e66bfcc3e76b48faf8b9ec11724"
  out="$here/seed/geo"
  stamp="$airports_csv $routes_csv"

  if [ -f "$out/.sha256" ] && [ "$(cat "$out/.sha256")" = "$stamp" ]; then
    echo "seed: OpenFlights subset already in $out"
    return
  fi
  needs curl python3
  fetch "$base/airports.dat" "$airports_dat" "$cache/openflights-airports.dat"
  fetch "$base/routes.dat" "$routes_dat" "$cache/openflights-routes.dat"

  rm -f "$out/airports.csv" "$out/routes.csv" "$out/.sha256"
  # OpenFlights writes headerless CSV with `\N` for null. The subset is CSV with
  # a header row and an empty field for null, which both of fossil's readers
  # (DuckDB's sniffer, DataFusion's) read as NULL.
  #
  # - routes.csv: one row per directed airport pair that a direct (`stops` = 0)
  #   route flies, by OpenFlights airport ID, however many airlines fly it.
  # - airports.csv: the `airport`-type rows some such route touches, with their
  #   coordinates as OpenFlights has them (WGS 84 decimal degrees) and their
  #   altitude in feet. A route with an end that is not one of them goes too.
  python3 - "$cache/openflights-airports.dat" "$cache/openflights-routes.dat" "$out" <<'PY'
import csv, sys

airports_dat, routes_dat, out = sys.argv[1:]
null = lambda v: "" if v == "\\N" else v

pairs = set()
with open(routes_dat, encoding="utf-8", newline="") as f:
    for r in csv.reader(f):
        src, dst, stops = r[3], r[5], r[7]
        if stops == "0" and "\\N" not in (src, dst) and src != dst:
            pairs.add((int(src), int(dst)))
ends = {a for p in pairs for a in p}

airports = {}
with open(airports_dat, encoding="utf-8", newline="") as f:
    for id, name, city, country, iata, icao, lat, lon, alt, _, _, tz, kind, _ in csv.reader(f):
        if kind == "airport" and int(id) in ends:
            airports[int(id)] = [id, name, city, country, null(iata), null(icao), lat, lon, alt, null(tz)]

with open(f"{out}/airports.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["id", "name", "city", "country", "iata", "icao", "lat", "lon", "altitude", "timezone"])
    w.writerows(airports[a] for a in sorted(airports))
with open(f"{out}/routes.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["src", "dst"])
    w.writerows(p for p in sorted(pairs) if p[0] in airports and p[1] in airports)
PY

  for pin in "airports.csv $airports_csv" "routes.csv $routes_csv"; do
    set -- $pin
    if [ "$(sha256 "$out/$1" | cut -d' ' -f1)" != "$2" ]; then
      echo "seed: $out/$1 is not the pinned subset (sha256 $2)" >&2
      exit 1
    fi
    echo "$out/$1: OK"
  done
  echo "$stamp" > "$out/.sha256"
  echo "seed: OpenFlights subset ready in $out ($(du -sh "$out" | cut -f1)); \`make dev\` uploads it"
}

ldbc
geo
