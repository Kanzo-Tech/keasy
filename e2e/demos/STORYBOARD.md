# The product demos — storyboard

The seven videos on keasy.github.io's hero, written as stories before they are written as code, so
that once `@kanzo-tech/testing` ships (kanzo-ui v0.35.0) each `*.demo.ts` is a transcription of its
table here. Review the stories first; the code follows them.

**The rules every demo keeps** (`demo-video-style`): subtitles only, no title cards; recorded at
native 1600×900; each step's subtitle **leads** it (the `chapter()` call comes before the action it
describes); short waits, and every wait is on a state (a harness method), never on a time; map demos
hide edges and labels and use legible marks; a demo starts from a configured state, set off camera in
`arrange`, unless the configuration is the point.

**How to read a step**

| Subtitle (≤ 60 chars) | Action | Check |
| --- | --- | --- |
| what `chapter()` shows, before the action | the exact harness / page-object call; brushes and lassos in data | what must be true after, asserted with `expect.poll` over a harness method |

`env` is `await playwright(page)`, made **before** the first `page.goto` (the hook registers charts
and canvases as they mount). `bar` is `await env.harness(FilterBarHarness)`. `discover`, `settings`,
`search`, `rules`, `ask` are the keasy page objects listed at the end
([Page objects](#the-keasy-page-objects-the-demos-need)). The filter bar has no readout: what the
filters keep is read from the dashboard's count figure, `discover.figure("Rows")` (in full under ten
thousand, compact above: `"778"`, `"23.5K"`), or in the Graph view from the footer's GraphCounts,
`graph.counts()` → `/^132 of 3\.2K nodes match/` (compact, the total being every node).

Every number below was computed from the example's CSV/JSON with DuckDB; the query is under each
demo's **Numbers**. The OpenFlights and SNB queries run in `infra/dev/examples/<name>/data` after
`sh infra/dev/seed.sh`; CORDIS's in PR #118's `infra/dev/examples/cordis/data`; Nobel's in PR #119's
`infra/dev/examples/nobel/data`.

---

## 1. Analytics — `snb-explore`

- **Hero tab:** `explore` · label **Analytics**
- **Stat line:** *327K nodes · 765K edges — explored in your browser* (unchanged)
- **Example / seed:** `snb` · `seedGraph(page, "snb", { name: "Demo · LDBC Social Network", reuse: true })`

**Arrange (off camera)**

1. `env = await playwright(page)`; seed.
2. `page.goto(discoverUrl(id, { view: "dashboard" }))` — never the Graph view: 327K nodes.
3. `dashboard = await env.harness(DashboardHarness); await dashboard.settled()`.

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | Pick what to explore | `await discover.relation("Person")` | `dashboard.tile("Count by Person.gender")` resolves; `discover.figure("Rows")` → `"1,528"` and `discover.counts()` matches nothing: no filter yet |
| 2 | Every column gets a chart — click a bar to filter | `(await (await dashboard.tile("Count by Person.gender")).chart()).pick({ y: "female" })` | `discover.figure("Rows")` → `"778"`; `discover.counts()` → `/^778 of /`; `bar.chips()` contains `Person.gender …female` |
| 3 | Drag across time to narrow it further | `(await (await dashboard.tile("Count by Person.birthday")).chart()).brush({ x: [new Date("1985-01-01"), new Date("1990-01-01")] })` | `discover.figure("Rows")` → `"391"` · **poster** |
| 4 | Every filter lands in the bar | hover the `Person.gender` chip (page: `bar` has no hover; `page.getByRole("button", { name: /Person\.gender/ }).hover()` stays in the spec as the one raw call, or `discover.hoverChip("Person.gender")`) | `bar.chips()` has two entries: gender and birthday |

The brush is written in data now: *born 1985–1989*, where today's take drags 30 %→62 % of the width
(≈ 1983–1986, a range no subtitle could name).

**Numbers** (`data/dynamic/person_0_0.csv`, `delim='|'`)

| Figure | Value | Query |
| --- | --- | --- |
| People | 1,528 (all ids distinct) | `select count(*), count(distinct id) from p` |
| Women / men | 778 / 750 | `select gender, count(*) from p group by 1` |
| Birthdays | 1980-02-06 … 1990-01-28 | `select min(birthday), max(birthday) from p` |
| Women born 1985–1989 | 391 | `select count(*) from p where gender='female' and birthday >= '1985-01-01' and birthday < '1990-01-01'` |
| Nodes in the graph | 327,588 → "327K" | sum of the mapped rows: organisation 7,955 + place 1,460 + tag 16,080 + tagclass 71 + comment 151,043 + forum 13,750 + person 1,528 + post 135,701 |

The "765K edges" half of the stat line is GraphCounts' own figure and was not recomputed here (it
depends on which relations the mapping writes as edges); read it off GraphCounts on the next take.

**Risks**

- The birthday histogram's brush may snap to its bins. If the figure reads other than 391, the bins
  are what it counted: take the check from `discover.figure("Rows")` once and pin it, the subtitle names no number.
- The `Person.gender` chip text is the page's (`Person.gender: female`?) — pinned on the first run.

---

