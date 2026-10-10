#!/bin/sh
# Fetch the Nobel example's data: every Nobel laureate and every prize awarded
# to 2025, from nobelprize.org's API (CC0; data/NOTICE), derived into six JSON
# files in data/ (gitignored), which the compose `s3-init` service uploads. A
# second run is a no-op.
#
# The API is live and has no versions — it grows every October and is corrected
# in between — so the download is not pinned, and what the derivation writes
# from it is: prizes to LAST_YEAR only, every list sorted, every string as the
# API spells it. A correction upstream is a failure here, not a different dev
# graph; re-pin the digests below when it is one you want.
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

url="https://api.nobelprize.org/2.1/laureates?limit=2000"
# What the derivation below writes: 1,018 laureates, 1,026 awards, 6
# categories, 379 institutions, 847 affiliations, 86 countries; 749 awards
# and 370 institutions with a position.
pins="
laureates.json    ea4de2622640308824b76742d46e86dccd83e6a4aa5a6239e9c80ec791d0137d
awards.json       deb1f923c4ff3b2543127a353abe030f558fb3d3610ad2fdfb5783bfcab2c8e4
categories.json   9f146a1a7f02c2d7d447383b3032c9f71a5145f1746222148963078ba0197141
institutions.json 93cde88e8313a2925ebf7a9ea45c2237c555e50a589382c186fd0a363ef6e6ae
affiliations.json 044b6131f4274b42af57288335fc83d299dfdd44ed7110f76703e2d09221a240
countries.json    210e57c03fb48999ff5cadee25b53cbe655f05ba610b038c2752944db9e8033e
"
out="$here/data"
stamp=$(echo "$pins" | awk 'NF { print $2 }' | tr '\n' ' ')

if [ -f "$out/.sha256" ] && [ "$(cat "$out/.sha256")" = "$stamp" ]; then
  echo "seed: Nobel laureates already in $out"
  exit 0
fi
needs curl python3
mkdir -p "$cache"
echo "seed: downloading $url"
curl -fL --retry 5 --retry-all-errors -o "$cache/nobel-laureates.json.part" "$url"
mv "$cache/nobel-laureates.json.part" "$cache/nobel-laureates.json"

rm -f "$out"/*.json "$out/.sha256"
# One row per laureate, award, category, institution, award–institution pair
# and country. An award is the prize one laureate won — the vertex the
# mapping's timeline reads — keyed by year, category and laureate. Places are
# the API's present-day ones (`countryNow`, `cityNow`), so a country is one
# country across the century. A person's birthplace is a country; an
# organisation's founding place is not one. `portion` (`1`, `1/2`, `1/3`, `1/4`)
# becomes its denominator, the vocabulary's `nobel:share`. A position is the
# present-day city's (`cityNow`'s `latitude` and `longitude`, WGS 84 decimal
# degrees, as the API spells them): an institution's is its city's, and an
# award's is its FIRST affiliation's city as the API lists them — 84 awards have
# two or more, and an award has one place on a map. An award with no
# affiliation, or whose first has no city on record, has no position.
python3 - "$cache/nobel-laureates.json" "$out" <<'PY'
import json, re, sys, unicodedata

LAST_YEAR = 2025
source, out = sys.argv[1:]

def en(field):
    return (field or {}).get("en")

def slug(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

def full_date(date):
    return date if date and re.fullmatch(r"\d{4}-\d\d-\d\d", date) and "-00" not in date else None

def position(affiliation):
    city = (affiliation or {}).get("cityNow") or {}
    return (city["latitude"], city["longitude"]) if city.get("latitude") and city.get("longitude") else (None, None)

def country(place):
    name = en((place or {}).get("countryNow"))
    return slug(name) if name else None

laureates, awards, affiliations = [], [], []
categories, institutions, countries = {}, {}, {}

for l in json.load(open(source, encoding="utf-8"))["laureates"]:
    prizes = [p for p in l["nobelPrizes"] if int(p["awardYear"]) <= LAST_YEAR]
    if not prizes:
        continue
    person = "orgName" not in l
    origin = l.get("birth") if person else l.get("founded")
    born = country((origin or {}).get("place")) if person else None
    if born:
        countries[born] = en(origin["place"]["countryNow"])
    laureates.append({
        "id": l["id"],
        "name": en(l.get("knownName")) or en(l.get("orgName")),
        "kind": "person" if person else "organization",
        "gender": l.get("gender"),
        "birthDate": full_date((origin or {}).get("date")),
        "country": born,
    })
    for p in prizes:
        category = slug(en(p["category"]))
        categories[category] = en(p["category"])
        award = f"{p['awardYear']}-{category}-{l['id']}"
        lat, lon = position((p.get("affiliations") or [None])[0])
        awards.append({
            "id": award,
            "laureate": l["id"],
            "category": category,
            "year": p["awardYear"],
            "share": p["portion"].split("/")[-1],
            "motivation": en(p.get("motivation")),
            "lat": lat,
            "lon": lon,
        })
        for a in p.get("affiliations", []):
            name = en(a.get("nameNow")) or en(a.get("name"))
            if not name:
                continue
            place = country(a)
            institution = slug(f"{name} {en(a.get('cityNow')) or ''}")
            lat, lon = position(a)
            institutions[institution] = {"id": institution, "name": name, "city": en(a.get("cityNow")), "country": place, "lat": lat, "lon": lon}
            if place:
                countries[place] = en(a["countryNow"])
            affiliations.append({"award": award, "institution": institution})

tables = {
    "laureates": sorted(laureates, key=lambda r: int(r["id"])),
    "awards": sorted(awards, key=lambda r: r["id"]),
    "categories": [{"id": k, "name": v} for k, v in sorted(categories.items())],
    "institutions": sorted(institutions.values(), key=lambda r: r["id"]),
    "affiliations": sorted({(a["award"], a["institution"]): a for a in affiliations}.values(),
                           key=lambda r: (r["award"], r["institution"])),
    "countries": [{"id": k, "name": v} for k, v in sorted(countries.items())],
}
for name, rows in tables.items():
    with open(f"{out}/{name}.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
PY

echo "$pins" | while read -r file digest; do
  [ -n "$file" ] || continue
  if [ "$(sha256 "$out/$file" | cut -d' ' -f1)" != "$digest" ]; then
    echo "seed: $out/$file is not the pinned derivation (sha256 $digest)" >&2
    exit 1
  fi
  echo "$out/$file: OK"
done
echo "$stamp" > "$out/.sha256"
echo "seed: Nobel laureates ready in $out ($(du -sh "$out" | cut -f1)); \`make dev\` uploads it"
