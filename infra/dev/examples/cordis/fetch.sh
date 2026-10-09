#!/bin/sh
# Fetch the CORDIS example's data: Horizon Europe's projects, the organisations
# that take part in them and each participation, from the CORDIS "Horizon
# Europe projects" CSV dump (© European Union, CC BY 4.0; data/NOTICE), derived
# into data/ (gitignored), which the compose `s3-init` service uploads. A
# second run is a no-op.
#
# CORDIS replaces the dump at its URL in place, every few weeks, so the CORDIS
# URL names no fixed bytes. The pin is the Internet Archive's capture of it on
# 2026-08-19 (CORDIS's export of 2026-08-06): byte for byte what CORDIS served
# that day — the capture's SHA-1 in the Wayback index is the file's — and
# immutable since. The subset derived from it is pinned to its own digests: the
# derivation is deterministic, so a different subset is a failure here, not a
# different dev graph.
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

# `id_` asks the Wayback Machine for the capture's bytes as they were served.
url="https://web.archive.org/web/20260819212419id_/https://cordis.europa.eu/data/cordis-HORIZONprojects-csv.zip"
digest="f91d5b6d7f952a4eeb725f4917576ffba652b6b03739d2ba763fa67b5dee6d22"
# What the derivation below writes from it: 23,451 projects, 35,122
# organisations, 145,274 participations, and the 2,767 call topics and 15
# programme parts they are funded under.
projects_csv="00ab7c42b7027b77d22050b19d9877dcda9e98335f78712bd1e82b0e943158cd"
organisations_csv="30bb6ccde76250876ccd5168e91af275329b3ef3d7984134692709f5f95b626f"
participations_csv="7b405d7d4073d013ddc34f828e97f172526df92932dd9d3bb617529b94b6f8c0"
schemes_csv="0ec8d6813ff17ae0736d5289ec33ef35718a666e334bba19b483071fbeb47fad"
out="$here/data"
stamp="$projects_csv $organisations_csv $participations_csv $schemes_csv"

if [ -f "$out/.sha256" ] && [ "$(cat "$out/.sha256")" = "$stamp" ]; then
  echo "seed: CORDIS subset already in $out"
  exit 0
fi
needs curl python3
mkdir -p "$cache"
archive="$cache/cordis-HORIZONprojects-csv-20260806.zip"
fetch "$url" "$digest" "$archive"

rm -f "$out/projects.csv" "$out/organisations.csv" "$out/participations.csv" "$out/schemes.csv" "$out/.sha256"
# CORDIS writes `;`-separated UTF-8 with every field quoted, and its amounts
# with a decimal comma in some columns and a decimal point in others. The
# subset is CSV with a header row, a decimal point throughout and an empty
# field for null, which both of fossil's readers (DuckDB's sniffer,
# DataFusion's) read as NULL. Values are otherwise CORDIS's own.
#
# - projects.csv: every project, without its objective (the abstract, most of
#   the dump's bytes), keywords or the CORDIS bookkeeping columns, and with
#   the call topic it was funded under (topics.csv has one per project).
# - organisations.csv: one row per organisation (by its PIC), the attributes
#   organization.csv repeats on each of its participations, which agree for
#   every organisation, and its position split into `lat` and `lon`.
# - participations.csv: one row per row of organization.csv — an organisation
#   in a project, in one role — with what belongs to that relationship: the
#   role and its order in the consortium, the EU contribution (gross and net),
#   the participant's own costs, whether it counted as an SME in that grant,
#   which CORDIS records per participation, and whether it has ended.
# - schemes.csv: the funding schemes the projects name — the programme part
#   (legalBasis.csv's `uniqueProgrammePart` row, one per project) and the call
#   topic — with the programme part each topic belongs to. Every project
#   under a topic is under the same programme part, which this checks.
python3 - "$archive" "$out" <<'PY'
import csv, io, sys, zipfile

archive, out = sys.argv[1:]
csv.field_size_limit(sys.maxsize)

def rows(name):
    with zipfile.ZipFile(archive) as z, z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", newline=""), delimiter=";")

def amount(v):
    return v.replace(",", ".")

def write(name, header, body):
    with open(f"{out}/{name}", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(body)

topic_of, topic_title = {}, {}
for r in rows("topics.csv"):
    assert r["projectID"] not in topic_of, f"project {r['projectID']} has two topics"
    topic_of[r["projectID"]] = r["topic"]
    topic_title[r["topic"]] = r["title"]

part_of, part_title = {}, {}
for r in rows("legalBasis.csv"):
    if r["uniqueProgrammePart"] == "true":
        part_of[r["projectID"]] = r["legalBasis"]
        part_title[r["legalBasis"]] = r["title"]

projects = []
for r in rows("project.csv"):
    projects.append([r["id"], r["acronym"], r["title"], r["status"], r["startDate"], r["endDate"],
                     r["ecSignatureDate"], amount(r["totalCost"]), amount(r["ecMaxContribution"]),
                     r["fundingScheme"], topic_of[r["id"]]])
projects.sort(key=lambda p: int(p[0]))

topic_part = {}
for project, topic in topic_of.items():
    part = part_of[project]
    assert topic_part.setdefault(topic, part) == part, f"topic {topic} is under two programme parts"

organisations, participations, seen = {}, [], set()
for r in rows("organization.csv"):
    lat, lon = r["geolocation"].split(",") if r["geolocation"] else ("", "")
    organisation = [r["organisationID"], r["name"], r["shortName"], r["activityType"], r["country"], r["city"], lat, lon]
    assert organisations.setdefault(r["organisationID"], organisation) == organisation, \
        f"organisation {r['organisationID']} differs between its participations"
    key = (r["projectID"], r["organisationID"], r["role"], r["order"])
    assert key not in seen, f"participation {key} twice"
    seen.add(key)
    participations.append([r["projectID"], r["organisationID"], r["role"], r["order"],
                           amount(r["ecContribution"]), amount(r["netEcContribution"]), amount(r["totalCost"]),
                           r["SME"], r["endOfParticipation"]])
participations.sort(key=lambda p: (int(p[0]), int(p[3]), int(p[1]), p[2]))

write("projects.csv", ["id", "acronym", "title", "status", "startDate", "endDate", "signatureDate",
                       "totalCost", "ecMaxContribution", "fundingScheme", "topic"], projects)
write("organisations.csv", ["id", "name", "shortName", "activityType", "country", "city", "lat", "lon"],
      (organisations[o] for o in sorted(organisations, key=int)))
write("participations.csv", ["project", "organisation", "role", "order", "ecContribution",
                             "netEcContribution", "totalCost", "sme", "ended"], participations)
write("schemes.csv", ["code", "title", "parent"],
      [[p, part_title[p], ""] for p in sorted(set(topic_part.values()))]
      + [[t, topic_title[t], topic_part[t]] for t in sorted(topic_part)])
PY

for pin in "projects.csv $projects_csv" "organisations.csv $organisations_csv" \
           "participations.csv $participations_csv" "schemes.csv $schemes_csv"; do
  set -- $pin
  if [ "$(sha256 "$out/$1" | cut -d' ' -f1)" != "$2" ]; then
    echo "seed: $out/$1 is not the pinned subset (sha256 $2)" >&2
    exit 1
  fi
  echo "$out/$1: OK"
done
echo "$stamp" > "$out/.sha256"
echo "seed: CORDIS subset ready in $out ($(du -sh "$out" | cut -f1)); \`make dev\` uploads it"