## 2. Hidden patterns — `flights-map`

- **Hero tab:** `map` · label **Hidden patterns**
- **Stat line:** *Place points by their columns — patterns no link ever drew* (unchanged)
- **Example / seed:** `openflights` · `seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true })`

**Arrange (off camera)**

1. `env = await playwright(page)`; seed; `discover.open(id)` (Graph view, Info docked).
2. `graph = await env.harness(GraphCanvasHarness); await graph.ready()`.
3. Let the force layout spread the cloud: `await graph.run()`, then wait on frames, not time —
   `await env.until(async () => (await graph.frames()) > 300, "the layout spread")` — then
   `graph.pause()`.
4. `settings.marks("Legible"); settings.edges("Hidden"); settings.labels(0)` — the 36,906 routes are fog.
5. Dock back to Info (`dock.open("Info")`).

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | A graph of airports, spread by its routes | `graph.run()` (woken, so the cloud moves on camera) | the transport reads *Pause the layout*; `graph.counts()` → `/3,218 nodes/` (or `3.2K`) |
| 2 | Put it on a map: longitude across, latitude up | `settings.placement("Map", { x: "lon", y: "lat" })` then `graph.pause()` | `graph.frames()` grew; the placement radio *Map* is checked · **poster** |
| 3 | Find anything — here, every airport in Spain | `search.add("country:Spain")` (Info → *Find anything in the graph* → type → *Add 40 to the subset*) | the add button read `Add 40 to the subset`; `graph.counts()` → `/^40 of 3\.2K nodes match/` |
| 4 | Lasso the peninsula — the Canaries stay out | `graph.lasso(PENINSULA)` (the polygon below, in lon/lat) | `graph.counts()` → `/^31 of 3\.2K nodes match/` |
| 5 | Frame what you kept | `graph.frame()` | `graph.frame()` resolved (a frame drawn after the press); `graph.counts()` still `/^31 of 3\.2K nodes match/` |

The last step replaces *"The map keeps only what you picked"*: `frame()` frames what is in full
colour since kanzo-ui #112, which is what the old take could not do (keasy #112's comment). Framing
the 40 would take in the Canaries and the Atlantic down to Morocco's latitude, so step 4 lassoes the
peninsula first, as decided.

