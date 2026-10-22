"""CPI TTL -> one JSON per type + one JSON per (type, edge), shapes.shex, mapping.fossil.
Local only: never committed (the data is the client's)."""
import rdflib, json, sys, os, re, collections
from rdflib import RDF, URIRef, Literal
CPI = "https://example.org/ontology/cpi#"
SKOS = "http://www.w3.org/2004/02/skos/core#"
RDFS = "http://www.w3.org/2000/01/rdf-schema#"
DEMO = "https://example.org/cpi-demo/ns#"
XSD = "http://www.w3.org/2001/XMLSchema#"
src, out = sys.argv[1], sys.argv[2]
g = rdflib.Graph(); g.parse(src, format="turtle")
local = lambda u: re.split(r"[#/]", str(u))[-1]

types = collections.defaultdict(set)
for s, t in g.subject_objects(RDF.type): types[s].add(local(t))
KIND = {}
def assign(s):
    t = types[s]
    if "Phase" in t or t & {"TenderPhase", "AwardPhase", "PreparatoryPhase", "PreliminaryMarketConsultation"}:
        KIND[s] = ("Licitación" if "TenderPhase" in t else "Adjudicación" if "AwardPhase" in t else "Consulta preliminar al mercado")
        return "Phase"
    if t & {"Organization", "PublicEntity", "OrganizationGroup"}:
        KIND[s] = ("Entidad pública" if "PublicEntity" in t else "Agrupación" if "OrganizationGroup" in t else "Organización")
        return "Organization"
    if "MarketParticipation" in t: return "MarketParticipation"
    if "ProcedureParticipation" in t: return "ProcedureParticipation"
    if "ThematicArea" in t: return "ThematicArea"
    if "TerritorialScope" in t: return "TerritorialScope"
    if "Concept" in t: return "Concept"
    if "ConceptScheme" in t: return "ConceptScheme"
    if "CPIKnowledgeBase" in t: return "CPIKnowledgeBase"
    assert len(t) == 1, (s, t)
    return next(iter(t))
T = {s: assign(s) for s in types}
SHAPE_IRI = {"Concept": SKOS + "Concept", "ConceptScheme": SKOS + "ConceptScheme"}
shape_iri = lambda t: SHAPE_IRI.get(t, CPI + t)
# derivedFrom points at three types: one predicate per target, in the demo's namespace.
RENAME = {(CPI + "derivedFrom", "Need"): DEMO + "derivedFromNeed",
          (CPI + "derivedFrom", "Objective"): DEMO + "derivedFromObjective",
          (CPI + "derivedFrom", "Problem"): DEMO + "derivedFromProblem"}

lits = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))  # type->pred->subj->[vals]
dts = collections.defaultdict(collections.Counter)
edges = collections.defaultdict(set)  # (type, pred, target type) -> {(s, o)}
dropped = collections.Counter()
for s, p, o in g:
    if p == RDF.type or s not in T: continue
    st = T[s]
    if isinstance(o, URIRef):
        if o not in T: dropped[str(p)] += 1; continue
        ot = T[o]; pp = RENAME.get((str(p), ot), str(p))
        edges[(st, pp, ot)].add((str(s), str(o)))
    else:
        dt = str(o.datatype) if o.datatype else XSD + "string"
        dts[(st, str(p))][dt] += 1
        lits[st][str(p)][s].append(o)
# rdfs:label for every node, so the graph and the dashboard name it (kanzo-ui reads skos:prefLabel or
# rdfs:label): the title, else the prefLabel, else the text, cut to 80 characters.
def first(s, p):
    v = sorted(str(o) for o in g.objects(s, URIRef(p)))
    return v[0] if v else None
for s, t in T.items():
    if t in ("Concept", "ThematicArea", "TerritorialScope", "ConceptScheme"):
        lab = first(s, SKOS + "prefLabel")
        if lab: lits[t][RDFS + "label"][s].append(Literal(lab)); dts[(t, RDFS + "label")][XSD + "string"] += 1
        continue
    lab = first(s, CPI + "title") or first(s, CPI + "questionText") or first(s, CPI + "description") or first(s, CPI + "contractObject") or first(s, CPI + "identifier")
    if t == "CPIProject":
        acr = first(s, CPI + "acronym"); lab = lab or first(s, CPI + "summary")
        if acr and lab and not lab.upper().startswith(acr.upper()): lab = f"{acr} · {lab}"
    if not lab: continue
    lab = " ".join(lab.split())
    if len(lab) > 80: lab = lab[:79].rstrip() + "…"
    lits[t][RDFS + "label"][s].append(Literal(lab)); dts[(t, RDFS + "label")][XSD + "string"] += 1
for s, k in KIND.items():
    lits[T[s]][DEMO + "kind"][s].append(Literal(k)); dts[(T[s], DEMO + "kind")][XSD + "string"] += 1

