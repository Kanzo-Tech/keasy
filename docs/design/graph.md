# The graph keasy reads

Status: written against fossil's GraphAr writer (fossil `main`, PR #48) and kanzo-ui 0.47. The
versions are not released when this is written (see the pull request); the code states the versions
it will run on, and was run against local builds of them.

What a run writes is an Apache GraphAr graph, `fossil.graph.yml` and its Parquet chunks, and beside it
`mapping.ttl`, an RML-Core mapping that says what the tables mean as RDF. It replaces the `fossil/1`
corpus (`fossil.json` and a Parquet file per table) that keasy attached with `@fossil-lang/corpus`.
fossil's side of this is its [format](https://kanzo-tech.github.io/fossil-lang/docs/format) and
[design](https://kanzo-tech.github.io/fossil-lang/docs/design/graphar); this page is keasy's part:
what it composes, and what it does when a graph is not one.

## keasy composes; there is no reader package

fossil keeps no reader of its own. keasy does what the format page's recipe says, in two small
modules:

- **`lib/fossil/attach.ts`** — `mount` (`@fossil-lang/storage`) for the read credential of a job's
  prefix, then `attachGraph` (`@kanzo-tech/graphar-duckdb`) over the files that prefix holds, or over
  the buffers a run into memory answered (`attachFiles`, the assistant's preview). It answers the
  catalog name SQL uses (`"<name>"."<Type>"`, and the five `graphar_*` relations), and the text of
  `mapping.ttl`, read from where the graph is.
- **`lib/fossil/rudof.ts`** — rudof's module, loaded once and only when something reads RDF, and
  `Mapping.parse` over that text.

Everything that read `fossil_tables`, `fossil_columns` or `triples` now reads the join graph that
`@kanzo-tech/graph`'s `readJoinGraph` makes of the catalogue (`CorpusScope` holds it, cached under the
corpus), or the mapping.

*What would reverse it:* a second host of the same 80 lines — the graph viewer in another product —
then `mount` and `attachGraph` become one call in fossil or kanzo-ui, as `attach` was. Until there is
one, a call that has one caller is not a package.

## The mapping describes the graph after its first paint

GraphAr states a graph's tables and column types and has no word for a class, a predicate, a datatype
or a label. Those are in `mapping.ttl`. `CorpusScope` reads the graph's join graph (suspending, as
before), draws it, and **then** parses the mapping and gives the page `withMapping(graph,
mapping.model())`: the picker, Ask's chips (`typeWords`) and a column's label read the `rdfs:label`s
in the page's language, and a year declared `xsd:gYear` is a time. Until the mapping is read, and if
it cannot be, the page shows the names the tables have, and the failure is said once by the toast
path every failed read takes ("The graph's labels could not be read").

This is fossil's own rule for the graph page: nothing on it waits for RDF to be parsed before the
first paint, because the graph's tables never need it. rudof's module is the cost, and it is paid once
per tab, after the draw.

*What would reverse it:* a first paint people see change — the names replaced by labels a moment
later. Then `CorpusScope` suspends on the mapping as it does on the join graph, and the cost of
rudof's module moves before the draw.