**The lasso, in data** (`x` = lon, `y` = lat, the Map placement's own axes):

```ts
const PENINSULA: [number, number][] = [
  [-9.5, 44], [-1.7, 43.6], [-1.5, 43.2], [3.3, 42.3], [4.6, 40.2], [4.6, 38.5], [0.5, 38.3],
  [-2, 36.5], [-5.2, 36.3], [-6.4, 36.4], [-7.4, 37.3], [-7.3, 38.5], [-6.6, 40.5], [-6.6, 41.8],
  [-8.2, 41.9], [-9.3, 41.9],
];
```

It follows the Portuguese border and the Pyrenees and takes in the Balearics, so it catches **31
airports, every one of them Spanish** (28 on the peninsula, Palma, Ibiza and Menorca): the count
is 31 whether the lasso's clause is ANDed with the search's or stands alone. Left out of the 40: the
8 Canaries and Melilla. No airport of Portugal, France, Andorra, Gibraltar or Morocco is inside.

**Numbers** (`data/airports.csv`)

| Figure | Value | Query |
| --- | --- | --- |
| Airports | 3,218 | `select count(*) from 'airports.csv'` |
| Routes | 36,906 | `select count(*) from 'routes.csv'` |
| Airports in Spain | 40 | `select count(*) from a where country='Spain'` |
| …of them in the Canaries | 8 (lat < 30) | `select count(*) from a where country='Spain' and lat<30` |
| Spain's extent | lon −17.9 … 4.2, lat 27.8 … 43.6 | `select min(lat),max(lat),min(lon),max(lon) from a where country='Spain'` |
| In the `PENINSULA` lasso | 31, all Spain (Melilla and the 8 Canaries out); extent lon −8.63 … 4.22, lat 36.67 … 43.56 | point-in-polygon (even–odd) over every airport's (lon, lat); DuckDB spatial: `select country, count(*) from a where ST_Contains(ST_GeomFromText('POLYGON((-9.5 44, …, -9.3 41.9, -9.5 44))'), ST_Point(lon, lat)) group by 1` |

**Risks**

- `graph.lasso` takes data coordinates; with the Map placement those are lon/lat. If the harness
  takes a closed ring, repeat the first point. A plain box (`[-10, 35]` … `[5, 44.5]`) is not a
  substitute: it catches 57 airports, 13 of them in France, 5 in Algeria and 3 in Morocco.
- The force layout needs the GPU (the demos project runs Chromium on it); the frame count in arrange
  is a state, but how spread 300 frames is depends on the machine. Tune once.

---

## 3. Crossfilter — `flights-crossfilter`

- **Hero tab:** `crossfilter` · label **Crossfilter**
- **Stat line:** *One filter for every chart and the map* (unchanged)
- **Example / seed:** `openflights`, same graph as demo 2 (`reuse: true`)

**Arrange (off camera)**

1. `env`; seed; `discover.open(id)`; `graph.ready()`; `graph.pause()`.
2. `settings.placement("Map", { x: "lon", y: "lat" }); settings.marks("Legible"); settings.edges("Hidden"); settings.labels(0)` — the Graph view, set for step 3.
3. `discover.view("Dashboard")`; `dashboard.settled()`.

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | Click a country — every chart follows | `(await (await dashboard.tile(/Count by Airport\.country/)).chart()).pick({ y: "United States" })` | `discover.figure("Rows")` → `"551"`; `dashboard.settled()` |
| 2 | Drag across longitude — just the West | `(await (await dashboard.tile(/Count by Airport\.lon$/)).chart()).brush({ x: [-125, -100] })` | `discover.figure("Rows")` → `"132"` · **poster** |
| 3 | Switch to the graph — the same filter, on the map | `discover.view("Graph")`; `graph.ready()` | `graph.counts()` → `/^132 of 3\.2K nodes match/` |
| 4 | Frame what the filters keep | `graph.frame()` | resolved; `bar.chips()` has the country and the lon clauses |

The old opening chapter *"One filter, every chart"* (a subtitle with no action under it) goes: the
first subtitle now leads the first click. The old last chapter *"Every filter lands in the bar"*
becomes the check of step 4 rather than a step of its own — the frame is the stronger ending.

**Numbers**

| Figure | Value | Query |
| --- | --- | --- |
| Top country by airports | United States, 551 (then Canada 206, China 173) | `select country, count(*) from a group by 1 order by 2 desc limit 5` |
| US airports at lon −125 … −100 | 132 | `select count(*) from a where country='United States' and lon between -125 and -100` |
| Every airport at lon −125 … −100 | 213 | `select count(*) from a where lon between -125 and -100` |

**Risks**

- Whether the lon brush filters by its extent or by the bins it covers: by extent it is 132; read the
  figure on the first run and pin it.
- `graph.counts()` reads GraphCounts' sentence; with a type filter it may read *132 of 3.2K nodes
  match*. Match the leading figure only.

---

## 4. Ask — `snb-ask`

- **Hero tab:** `ask` · label **Ask**
- **Stat line:** *Every answer is a query over what's in view — with its chart* (unchanged)
- **Example / seed:** `snb`, same graph as demo 1

**Arrange (off camera)**

1. `env`; seed; `page.goto(discoverUrl(id, { view: "dashboard", panel: "ask" }))`.
2. `discover.relation("Person")`; `dashboard.settled()`.
3. `ask.warmUp()` — both model aliases loaded (today's `warmUp`, moved into the page object).
4. `answer = await env.harness(AnswerHarness.with({ name: "Ask about your data…" }))`.

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | Filter the page: women only | `(await (await dashboard.tile("Count by Person.gender")).chart()).pick({ y: "female" })` | `discover.figure("Rows")` → `"778"` |
| 2 | Ask about what's in view, in plain words | `answer.ask("Which browsers do they use most?")` | a new answer card began (the method's own wait) |
| 3 | The answer is a chart, over the women in view | `tile = await answer.answer()` | `tile.text()` contains `Firefox` and `324` (not `628`, the count over everyone) · **poster** |
| 4 | Add it to the dashboard | `answer.addToDashboard()` | the card reads *✓ On the dashboard*; `dashboard.tile(/browserUsed/)` resolves |

*"Send the answer back as a filter"* is dropped as decided: the answer ends on the dashboard.

**Replaying the model**

kanzo-ui's workspace showcase (`docs/showcases/workspace/graph-view.tsx`, `GraphAsk`) shows Ask
without a model: `dataAgent` runs over `mockModel` (`docs/lib/mock-model.ts`, the AI SDK's
`MockLanguageModelV4`), a *recording* that matches the question to an intent and returns the
`answer` tool call with that intent's tile, then reads its sentence off the rows the tool brought
back. The language is canned; the tool still queries the corpus for real under the page's
crossfilter. Swapping the recording for the gateway model is one line.

keasy's model is behind the BFF, so the demo records at the network instead, with the same split —
the model's words replayed, the `answer` tool run for real by the page:

1. **Capture, once, from a good live run** — `make demo DEMO=snb-ask LIVE=1 RECORD=1`. In arrange,
   `page.route(AI, async (route) => { const r = await route.fetch(); calls.push({ ask: lastUser(route.request()), body: await r.text() }); await route.fulfill({ response: r }); })`
   (`AI` = `**/api/ai/chat/completions`, `support/fixtures.ts`). After the take's checks pass (the
   tile says `Firefox`/`324`, the card is on the dashboard), write `calls` to
   `e2e/demos/recordings/snb-ask.json`: one SSE body per model call, in order — the tool-call turn,
   then the turn after the tool. A take whose checks fail writes nothing, so a refused query is
   never recorded.
2. **Replay, for the site take** (the default) — `page.route(AI, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: next(route.request()) }))`,
   where `next` serves the recorded bodies in order and throws when a request's last user message
   is not the recorded one (the question changed: re-capture). `sse()`/`text()` in
   `support/fixtures.ts` already build this stream format for the e2e tests.
3. `ask.warmUp()` is skipped on replay (no model to load); it stays on `LIVE=1`.