# one predicate, one target type per source type
seen = collections.defaultdict(set)
for (st, p, ot) in edges: seen[(st, p)].add(ot)
bad = {k: v for k, v in seen.items() if len(v) > 1}
assert not bad, bad

SHEX_DT = {"date": "xsd:date", "decimal": "xsd:double", "nonNegativeInteger": "xsd:integer", "positiveInteger": "xsd:integer",
           "integer": "xsd:integer", "boolean": "xsd:boolean", "string": "xsd:string", "anyURI": "xsd:string"}
def jval(o, kind):
    v = o.toPython()
    if kind == "xsd:date": return str(o)
    if kind == "xsd:double": return float(v)
    if kind == "xsd:integer": return int(v)
    if kind == "xsd:boolean": return bool(v)
    return str(o)

NAMES = {"title", "prefLabel", "label", "altLabel", "identifier", "acronym", "currency", "email", "url", "sourcePath", "kind"}
os.makedirs(f"{out}/data", exist_ok=True); os.makedirs(f"{out}/shapes", exist_ok=True)
pfx = lambda u: ("cpi:" + u[len(CPI):] if u.startswith(CPI) else "skos:" + u[len(SKOS):] if u.startswith(SKOS)
                 else "rdfs:" + u[len(RDFS):] if u.startswith(RDFS) else "demo:" + u[len(DEMO):])
alltypes = sorted(set(T.values()))
shex = ["# CPI España, 15 projects — the shapes of the demo graph, from the integrated TTL (local, not in git).",
        f"PREFIX cpi:  <{CPI}>", f"PREFIX skos: <{SKOS}>", f"PREFIX rdfs: <{RDFS}>", f"PREFIX demo: <{DEMO}>", f"PREFIX xsd:  <{XSD}>", ""]
fossil = ["// CPI España, 15 projects: the integrated TTL as JSON (one file per type, one per edge), onto shapes.shex.",
          "// Every subject keeps its IRI from the TTL. Generated by convert.py; local, not in git.", "",
          "type { " + ", ".join(alltypes) + ' } := io.shex("@CPI España shapes/shapes.shex")', ""]
binds, maps, stats = [], [], {}
for t in alltypes:
    subjects = sorted(str(s) for s, tt in T.items() if tt == t)
    preds = sorted(lits[t])
    kinds = {}
    for p in preds:
        c = dts[(t, p)]
        dt = local(c.most_common(1)[0][0]); kinds[p] = SHEX_DT[dt]
    rows = []
    for s in subjects:
        r = {"iri": s}
        for p in preds:
            vals = lits[t][p].get(URIRef(s), [])
            vals = sorted(set(jval(v, kinds[p]) for v in vals), key=str)
            if not vals: r[local(p)] = None
            elif kinds[p] == "xsd:string" and local(p) not in NAMES: r[local(p)] = "\n\n".join(vals)
            else: r[local(p)] = vals[0]
        rows.append(r)
    json.dump(rows, open(f"{out}/data/{t}.json", "w"), ensure_ascii=False, indent=0)
    stats[t] = len(rows)
    fields = [f"  {pfx(p)} {kinds[p]} ?" for p in preds]
    for (st, p, ot) in sorted(edges):
        if st == t: fields.append(f"  {pfx(p)} @{pfx(shape_iri(ot))} *")
    shex.append(f"{pfx(shape_iri(t))} {{\n" + " ;\n".join(fields) + "\n}\n")
    R = f"{t}Row"
    binds.append(f'{R} := io.json("@CPI España/{t}.json")')
    m = [f"{t}s : {t} from {R}", f'    @subject = "{{{R}.iri}}"']
    w = max([len(local(p)) for p in preds] + [8])
    for p in preds:
        f = local(p); expr = f"{R}.{f}"
        if kinds[p] == "xsd:date": expr = f'parse.date({R}.{f}, "%Y-%m-%d")'
        m.append(f"    {f.ljust(w)} = {expr}")
    maps.append("\n".join(m))
for (st, p, ot) in sorted(edges):
    name = f"{st}_{local(p)}"; R = f"{name}Row"
    rows = [{"iri": s, "o": o} for s, o in sorted(edges[(st, p, ot)])]
    json.dump(rows, open(f"{out}/data/{name}.json", "w"), ensure_ascii=False, indent=0)
    binds.append(f'{R} := io.json("@CPI España/{name}.json")')
    maps.append(f"{name} : {st} from {R}\n    @subject = \"{{{R}.iri}}\"\n    {local(p)} = {ot}({R}.o)")
open(f"{out}/shapes/shapes.shex", "w").write("\n".join(shex))
open(f"{out}/mapping.fossil", "w").write("\n".join(fossil + binds + [""] + ["\n\n".join(maps)]) + "\n")
print(json.dumps(stats, indent=0)); print("edges", sum(len(v) for v in edges.values()), "edge files", len(edges)); print("dropped", dropped)