**What the mapping does not yet reach.** fossil writes a relation, and a multi-valued or
language-tagged property, as a triples map over a SQL query (`rml:SQL2008Query`), not as a
`rml:parentTriplesMap`; `withMapping` describes the relations that name a parent and the columns of
a table-sourced triples map. So the labels of types and of single-valued columns arrive, and the
label of an edge or of a multi-valued property does not: they read as their names in words. Run against
fossil's `docs/programs/labels` with `withMapping` and `typeWords` on 2026-10-15: *Nobel laureate* and
*galardonado con el Nobel* for `Person`, *birth date* for `birthDate`, and `awarded` (no label) for
`Person_awarded_Prize`. This is kanzo-ui's to close, and the reason it is written here is that the
pull request that adds the mapping to the graph (kanzo-ui #224) was written against the other shape.

## The rules read the graph as triples, through the mapping

The rules page validates a SHACL document over `"<graph>".triples`, a seven-column view that used to
come with the corpus. It is now `Mapping.triples` over the graph's own tables, **made on each check**
(`create or replace`, a query and no data: nothing is materialised, DuckDB unfolds it when it is read),
by `useRules` before rudof validates. A graph with no mapping, or one that rudof refuses, is a
check that fails with rudof's own message; the graph page does not need it.

*What would reverse it:* a check slower than the same one over a stored table — measured on a graph of
the size of LDBC SNB — then the view becomes a table, made once per corpus and dropped with it.

## The overview asks no question of its own

The overview's vertex and edge tables are the join graph's types and edges (`rows`, `columns`), with
`vertices` — every type as one relation, the canvas's — left out, and the global id left out of a type's
columns: it is the graph's own arithmetic over GraphAr's per-type index, not a column the type has.

## A graph built before this is not read; build it again

**There is no compatibility.** `attachGraph` opens `fossil.graph.yml`. A graph that a `fossil/1`
writer wrote has `fossil.json` and `vertex/<Type>.parquet` and no `fossil.graph.yml`; attaching it
fails as `unreadable`, and keasy says so in its own words under the code `graph/unreadable`: *This
graph's files cannot be read. It was built before graphs were written as Apache GraphAr, or its files
are damaged. Build it again to open it.*

What keasy stores about a graph's output is two columns of `graphs`, `folder` (where the output lands
under the sink) and `report` (fossil's run report, `{ location, dropped }`, opaque), and neither is read
to open a corpus: the page mounts the job and reads `fossil.graph.yml` under it. So **nothing in the
database needs rewriting, and every completed graph needs to be run again**: *Run* on the graph writes
a GraphAr graph under the same folder. The files of the earlier format stay in the folder, unread (a
GraphAr graph is `vertex/<Type>/…` and `edge/…`, and the earlier one's `vertex/<Type>.parquet` is a
different path), and go with the folder.

*What would reverse it:* a deployment with graphs nobody can run again — the sources gone — and a
need to read what they hold. Then the reader of `fossil/1` is not restored in keasy: the graphs are
converted once, outside it, by running the old fossil and the new one over the same sources.

The dev examples (`infra/dev/examples`) are programs, not outputs, and are run as they were. The new
writer refuses what the old did not (a relative subject, a repeated subject, a parallel edge; fossil's
format page lists them as `write/*` codes), so a program that depended on that is refused at its run
and says why; the four dev programs were **not** run against it (their data is fetched by `make seed`).

## Ask's offers yield to the person's question

Ask proposes questions to start from (`askOffers`) when the conversation is empty. The local model
takes its calls in turn, so an offer being generated stands between the person and their own question.
They now yield: once a question is the person's — typed and sent, handed over by the assistant's link
(`?q=`), or an answer on its way — no offer starts, and one in flight is stopped (`hasAsked`,
`ask-handoff.ts`; `ask-panel.tsx` cancels the query's signal). The assistant's `requirements` chips are
not changed: `useTask` has no cancel, and they are asked once per accepted model, before a typed
question can exist.

*What would reverse it:* offers that are cheap enough not to be a wait — a model that answers in
less than the person takes to press Send. Then they run beside the question again.

## A cut-off answer is said as one

`@kanzo-tech/llm` 0.47 rejects a structured answer that the model's context cut off as `llm/truncated`
(`reason` `context`), where it used to be "No object generated: could not parse the response" or an
uncoded failure. keasy words it (`lib/errors.ts`): *The answer was cut off. The model ran out of room
before it finished answering, so nothing was kept. Ask about less at once, or clear the filters and
ask again.* — in Ask, where the chat draws the error it holds, and in the assistant, where a Task's
failure is drawn with its code. A generation the person stopped is an `AbortError`, which the AI SDK's chat takes
as a stop and not a failure; text cut off by the context is returned with the finish `length`, which no screen of
keasy shows yet (nothing here asks the model for free text).

*What would reverse it:* a cut-off answer that a retry with less would have fixed without the person
— then the Task retries with a smaller graph in its prompt, and this message is what is left when the
retry fails too.