Because the tool runs on the page, the chart's numbers (Firefox 324 over the women in view) are
still DuckDB's, and the check still fails if the recorded tool call drops the filter. Re-capture
when the prompt, the tool's schema or the SNB example change.

**Numbers**

| Figure | Value | Query |
| --- | --- | --- |
| Women | 778 of 1,528 | `select gender, count(*) from p group by 1` |
| Women's browsers | Firefox 324 · Chrome 224 · Internet Explorer 182 · Safari 26 · Opera 22 | `select browserUsed, count(*) from p where gender='female' group by 1 order by 2 desc` |
| Everyone's browsers | Firefox 628 · Chrome 438 · IE 364 · Safari 54 · Opera 44 | the same, without the `where` |

**Risks**

- **The model — decided: the site take replays a recorded answer; the live model stays covered by
  the e2e tests** (`e2e/tests/ai.spec.ts` and the smoke runs). See *Replaying the model* below.
- The check that the answer counts **women** (324, not 628) is what proves "over what's in view";
  a model that drops the filter fails it.
- **keasy must wire `AnswerCard`'s `onAdd`.** kanzo-ui main has the AnswerCard with *Add to the
  dashboard*, but keasy's `ask-panel.tsx` passes no `onAdd` today (no match for `onAdd` in `web/src`):
  without it `addToDashboard()` rejects with *the host gave it no onAdd*. Part of the v0.35 upgrade.

---

## 5. Assessment — `flights-rules`

- **Hero tab:** `rules` · label **Assessment**
- **Stat line:** *3,218 airports assessed against your rules — in your browser* (unchanged)
- **Example / seed:** `openflights`, same graph; rules from `infra/dev/examples/openflights/rules.ttl`

**Arrange (off camera)**

1. `env`; seed; `api(page, "PUT", /v1/graphs/${id}/rules, { name: "geo.ttl", shapes })` (as today).
2. `discover.open(id, { panel: "rules" })`; `graph.ready()`; `graph.pause()`; `settings`: Map, lon/lat, Legible, Hidden edges, no labels (the shared `onMap`, as a page-object method `discover.onMap()`).
3. `discover.widenDock(280)`; `rules.checked()` → `/^Checked over all 3,218 nodes$/`.

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | Every airport, checked against your rules | — (the panel is read) | `rules.rule("Airport").state()` → *2 violations · 2 warnings* |
| 2 | 44 airports break a rule — show them all | `rules.rule("Airport").showAll("violations")` (presses *Show all 44 violations*) | the button is pressed; `graph.counts()` → `/^44 of 3\.2K nodes match/` |
| 3 | Amber warns: 218 airports above 4,000 ft | `rules.rule("Airport").show(/high-altitude airport/)` | button `Showing 218`; `graph.counts()` → `/^218 of 3\.2K nodes match/` · **poster** |
| 4 | The Rockies, the Andes, Iran, Ethiopia, Tibet | `graph.frame()` | resolved |

Step 3 is the high-altitude finding (218), not *Show all 245 warnings*: the subtitle and the frame
are about altitude, and the 29 airports without a time zone would add points that are not high. If
a take wants the severity instead, step 3 is `showAll("warnings")` → `/^245 of 3,218\b/` and its
subtitle *Amber warns: 245 airports, most of them high* — but step 4 then frames more than the
mountains. Recommended: the finding. The subtitle of step 4 is 45 characters.

**Numbers** (`data/airports.csv`; the rules are `rules.ttl`)

| Figure | Value | Query |
| --- | --- | --- |
| No IATA code (violation) | 20 | `select count(*) from a where iata is null` (none present-but-malformed: 0) |
| ICAO not four letters (violation) | 24 | `select count(*) from a where icao is not null and not regexp_full_match(icao,'[A-Z]{4}')` |
| Airports with a violation | 44 (the two sets are disjoint) — *Show all 44 violations* | `… where iata is null or (icao is not null and not regexp_full_match(icao,'[A-Z]{4}'))` |
| No time zone (warning) | 29 | `select count(*) from a where timezone is null` |
| Above 4,000 ft (warning) | 218 | `select count(*) from a where altitude > 4000` |
| Airports with a warning | 245 (29 + 218, two airports in both) — *Show all 245 warnings* | `… where timezone is null or altitude > 4000` |
| …where | US 46 · China 29 · Mexico 15 · Iran 14 · Ethiopia 9 · Peru 8 · Colombia 8 · Mongolia 7 · Bolivia 6 · Turkey 6 | `select country, count(*) from a where altitude>4000 group by 1 order by 2 desc limit 10` |
| …by region (boxes) | Rockies/US–Mexico west 48 · Andes 30 · Tibet/Qinghai 17 · Iran 14 · Mexican plateau 13 · Ethiopian highlands 9 · elsewhere 87 | `case when lon between -125 and -100 and lat>25 … end` over the same 218 |
| Highest | Daocheng Yading 14,472 ft (China); El Alto, La Paz 13,355 ft | `select name, country, altitude from a order by altitude desc limit 5` |

**Was in the way — now settled**

