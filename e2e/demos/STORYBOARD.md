# The product demos — storyboard

The seven videos on keasy.github.io's hero, written as stories before they are written as code, so
that once `@kanzo-tech/testing` ships (kanzo-ui v0.35.0) each `*.demo.ts` is a transcription of its
table here. Review the stories first; the code follows them.

**The rules every demo keeps** (`demo-video-style`): subtitles only, no title cards; recorded at
native 1600×900; each step's subtitle **leads** it (the `chapter()` call comes before the action it
describes); short waits, and every wait is on a state (a harness method), never on a time; map demos
hide edges and labels and use legible marks; a demo starts from a configured state, set off camera in
`arrange`, unless the configuration is the point. Every demo ends on its result held still: after the last
step the subtitle goes and the page is held for `TAIL` (3 s, `record/pace.ts`) before the cut.

**How to read a step**

| Subtitle (≤ 60 chars) | Action | Check |
| --- | --- | --- |
| what `chapter()` shows, before the action | the exact harness / page-object call; brushes and lassos in data | what must be true after, asserted with `expect.poll` over a harness method |

`env` is `await playwright(page)`, made **before** the first `page.goto` (the hook registers charts
and canvases as they mount). `bar` is `await env.harness(FilterBarHarness)`. `discover`, `settings`,
`search`, `rules`, `ask` are the keasy page objects listed at the end
([Page objects](#the-keasy-page-objects-the-demos-need)). What the filters keep is the page's one
count, the filter bar's readout, read in full by `discover.kept()`: `"778"` of the Dashboard view's
relation, `"132"` of the Graph view's nodes.

Every number below was computed from the example's CSV/JSON with DuckDB; the query is under each
demo's **Numbers**. The OpenFlights and SNB queries run in `infra/dev/examples/<name>/data` after
`sh infra/dev/seed.sh`; Nobel's in PR #119's `infra/dev/examples/nobel/data`.

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
3. `graph.pause()` — the layout is not waited on: spread, the cloud looked as it did before, so the
   wait was a stretch of take where nothing changed.
4. `settings.marks("Legible"); settings.edges("Hidden"); settings.labels(0)` — the 36,906 routes are fog.
5. Dock back to Info (`dock.open("Info")`).

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | A graph of airports and their routes | `graph.run()` (woken, so the cloud moves on camera) | the transport reads *Pause the layout*; `graph.counts()` → `/3,218 nodes/` (or `3.2K`) |
| 2 | Put it on a map: longitude across, latitude up | `settings.placement("Map", { x: "lon", y: "lat" })` then `graph.pause()` | `graph.counts()` → `/3,218 of 3,218 placed/` (or `3.2K`); the placement radio *Map* is checked · **poster** |
| 3 | Find anything — here, every airport in Spain | `search.add("country:Spain")` (Info → *Find anything in the graph* → type → *Add 40 to the subset*) | the add button read `Add 40 to the subset`; `discover.kept()` → `"40"` |
| 4 | Frame Spain | `graph.frame()` — the toolbar's one Frame (kanzo-ui #179), on what the search kept | `discover.kept()` still `"40"` |
| 5 | Lasso the peninsula — the Canaries stay out | `graph.lasso(PENINSULA, { in: "data" })` (the polygon below, in lon/lat) | `discover.kept()` → `"31"` |
| 6 | Frame what you kept | `graph.frame()` | `graph.frame()` resolved (a frame drawn after the press); `discover.kept()` still `"31"` |

Step 4 frames the 40 as the search kept them: the camera takes in the Canaries and the Atlantic
down to their latitude (27.8° N), and Melilla across the strait — which is what makes step 5's
lasso worth doing. The last frame is the peninsula and the Balearics alone. `frame()` frames what is
in full colour since kanzo-ui #112.

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
| 3 | Switch to the graph — the same filter, framed on the map | `discover.view("Graph")`; `graph.ready()`; `graph.frame()` — one step | `discover.kept()` → `"135"`; `bar.chips()` has the country and the lon clauses |

The take brushes `[-128, -98.98]`, whose edges both sit in gaps of the data, so it reads **135** (US
airports west of 98.98° W) whatever a pixel does; the `[-125, -100]` figures below are the first
plan's. The switch and the frame are one step: a view that appears and is framed at once, under one
subtitle, rather than a subtitle for each half. The old opening chapter *"One filter, every chart"*
(a subtitle with no action under it) went: the first subtitle leads the first click. *"Every filter
lands in the bar"* is the check of the last step rather than a step of its own.

**Numbers**

| Figure | Value | Query |
| --- | --- | --- |
| Top country by airports | United States, 551 (then Canada 206, China 173) | `select country, count(*) from a group by 1 order by 2 desc limit 5` |
| US airports at lon −125 … −100 | 132 | `select count(*) from a where country='United States' and lon between -125 and -100` |
| Every airport at lon −125 … −100 | 213 | `select count(*) from a where lon between -125 and -100` |

**Risks**

- Whether the lon brush filters by its extent or by the bins it covers: by extent it is 132; read the
  figure on the first run and pin it.
- `discover.kept()` reads the readout's leading figure, in full.

---

## 4. Ask — `snb-ask`

- **Hero tab:** `ask` · label **Ask**
- **Stat line:** *Every answer is a query over what's in view — with its chart* (unchanged)
- **Example / seed:** `snb`, same graph as demo 1
- **Depends on:** kanzo-ui 0.40's `AnswerCard` (#179): its verbs are icons on the tile — *Filter the
  page to these rows*, disabled when the answer keeps everything in view, and *Add to the dashboard*,
  which becomes *Open on the dashboard* given the host's `onOpen`.

**Arrange (off camera)**

1. `env`; seed; `page.goto(discoverUrl(id, { view: "dashboard", panel: "ask" }))`.
2. `discover.relation("Person")`; `dashboard.settled()`.
3. `ask.warmUp()` on `LIVE=1` only — both model aliases loaded.
4. `answers = await ask.composer()` (`AnswerHarness.with({ name: "Ask about your data…" })`).

**Steps** — both verbs: an answer that keeps everything in view goes to the dashboard; one with a
where filters the page.

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | Filter the page: women only | `(await (await dashboard.tile("Count by Person.gender")).chart()).pick({ y: "female" })` | `discover.figure("Rows")` → `"778"` |
| 2 | Ask about what's in view, in plain words | `answers.ask("Which browsers do they use most?")` | a new answer card began; `replay.unrecorded` is empty |
| 3 | The answer is a chart, over the women in view | `answers.answer()` | the tile reads `Firefox`; `answers.rows()` holds Firefox 324 and not 628; `answers.filterTo()` rejects — *Filter the page to these rows* is disabled: no where, every browser · **poster** |
| 4 | Add it to the dashboard | `answers.addToDashboard()` (only writes: the reader stays in Ask) | `dashboard.tile(/browserUsed/)` resolves |
| 5 | Open it on the dashboard | `answers.openOnDashboard()` — keasy's `onOpen`: the Dashboard view on the answer's relation, the tile scrolled into view and ringed | the tile's middle is inside the 900 px viewport |
| 6 | Ask again: where do the ones on Opera live? | `answers.ask("Where do the ones on Opera live?")`; `answers.answer()` — Ask stayed docked, the conversation goes on | `replay.unrecorded` is empty |
| 7 | This one filters: keep the women it drew | `answers.filterTo()` (its where: `Person.browserUsed` Opera, and the countries its bars show) | `discover.figure("Rows")` → `"19"` |
| 8 | The same 22 in the graph, framed | `discover.view("Graph")`; `graph.ready()`; `graph.frame()` | `discover.counts()` → `/^22 of /` |

Step 8 lays out SNB's 327K nodes in the Graph view, on camera: the step waits on `graph.ready()`
within the two minutes every state gets. If that is too long for a take, the frame is the step to
reconsider, not the wait.

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
still DuckDB's — read from the card's own data table, `AnswerHarness.rows()` — and the check still
fails if the recorded tool call drops the filter. Re-capture when the prompt, the tool's schema, a
question or the SNB example change. **The recording in the repository predates this cut**: it holds
neither the second question nor the suggestions' prompt kanzo-ui 0.40 words for a page filtered
through a dashboard (`ask-reads-bridged-parts`), so a replay fails at step 2 until it is captured
again with `LIVE=1 RECORD=1`.

**Numbers** (`data/dynamic/person_0_0.csv`, `delim='|'`; places `data/static/place_0_0.csv`)

| Figure | Value | Query |
| --- | --- | --- |
| Women | 778 of 1,528 | `select gender, count(*) from p group by 1` |
| Women's browsers | Firefox 324 · Chrome 224 · Internet Explorer 182 · Safari 26 · Opera 22 | `select browserUsed, count(*) from p where gender='female' group by 1 order by 2 desc` |
| Everyone's browsers | Firefox 628 · Chrome 438 · IE 364 · Safari 54 · Opera 44 | the same, without the `where` |
| Women on Opera | 22, in 22 different cities of 16 countries (Belgium, Nepal and the Philippines 3 each) | `select count(*), count(distinct place) from p where gender='female' and browserUsed='Opera'`; the countries: `… join pl on pl.id = p.place join pl co on co.id = pl.isPartOf group by co.name` |

**Risks**

- **The model — decided: the site take replays a recorded answer; the live model stays covered by
  the e2e tests** (`e2e/tests/ai.spec.ts` and the smoke runs).
- The check that the answer counts **women** (324, not 628) is what proves "over what's in view";
  a model that drops the filter fails it.
- Step 6 needs an answer **with a where** (`Person.browserUsed` Opera): a model that answers over
  every browser leaves *Filter the page to these rows* disabled, and step 7 fails. Capture again.
- *Filter the page to these rows* keeps what the answer draws: the women in the categories its bars
  show. The recorded answer draws the top 13 of the 16 countries, so step 7 keeps 19 of the 22; an
  answer drawn by city, or with every country, keeps another figure. Capturing again means reading it
  off the answer's bars and setting step 7 and 8 to it.

---

## 5. Assessment — `flights-rules`

- **Hero tab:** `rules` · label **Assessment**
- **Stat line:** *3,218 airports assessed against your rules — in your browser* (unchanged)
- **Example / seed:** `openflights`, same graph; rules from `infra/dev/examples/openflights/rules.ttl`
- **Depends on:** kanzo-ui 0.40's Findings (#179) — a rule's one *Show N* at the end of its
  heading, each finding's *Show N* a toggle — and keasy's popover on it: the scope line
  *All 3,218 nodes checked · 2,930 conform* with one toggle beside it, **Keep what conforms**.

**Arrange (off camera)**

1. `env`; seed; `saveRules(page, id, "openflights")` (the rules PUT).
2. `discover.open(id, { panel: "none" })`; `discover.onMap()` (Map, lon/lat, Legible, Hidden edges, no labels); then the dock is closed: the rules are the filter bar's badge.
3. `rules.check()` (presses *Check*: the rules validate only when asked) → `"All 3,218 nodes checked · 2,930 conform"`.

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | Every airport, checked against your rules | — (the popover is read) | `rules.rule("Airport").state()` → *44 violations · 247 warnings* (the tally counts results) |
| 2 | 288 airports break the rule — show them all | `rules.rule("Airport").showAll()` (presses the rule's *Show 288*) | `discover.kept()` → `"288"` |
| 3 | Frame them | `graph.frame()` | still `"288"` |
| 4 | Amber warns: 218 airports above 4,000 ft | `rules.rule("Airport").show(/high-altitude airport/)` (the finding's *Show 218*, which replaces the rule's: the rules are one clause) | `discover.kept()` → `"218"` · **poster** |
| 5 | Frame them: the Rockies, the Andes, Tibet | `graph.frame()` | still `"218"` |
| 6 | Keep what conforms: 2,930 airports pass every rule | `rules.conforms()` (presses *Keep what conforms*; the popover closes) | `discover.kept()` → `"2,930"` — the clean set is the page, and every view counts it |

The take ends on the clean set: what conforms, kept, is the page. Step 4 is the high-altitude finding
(218), not the rule's 288: the subtitle and the frame are about altitude.

**Numbers** (`data/airports.csv`; the rules are `rules.ttl`)

| Figure | Value | Query |
| --- | --- | --- |
| No IATA code (violation) | 20 | `select count(*) from a where iata is null` (none present-but-malformed: 0) |
| ICAO not four letters (violation) | 24 | `select count(*) from a where icao is not null and not regexp_full_match(icao,'[A-Z]{4}')` |
| Airports with a violation | 44 (the two sets are disjoint) | `… where iata is null or (icao is not null and not regexp_full_match(icao,'[A-Z]{4}'))` |
| No time zone (warning) | 29 | `select count(*) from a where timezone is null` |
| Above 4,000 ft (warning) | 218 | `select count(*) from a where altitude > 4000` |
| Airports with a warning | 245 (29 + 218, two airports in both) | `… where timezone is null or altitude > 4000` |
| **Airports the rule flags** — *Show 288* | **288** (44 + 245, one airport in both) | `select count(*) from a where iata is null or (icao is not null and not regexp_full_match(icao,'[A-Z]{4}')) or timezone is null or altitude > 4000` |
| **Airports that conform** — *2,930 conform* | **2,930** (3,218 − 288) | `select count(*) from a where not (iata is null or (icao is not null and not regexp_full_match(icao,'[A-Z]{4}')) or timezone is null or altitude > 4000)` |
| …where the 218 are | US 46 · China 29 · Mexico 15 · Iran 14 · Ethiopia 9 · Peru 8 · Colombia 8 · Mongolia 7 · Bolivia 6 · Turkey 6 | `select country, count(*) from a where altitude>4000 group by 1 order by 2 desc limit 10` |
| …by region (boxes) | Rockies/US–Mexico west 48 · Andes 30 · Tibet/Qinghai 17 · Iran 14 · Mexican plateau 13 · Ethiopian highlands 9 · elsewhere 87 | `case when lon between -125 and -100 and lat>25 … end` over the same 218 |
| Highest | Daocheng Yading 14,472 ft (China); El Alto, La Paz 13,355 ft | `select name, country, altitude from a order by altitude desc limit 5` |

The popover's *N conform* is what was checked less what any rule flags, at either severity — a
warning is a result, and a node with one does not conform in SHACL. *Keep what conforms* keeps the
subjects of rudof's Shape Fragment instead, so step 6's check is what proves the two agree here.

**Risks**

- Rules validate in the browser (rudof); arrange waits on *All 3,218 nodes checked*, within two minutes.
- If the Shape Fragment's subjects ever include a neighbour that does not conform (an airport reached
  by `of:routeTo`), step 6 reads more than 2.9K and the take fails rather than records it; the
  subtitle's 2,930 is then the scope line's figure, and the step is re-read.

---

## 6. Nobel timeline — `nobel-timeline`

- **Hero tab:** `nobel` · label **Nobel timeline**
- **Stat line:** *1,026 Nobel prizes since 1901 — play them forward in time*
- **Example / seed:** `nobel` · `seedGraph(page, "nobel", { name: "Demo · Nobel laureates", reuse: true })`
- **The story:** a century of science moving west — every prize at the city it was won in, the
  century played, Europe's early decades against the US's 1990s, then only the women.
- **Depends on:** `GraphTimeline` (its brush snapped to five-year bars; Play inside the brushed
  range, accumulating, stopping at its end), under the graph only; the setting `time-by`, labelled
  **Timeline**. To be replaced by `ChartTimeline` in a later kanzo-ui change: the steps stay.

**Arrange (off camera)**

1. `env`; seed; `saveDashboard(id, "LaureateAward>laureate>Laureate>birthPlace>Country", …)` — two
   bar tiles, *Count by Laureate.gender* and *Count by Country.name*: each award with its laureate
   and the country the laureate was born in, rooted at the award so a pick keeps awards, the dots on
   the map. (A dashboard's pick is withdrawn when its relation changes, so the gender and the
   country the story ends on are one relation.)
2. `discover.open(id)`; `discover.onMap()` (each award at its first affiliation's city, edges hidden);
   `settings.timeline("date")`.
3. `discover.view("Dashboard")`; `discover.relation("LaureateAward", [">laureate>Laureate", ">birthPlace>Country"])`; back to Graph; `panel("Info")`.
4. `timeline = env.harness(TimelineHarness.with({ title: /^Timeline: / }))`.

**Steps**

| # | Subtitle | Action | Check |
| --- | --- | --- | --- |
| 1 | 749 Nobel prizes since 1901, each where it was won | — (the map is read: the first frame is the world, the Atlantic in the middle) | `timeline.range()` → `null`; `graph.counts()` → `/^1\.1K of 2\.5K nodes placed/` (749 awards + 370 universities) |
| 2 | Play the whole century | `timeline.brush([1900, 2029])`; `timeline.play()`; poll the window's end to ≥ 2025 | the end year ≥ 2025 |
| 3 | 1900–1930: 9 in 10 mapped prizes were won in Europe | `bar.remove("date")`; `timeline.brush([1900, 1930])`; `graph.frame()` | `timeline.range()` → `/^19(00\|01) – 19(29\|30)$/`; `discover.kept()` → `/^(156\|151)$/` (every prize in the window; 93 or 90 of them mapped) |
| 4 | 1990–2000: 65 of 86 mapped prizes were won in the US | `bar.remove("date")`; `timeline.brush([1990, 2000])`; `graph.frame()` | `timeline.range()` → `"1990 – 2000"`; `discover.kept()` → `"117"` (86 mapped) · **poster** |
| 5 | Only the women — play the century again | `discover.view("Dashboard")`; *Count by Laureate.gender* `pick({ y: "female" })`; `discover.view("Graph")`; `bar.remove("date")`; brush 1900–2029 and play to the end | `discover.kept()` → `"68"` (29 mapped); `bar.chips()` holds `Laureate.gender` |
| 6 | One filter, every view | `discover.view("Dashboard")` | *Count by Country.name*'s top bar is `USA`; `bar.chips()` holds `date` and `Laureate.gender` |

*Mapped* is said because the map places 749 of the 1,026 awards — those whose first affiliation has
a city on record — and the readout counts every prize the window keeps, mapped or not (`select
count(*) from awards where year::int between 1900 and 1930` → 156; 1990–2000 → 117; to women → 68). The 9 in 10 holds whichever year the drag's
right edge reads: 83 of 93 through 1930, 82 of 90 through 1929.

**The frames do not zoom into a continent.** Steps 3 and 4 frame what the window keeps, and both
windows keep prizes on either side of the Atlantic and beyond: 1900–1930 runs from Pasadena
(−118°) to Calcutta (88°, 1930), 1990–2000 from Vancouver (−123°) to Tsukuba (140°). Each
frame is close to the world view; the subtitles say where the prizes were won, not where the camera
goes. A take that wants the camera on Europe needs a lasso or a narrower window, not a frame.

**Numbers** (`nobel/data`, JSON; `make seed` or `sh infra/dev/examples/nobel/fetch.sh`)

```sql
create view awards as select * from read_json('awards.json');  -- and affiliations, institutions, laureates, countries
-- An award is placed at its first affiliation's city (fetch.sh). affiliations.json is sorted, so the
-- first is found again as the affiliation whose institution sits at the award's own position; no
-- award has two such institutions in different countries (checked: 0).
create view placed as
select aw.id, aw.year::int y, aw.lat, aw.lon, aw.laureate,
  (select any_value(i.country) from affiliations af join institutions i on i.id = af.institution
    where af.award = aw.id and i.lat = aw.lat and i.lon = aw.lon) country
from awards aw where aw.lat is not null;
-- Europe: austria, belgium, czech-republic, denmark, finland, france, germany, hungary, ireland,
-- italy, norway, portugal, russia, spain, sweden, switzerland, the-netherlands, united-kingdom
```

| Figure | Value | Query |
| --- | --- | --- |
| Awards (laureate × prize) | 1,026, 1901–2025 | `select count(*), min(year), max(year) from awards` |
| Placed on the map | 749 awards (each with a country: 749) and 370 universities — 1,119, "1.1K" | `select count(*), count(country) from placed`; `select count(*) from institutions where lat is not null` |
| 1901–1930, the take's window | 93 placed; 83 in Europe (89 %), 6 in the US | `select count(*), count(*) filter (where country in (<Europe>)), count(*) filter (where country = 'usa') from placed where y between 1901 and 1930` |
| 1901–1929, a pixel short | 90 placed; 82 in Europe (91 %), 5 in the US | the same, `between 1901 and 1929` |
| 1990–2000, the take's window | 86 placed; 65 in the US, 18 in Europe | the same, `between 1990 and 2000` (the window is inclusive) |
| By decade, placed · US · Europe | 1900s 33·1·32 · 1910s 24·2·22 · 1920s 33·2·28 · 1930s 39·11·27 · 1940s 30·15·14 · 1950s 54·31·23 · 1960s 60·29·28 · 1970s 77·44·31 · 1980s 76·46·28 · 1990s 75·57·16 · 2000s 96·66·19 · 2010s 91·53·24 · 2020s 61·40·16 | `select y // 10 * 10, count(*), count(*) filter (where country = 'usa'), count(*) filter (where country in (<Europe>)) from placed group by 1 order by 1` |
| Prizes to women | 68, 29 of them placed | `select count(*), count(aw.lat) from awards aw join laureates l on l.id = aw.laureate where l.gender = 'female'` |
| …by decade | 1900s 3 · 1910s 1 · 1920s 2 · 1930s 3 · 1940s 3 · 1960s 3 · 1970s 4 · 1980s 4 · 1990s 7 · 2000s 11 · 2010s 13 · 2020s 14 | `… group by aw.year::int // 10 * 10` |
| …by the laureate's birth country (step 6's tile) | USA 18 · France 6 · Poland 5 · Iran 3 · Canada 2 · Czech Republic 2 | `select co.name, count(*) from awards aw join laureates l on l.id = aw.laureate join countries co on co.id = l.country where l.gender = 'female' group by 1 order by 2 desc` |
| The gender tile, everyone | male 924 · female 68 (an organisation has no gender, nor a birth country) | `select l.gender, count(*) from awards aw join laureates l on l.id = aw.laureate join countries co on co.id = l.country group by 1` |

**Risks**

- Playback is a clock: each step waits on a state (the window's end past 2025), and the century plays
  a five-year bar per tick, each paced by the page's answer.
- A harness drag lands on pixels, not on the bars a hand snaps to: step 3's edge may read 1929; its
  subtitle holds either way. Step 4 asserts `"1990 – 2000"` exactly, as the last take read it.
- Brushing to 2029 assumes the axis runs to the last bar's edge (2030); if the drag lands off the
  plot, brush to 2025.

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
| `RulesBadge` (`support/app/rules.ts`, on `FindingsBadgeHarness`) | `check()` / `checked()` (the scope line, *All 3,218 nodes checked · 2,930 conform*); `stale()` (the reason the scope line gives once it is out of date); `rule(name)` → `state()` (the tally badges), `showAll()` / `hideAll()` / `offersShowAll()` (the rule's own *Show N* at the end of its heading), `show(message \| RegExp)` (a finding's *Show N* toggle, through `FindingsItemHarness.act`); `conforms(on?)` (*Keep what conforms*; resolves once the popover has closed) | the library's `FindingsItemHarness` reads each finding |
| `AskPanel` (`support/app/ask.ts`) | `warmUp()`; `composer()` → `AnswerHarness.with({ name: "Ask about your data…" })` | `warmUp` in `snb-ask.demo.ts` |
| seeds / API (`support/seeds.ts`, `support/stack/api.ts`) | `saveRules(id, example)`; `saveDashboard(id, relationKey, spec)` | rules PUT exists inline in flights-rules; the dashboard PUT is new (demo 6) |

The view switch and dock: `DockHarness` drives any single-select toggle group; it needs the view
switch's accessible group name (today the demos press `radio "Dashboard"` without one). If the
group is unnamed, naming it (*View*) is a one-line keasy change and the clean fix.

## The site changes (keasy.github.io)

`src/content/demos.ts`:

1. **One new tab**, first:
   ```ts
   { id: "nobel", label: "Nobel timeline",
     stat: "1,026 Nobel prizes since 1901 — play them forward in time",
     steps: [ /* from nobel-timeline-{light,dark}.chapters.json */ ], ...files("nobel") },
   ```
   and `public/videos/nobel/{light,dark}.mp4` + `poster-{light,dark}.webp`, made as the
   handoff note says (ffmpeg `-crf 22 -g 30 -keyint_min 30 -sc_threshold 0 -movflags +faststart`;
   posters via sharp, 1600 wide).
2. **Steps re-read for every tab** from the new chapters (the 0.40 re-cut): Hidden patterns gains
   *Frame Spain* before the lasso; Crossfilter's switch to the graph and its frame are one step;
   Ask gains *Open it on the dashboard*, the Opera question, *keep the 22* and the frame;
   Assessment shows the rule's 288, frames twice and ends on *Keep what conforms*; Nobel is
   re-cut as a century moving west, then the women.
3. Stat lines: the five existing ones stand. Assessment's *3,218 airports assessed* is right (3,218).
4. **Six tabs** in the hero: check that the tab row wraps or scrolls at phone width (16 px gutter,
   no horizontal page scroll) — five fit today.

## Anything in the data that contradicts a planned subtitle

- **Assessment, "show the violations (44)"** — superseded by the rule's one *Show N* (kanzo-ui
  0.40): 288 airports, of either severity; 218 is the high-altitude finding the take shows.
- **Assessment, "the Andes, Rockies, Ethiopia, Tibet"** — settled: *"The Rockies, the Andes, Iran,
  Ethiopia, Tibet"*.
- **Hidden patterns, framing Spain** — settled: the `PENINSULA` lasso (31, all Spanish) before the frame.
- **Nobel, "the camera into Europe" / "across the Atlantic"** — the frames cannot say it: both
  windows keep prizes from California to India or Japan, so each frame is near the world view. The
  subtitles name where the prizes were won (9 in 10 in Europe; 65 of 86 in the US), and the frame
  stays as the gesture.