- **"Show 44" is a product change**, Kanzo-Tech/keasy#127: per rule, *Show all N violations* and
  *Show all N warnings* publish the union of that severity's focus nodes as the panel's one clause
  (`Airport · violations`). Over OpenFlights: 44 violations, 245 warnings. The demo needs it merged
  and `RulesPanel`'s `rule(name).showAll("violations" | "warnings")` (presses *Show all N …*, waits
  on `aria-pressed`).
- The rule's badge counts **findings**, not airports (*2 violations · 2 warnings*), so no badge reads
  44 or 218; the Show-all button is what names 44.
- Step 4's subtitle names the regions the 218 sit in by weight: the Rockies and the US–Mexico west
  (48), the Andes (30), Iran (14), the Ethiopian highlands (9), Tibet and Qinghai (17). The US (46),
  China (29) and Mexico (15) lead by country. The frame of 218 points over four continents is close
  to the world view; the step reads as "where they are" rather than a zoom.

**Risks**

- Rules validate in the browser (rudof); arrange waits on *Checked over all*, up to 120 s today.
- The removed step *"Or only the airports that pass"* stays out, as decided.

---

## 6. EU research funding — `cordis-funding` (new)

- **Hero tab:** `cordis` · label **EU research funding**
- **Stat line:** *€62.5B of Horizon Europe, 145K participations — in your browser*
- **Example / seed:** `cordis` (PR #118) · `seedGraph(page, "cordis", { name: "Demo · CORDIS Horizon Europe", reuse: true })`

### The story, from the data

Who gets Horizon Europe's money? The graph holds 23,451 projects, 35,122 organisations and 145,274
participations (an `OrganisationRole` vertex between an organisation and a project, carrying the
role and the EU contribution) — €62.55B in all. Candidates, and what the data says about each:

| Candidate | What the data says | Kept? |
| --- | --- | --- |
| By country | Germany €9.85B (15.7 %), France €6.80B, Spain €6.50B, Italy €5.17B, Netherlands €5.09B. Spain has almost Germany's seats (15,848 vs 16,125) and €3.35B less | as the opening chart |
| Coordinators vs participants | Coordinators hold 23,451 of 145,274 seats (16 %, one in six) and €26.82B (42.9 %); participants 90,869 seats, €35.6B; associated partners 24,696 seats and **no** contribution | **yes** — one click, both numbers on screen |
| By kind of organisation | Universities (HES) are 2,903 of 35,122 organisations (8 %) and take €22.99B (36.8 %); companies (PRC) are 20,314 (58 %) and take €15.83B (25.3 %) | **yes** — the most striking ratio |
| Universities as coordinators | 14,088 of the 23,451 coordinators are universities: **six projects in ten** | **yes**, compounding the two above |
| By programme | ERC €11.92B over 6,469 projects; MSCA 8,617 projects (the most) for €5.13B | no — the programme is two hops away (Project → topic → programme); a relation of its own |
| Over time (startDate) | 2022 €9.98B · 2023 €14.99B · 2024 €13.32B · 2025 €10.39B · 2026 €11.57B — flat, no story | no |
| Organisation network on the graph | ~206.6K vertices (with 145K participation vertices), 1,675 organisations with no position | no — see Risks; kept as an optional sixth step |
| A rule finding | **12,525 of 23,451 projects (53 %) declare a total cost of 0** — 6,682 of them MSCA postdoctoral fellowships, 1,248 ERC Proof of Concept | **yes**, the ending |

### Arrange (off camera)

1. `env`; seed `cordis`.
2. Rules: `api(page, "PUT", /v1/graphs/${id}/rules, { name: "cordis.ttl", shapes: <infra/dev/examples/cordis/rules.ttl> })`.
3. The dashboard, saved through the API so its tiles sum money rather than count rows (the automatic
   dashboard only counts): `api(page, "PUT", /v1/graphs/${id}/dashboard, { spec: { byRelation: { "OrganisationRole>isRoleOf>Organisation": spec } } })` with `spec.tiles`:
   - stat *Total ecContribution* (`{ op: "sum", field: "OrganisationRole.ecContribution" }`) and stat *Rows*;
   - chart *Total OrganisationRole.ecContribution by Organisation.country* (bar, top 12);
   - chart *Total OrganisationRole.ecContribution by Organisation.activityType*;
   - chart *Count by OrganisationRole.roleLabel*.
   The column names and the relation key are the page's (`relationKey`, `alias.name`): pin them by
   saving the spec once from the UI and reading `GET /v1/graphs/{id}/dashboard`.
4. `page.goto(discoverUrl(id, { view: "dashboard", panel: "rules" }))`; `discover.relation("OrganisationRole", ["isRoleOf → Organisation"])`; `dashboard.settled()`; `rules.checked()` resolves.

### Steps

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | €62.5 billion of Horizon Europe — who gets it? | — (the dashboard is read) | stat *Total ecContribution* reads `62.5B` (or `62.55B`); the country chart's top bar is `DE` |
| 2 | Coordinators: one seat in six, 43% of the money | `(await (await dashboard.tile(/by OrganisationRole\.roleLabel/)).chart()).pick({ y: "coordinator" })` | `discover.figure("Rows")` → `"23.5K"` (23,451 of 145,274); total reads `26.8B` |
| 3 | Universities coordinate six projects in ten | `(await (await dashboard.tile(/by Organisation\.activityType/)).chart()).pick({ y: "HES" })` | `discover.figure("Rows")` → `"14.1K"` (14,088 of 145,274); total reads `12.5B` · **poster** |
| 4 | Germany and the Netherlands lead them | — (the country chart, now over university coordinators, is read) | the top two bars are `DE` (€1.88B) and `NL` (€1.40B) |
| 5 | A rule finds 12,525 projects that declare a cost of 0 | `rules.rule("Project").show(/total cost of 0/)` | its button reads `Showing 12,525` |

Step 4 is optional (it is a reading, not an action); with it the demo is five steps, without it four.

### Numbers (`cordis/data`)

```sql
create view pr as select * from 'projects.csv';
create view o  as select * from 'organisations.csv';
create view pa as select * from 'participations.csv';
create view r  as select pa.*, o.country, o.activityType from pa join o on o.id = pa.organisation;
```

| Figure | Value | Query |
| --- | --- | --- |
| Projects · organisations · participations | 23,451 · 35,122 · 145,274 | `count(*)` over each file |
| EU contribution | €62.55B over participations (€62.42B as projects' `ecMaxContribution`) | `select sum(ecContribution) from pa` / `select sum(ecMaxContribution) from pr` |
| By country | DE €9.85B (16,125 seats) · FR €6.80B (13,241) · ES €6.50B (15,848) · IT €5.17B (13,660) · NL €5.09B (8,845) | `select country, sum(ecContribution), count(*) from r group by 1 order by 2 desc` |
| By role | coordinator 23,451 / €26.82B / 42.9 % · participant 90,869 / €35.6B / 56.9 % · thirdParty 6,258 / €0.13B · associatedPartner 24,696 / none | `select role, count(*), sum(ecContribution) from pa group by 1` |
| By kind of organisation | HES 2,903 orgs, 52,017 seats, €22.99B (36.8 %) · REC 3,538 / €17.13B · PRC 20,314 / €15.83B (25.3 %) · OTH 5,340 / €4.20B · PUB 3,026 / €2.41B | `select activityType, count(*) from o group by 1`; `select activityType, count(*), sum(ecContribution) from r group by 1` |
| University coordinators | 14,088 seats, €12.53B | `select count(*), sum(ecContribution) from r where role='coordinator' and activityType='HES'` |
| …by country | DE 1,642 / €1.88B · NL 1,303 / €1.40B · IT 1,634 / €1.11B · UK 1,204 / €0.99B | `… group by country order by sum desc` |
| Total cost 0 | 12,525 projects; by scheme MSCA-PF-EF 6,682 · ERC-POC 1,248 · CSA 877 · MSCA-PF-GF 759 · MSCA-DN 638 | `select fundingScheme, count(*) from pr where totalCost=0 group by 1 order by 2 desc` |
| By programme | ERC 6,469 / €11.92B · Climate, Energy and Mobility 1,500 / €10.29B · Digital, Industry and Space 1,370 / €9.85B · MSCA 8,617 / €5.13B | `pr join schemes t on t.code=pr.topic join schemes p on p.code=t.parent group by p.code` |
| By start year | 2022 €9.98B · 2023 €14.99B · 2024 €13.32B · 2025 €10.39B · 2026 €11.57B | `select year(startDate), sum(ecMaxContribution) from pr group by 1` |

### Risks

- **The dashboard is saved through the API**, a shape (`Dashboards`, `byRelation`) the demo now
  depends on; if it changes, arrange fails loudly. The alternative, editing tiles on camera, is three
  steps no reader wants.
- **The relation is not in the URL**: picking the root and the hop is a page-object call
  (`discover.relation`), done off camera.
- **Rules over 206.6K vertices in the browser**: the first check may take long; arrange waits on
  `rules.checked()`. The panel checks *the page's subset*: after steps 2–3 it re-checks over the
  selection. The clauses are on OrganisationRole and Organisation, and a clause leaves other types
  whole, so the Project finding should still read 12,525 — verify on the first run; if it does not,
  move step 5 first.
- **No Graph step.** The graph has ~206.6K vertices, 145K of them participations with no position, so
  a Map placement leaves most of the graph unplaced; the force layout of that size is the timing risk
  the SNB demos already avoid. Optional sixth step, gated on a GPU timing check: *"The same filter on
  the map: Europe's university coordinators"* — `discover.view("Graph")`, Map on Organisation's
  lon/lat, `graph.frame()`.
- The money figures are formatted by the stat tile (`62.5B`, `€62.5B`, `62,550,…`): pin on the first run.

---

## 7. Nobel timeline — `nobel-timeline` (new)

- **Hero tab:** `nobel` · label **Nobel timeline**
- **Stat line:** *1,026 Nobel prizes since 1901 — play them forward in time*
- **Example / seed:** `nobel` (PR #119) · `seedGraph(page, "nobel", { name: "Demo · Nobel laureates", reuse: true })`
- **Depends on:** `GraphTimeline` on its own crossfilter, its brush snapped to five-year bars
  (kanzo-ui #152, v0.37.0; keasy #132), under both views (keasy #133); the setting `time-by`,
  labelled **Timeline** in the graph's Settings.

**Arrange (off camera)**

1. `env`; seed; `discover.open(id)`; `graph.ready()`.
2. `settings.timeline("date")` — the Settings select *Timeline* set to `date` (the award's year,
   `xsd:gYear`; `birthday` is the other temporal column it offers).
3. `settings.marks("Legible"); settings.labels(0)`; run the layout to a spread (frames, as demo 2), pause.
4. Save the dashboard for the relation `LaureateAward>university>University>addressCountry>Country`
   with the chart *Count by Country.name* (bar, top 8), as demo 6 does — the reading of step 4.
5. `timeline = await env.harness(TimelineHarness.with({ title: "Timeline: date" }))`.

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | Every Nobel prize since 1901, on one time axis | — (the timeline is read) | `timeline.range()` → `null` (no window); `graph.counts()` names the whole graph |
| 2 | Brush 1900–1930: German universities lead | `timeline.brush([1900, 1930])` (the axis is the year as a number) | `timeline.range()` → `/^19(00\|01) – 19(29\|30)$/` (a harness drag lands on pixels, a hand's snaps to bars); `bar.chips()` holds the `date` clause |
| 3 | Play it forward — in the 1940s the prizes go west | `timeline.play()`; poll the window's start year to ≥ 1950; `timeline.pause()` | the start year is ≥ 1950 (a bar a tick, a tenth of a second each: where it stops varies) |
| 4 | 1990–2000: 66 of 89 affiliations are American | `bar.remove("date")` (a drag inside the paused window would move it), then `timeline.brush([1990, 2000])` | `timeline.range()` → `"1990 – 2000"` |
| 5 | One filter, every view | `discover.view("Dashboard")`; `discover.relation("LaureateAward", ["university → University", "addressCountry → Country"])` (the Dashboard opens on the first type) | `dashboard.tile("Count by Country.name")` top bar `USA`; `bar.chips()` still holds the `date` clause · **poster** |

**Numbers** (`nobel/data`, JSON)

```sql
create view aw as select * from read_json('awards.json');
create view af as select * from read_json('affiliations.json');
create view i  as select * from read_json('institutions.json');
create view x  as select aw.year::int y, i.country from af join aw on aw.id = af.award join i on i.id = af.institution;
```

| Figure | Value | Query |
| --- | --- | --- |
| Awards (laureate × prize) | 1,026, 1901–2025, to 1,018 laureates (990 people, 28 organisations) | `select count(*), count(distinct laureate), min(year), max(year) from aw` |
| Universities · countries | 379 · 86 | `count(*)` over institutions.json, countries.json |
| Affiliations | 847, on 758 awards | `select count(*), count(distinct award) from af` |
| 1901–1929 | 151 awards; 92 affiliations: Germany 28, UK 16, France 15, Sweden 6, USA 5 | `select country, count(*) from x where y < 1930 group by 1 order by 2 desc` |
| 1901–1938 | 132 affiliations, 112 in Europe (85 %); Germany 41, UK 23, France 17 | the same, `y <= 1938`, Europe as a country list |
| 1939–1945 | no prizes 1940–1942; USA 7, Germany 4, UK 3 | `select count(*) from aw where year between 1940 and 1942` → 0 |
| 1946–2025 | 697 affiliations, USA 425 (61 %), UK 74, Germany 41 | `select count(*), count(*) filter (where country='usa') from x where y >= 1946` |
| 1990–1999 | 104 awards; 78 affiliations, USA 58, Germany 5, France 4 | `… where y between 1990 and 1999` |
| 1900–1930, the take's window | Germany 29, UK 16, France 15, Netherlands 6 (by university the Sorbonne leads, 6) | `… where y between 1900 and 1930` (the window is inclusive) |
| 1990–2000, the take's window | 117 awards; 89 affiliations, USA 66, Germany 5, UK 4 | `… where y between 1990 and 2000` |
| US share by decade | 1900s 1/34 · 1920s 2/33 · 1930s 12/45 · 1940s 15/32 · 1950s 33/62 · 1990s 58/78 · 2000s 79/114 | `select y//10*10, count(*) filter (where country='usa'), count(*) from x group by 1` |

The crossover is in the 1940s (US 15 of 32), so the subtitle says *"in the 1940s"*; the US holds
≥ 50 % in every decade after it.

**Risks**

- The window is inclusive (`BETWEEN`): 1990–2000 holds 2000, hence *66 of 89*, not 1990–1999's 58 of 78.
- Playback is a clock: the subtitle leads it and the step ends on a state (the start past 1950), but
  the 1940s pass in about 0.3 s on camera.
- *"66 of 89 affiliations"* counts affiliation rows (an award with two universities counts twice);
  the dashboard relation's rows are the same rows.
- `Timeline: date` assumes the setting's value is the bare column name; if it is `LaureateAward.date`
  the title follows. The `TimelineHarness.with({ title: /^Timeline: / })` form avoids it.
- Nobel's PR #119 is another session's; this storyboard only reads it.

---

## The keasy page objects the demos need

Beyond the library harnesses (`GraphCanvasHarness`, `ChartHarness`, `TimelineHarness`,
`DashboardHarness`/`TileHarness`, `FilterBarHarness`, `AnswerHarness`, `DockHarness`), under
`e2e/support/app/`, each built from those harnesses and named after keasy's own parts. Today's
`demos/geo.ts` helpers fold into them.

| Page object | Methods | Replaces / why |
| --- | --- | --- |
| `DiscoverPage` (`support/app/discover.ts`) | `open(id, { view?, panel? })` (deep link, `discoverUrl`); `view("Graph" \| "Dashboard")` (the view switch through `DockHarness.with({ name: <its group name> })`); `relation(root, hops?)` (*Root type* select, *Hop* menu items `label → Type`); `widenDock(px)`; `onMap()` (the shared OpenFlights arrange); `figure(title)` (a figure tile's value); `counts()` (the footer's GraphCounts, in either view); `hoverChip(field)` | `openGraphView`, `onMap`, `widenDock`, the `dispatchEvent("click")` on *Dashboard*. The relation is not in the URL, so it is a call |
| `SettingsPanel` (`support/app/settings.ts`) | `placement("Map", { x, y })`; `marks("Legible")`; `edges("Hidden")`; `labels(n)`; `timeline(column)` | `placeOnMap`, `hideEdges`, `choose`; `timeline` is new (the *Timeline* select, `time-by`) |
| `GraphSearch` (`support/app/search.ts`) | `add(query): Promise<number>` — opens *Find anything in the graph*, types, presses *Add N to the subset*, returns N | demo 2's inline steps |
| `RulesPanel` (`support/app/rules.ts`) | `checked()` (the *Checked over …* line); `rule(name)` → `state()` (the badges), `show(message \| RegExp)` (presses *Show N*, waits for *Showing N*), `showAll("violations" \| "warnings")` (presses *Show all N …*, waits on `aria-pressed`; keasy#127), `conforms()` | keasy's panel is `Diagnostic`s, not the library's `Findings`, so `FindingsHarness` does not drive it |
| `AskPanel` (`support/app/ask.ts`) | `warmUp()`; `composer()` → `AnswerHarness.with({ name: "Ask about your data…" })` | `warmUp` in `snb-ask.demo.ts` |
| seeds / API (`support/seeds.ts`, `support/stack/api.ts`) | `saveRules(id, example)`; `saveDashboard(id, relationKey, spec)` | rules PUT exists inline in flights-rules; the dashboard PUT is new (demos 6, 7) |

The view switch and dock: `DockHarness` drives any single-select toggle group; it needs the view
switch's accessible group name (today the demos press `radio "Dashboard"` without one). If the
group is unnamed, naming it (*View*) is a one-line keasy change and the clean fix.

## The site changes (keasy.github.io)

`src/content/demos.ts`:

1. **Two new tabs**, after Assessment:
   ```ts
   { id: "cordis", label: "EU research funding",
     stat: "€62.5B of Horizon Europe, 145K participations — in your browser",
     steps: [ /* from cordis-funding-{light,dark}.chapters.json */ ], ...files("cordis") },
   { id: "nobel", label: "Nobel timeline",
     stat: "1,026 Nobel prizes since 1901 — play them forward in time",
     steps: [ /* from nobel-timeline-{light,dark}.chapters.json */ ], ...files("nobel") },
   ```
   and `public/videos/{cordis,nobel}/{light,dark}.mp4` + `poster-{light,dark}.webp`, made as the
   handoff note says (ffmpeg `-crf 22 -g 30 -keyint_min 30 -sc_threshold 0 -movflags +faststart`;
   posters via sharp, 1600 wide).
2. **Steps re-read for every tab** from the new chapters: Hidden patterns gains *Lasso the peninsula* and *Frame what
   you kept*; Crossfilter loses *One filter, every chart* and gains *Frame what the filters keep*; Ask
   gains *Filter: women only* and *Add it to the dashboard*; Assessment loses *Or only the ones that
   pass* and gains the warning and the frame.
3. Stat lines: the five existing ones stand. Assessment's *3,218 airports assessed* is right (3,218).
4. **Seven tabs** in the hero: check that the tab row wraps or scrolls at phone width (16 px gutter,
   no horizontal page scroll) — five fit today; seven with *EU research funding* may not.

## Anything in the data that contradicts a planned subtitle

- **Assessment, "show the violations (44)"** — settled by keasy#127 (*Show all 44 violations*);
  warnings are 245 as a severity, 218 as the high-altitude finding the take shows.
- **Assessment, "the Andes, Rockies, Ethiopia, Tibet"** — settled: *"The Rockies, the Andes, Iran,
  Ethiopia, Tibet"*.
- **Hidden patterns, framing Spain** — settled: the `PENINSULA` lasso (31, all Spanish) before the frame.
- **Nobel, "Europe → US after 1945"** — settled: *"in the 1940s"* (US 15 of 32); before 1939 Europe
  held 85 % (112 of 132), from 1946 the US 61 % (425 of 697).
- **CORDIS, by programme / over time** — not telling enough for a step (flat over 2022–2026), and
  the programme is two hops away.
