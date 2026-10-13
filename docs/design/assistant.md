# The assistant, and time to smile

Status: a direction. Built: the model in the page, in place of the gateway, served from keasy's own
origin and preloaded with intent (2026-10-13); the guided chat (2026-10-13); and its three Tasks,
`model`, `mapping` and `requirements`, over fossil's profile (2026-10-13, below); the conversation
kept, and the preview run in memory and shown in the chat, the chat wired to both and to the build
(2026-10-13). The pattern this rests on — a *Task*: a small model in the browser
fills a small artefact under a JSON Schema, a deterministic oracle checks it, a bounded loop repairs
it or asks the person — and its API, its model and its decisions are kanzo-ui's, on
[Tasks](https://kanzo-tech.github.io/ui/docs/design/tasks). fossil's half — `fossil-profile` in place
of introspect, and a mapping spec from which Fossil is emitted — is on
[Profile, and the mapping a model proposes](https://kanzo-tech.github.io/fossil-lang/docs/design/profile).
This page is keasy's part: the assistant's conversation, the metric they are built for, and what changes
in keasy's own configuration and runtime.

## The problem

One call writing a whole program from a prose description of Fossil does not work with a small
model: it does not see the shapes, it guesses keys and edges, the studio's checker reports after the
fact, and nothing repairs. "Done"
means "it compiles". And every call went through the BFF's `/api/ai` forward to the gateway, so the
question left the browser and the AI was down whenever the gateway was — until 2026-10-13, when the
model moved into the page (below).

## Time to smile

**The metric is the time from the first file connected to the first answer of Ask in Discover.** The
smile is on the first answer about one's own data, not on "graph created". Design targets, not
measurements: the profile in about 5 s, *what is in your data* in about 20 s, the first answer under
60 s; the full graph builds in the background, and the model download is preloaded when the
assistant opens.

It is measured in three places, and nothing leaves the browser for any of them: in CI, where
Playwright times the whole path over the four examples (median and p90 per version); in user tests,
where the tester exports their local journal by hand; and in the app, which can show it to whoever
uses it.

## A guided chat, not a wizard

The person using the assistant knows their data, not RDF or ShEx. ShEx is still how the ontology is
made operational, but it sits underneath, as SQL sits under a tile.

The assistant is **a conversation built of talk, questions and decisions**, in one centred column, drawn
with kanzo-ui's chat parts (`Conversation`, `Message`) as Ask's panel is. It speaks in turns, each
carrying what it is about:

1. *Which data do you want to explore?* — the connections' files as a tree in the turn; the reply is the
   files picked.
2. *Reading your files… 4 of 6*, live, and meanwhile *what is it about?* — optional, answered or
   skipped in the composer.
3. *Here's what's in your data* — the things with real counts and what each holds, and how they hang
   together as sentences with one real row: *each award has a laureate, a category and a year; e.g.
   Marie Curie · Physics · 1903*. Never shape, IRI, predicate or cardinality.
4. Each decision with no safe default, as a turn of its own: the question and its options. Each one that
   had a safe default is said, *I assumed …*, with its options under it, the one taken selected, and
   blocks nothing.
5. *What would you like to know?* — questions already answerable from these files as chips, and the
   composer for one's own; each question kept says whether these files can answer it. *That's all,
   show me a preview* ends it.
6. *Here is your data over 200 rows* — the preview, in the chat: each question kept is answered there
   over it with Ask's cards, and a decision changed runs it again. Then **Build the whole graph**, and
   *your graph is building*, with **Ask your data** and the person's questions as prompts to take to
   Discover.

**The person's replies are choices, chips or questions — never free-form instructions.** What they send
or write is drawn as their message (*These 6 files*, a question); a choice made on a turn's options is
not said again as a reply — it stays selected in its turn, which is where it is changed, by picking
another. A thing said twice reads as two things, and a way to change it under the reply (a *Change*
link) was a second door to the same options that nobody read as one. Free text goes in only where it
is a question, or the optional *what is it about?*; the composer is off otherwise, and says what the
turn above it is waiting for — and a turn says how to answer it only while it can be answered.
*What would reverse it:* a transcript read away from its options — exported, or shown where they
cannot be drawn — where the choice has to be said in words; then a decision answered is a reply again.

Why a conversation rather than screens: it is **one presentation with Ask**, which is where the person
goes next, so the hand-off is the same surface continuing; **the transcript keeps what was decided**,
in order, where a wizard's earlier screens are out of sight once passed; and it is still **bounded by
the Tasks** — the small model fills `requirements`, `model` and `mapping` under their schemas and the
oracles check them, and each turn is a Task's output or the person's pick from it. Nothing the person
types is an instruction to the model.

Shapes, mapping and program are generated and verified in the background (`requirements`, `model`,
`mapping`, then `emit`, as one `defineFlow`). **Advanced**, in the header, keeps ShEx and the Fossil
editor under the same checks.

**Competency questions are Ask's questions.** "Done" is each selected question answered by Ask over
the sample graph, seen in Discover, not a technical checklist. Their queries are generated against
the shapes, not the mapping, and the person confirms them before they are frozen as tests, so the
test and the code do not come from the same source.

**Assumptions instead of blocks.** A decision with a safe default — *is "share" a fraction of the
prize or an amount?* — is taken, said as an assumption, and changed later. Only what has no safe
answer — *when two people share a Nobel, is it one award or two?* — waits for the person.

**What would reverse it:** an evaluation where people finish faster, or with fewer corrections after
the fact, in a wizard than in the guided chat — then the turns become screens again, over the same
Tasks. And people changing most assumptions after the fact puts those decisions back in front of the
preview.

## The three Tasks

What the chat shows is computed where it is a fact, and asked of the model only where it is an
interpretation. Every Task is pure — no React, no engine of its own — and lives under
`graphs/new/_parts/assistant/tasks/`, each tested with a scripted model over a small Nobel profile;
`use-assistant.ts` is the one place that runs them, with `runTask`, `propose` and `useTask` from
`@kanzo-tech/ai/task` and the page's model (`useModel`, `lib/ai.ts`).

**The profile is the context, and it is a `compute`.** The picked files are read once with
`profile()` from `@fossil-lang/wasm` — columns and types, counts, candidate keys, inclusions and a
few sample rows — in place of introspect's `DESCRIBE`. *Here's what's in your data* is drawn from
it before any model is asked: one thing per file, its count when the profile read every row
(`sampled` false; a sampled count is not said), and what it holds. *What would reverse it:* a file
whose profile takes too long for the reading turn; then the turn reads `depth: "types"` first and
the rest in the background, the way fossil's profile already splits.

### `model` — propose, then decide

- **Context**: the profile, as closed lists — the sources by their binding, each one's columns, its
  candidate keys, and every inclusion by an id (`awards.laureate_id → laureates.id`) — and the
  person's *what is it about?* sentence.
- **Contract**: `{ types: [{ name, source, key, fields: [{ name, column }] }], edges: [{ name, from,
  to, via }] }`, whose `source`, `key`, `column` and `via` are enums of the profile's names. Names are
  the model's, in the person's words, held to an identifier's pattern; nothing else is.
- **Oracles**: every field's column is a column of its type's source (`model/foreign-column`); a
  type's key is a candidate key of its source (`model/not-a-key`); every edge is backed by an
  inclusion — its `via` lands on the `to` type's source at its key, and leaves from the `from`
  type's source or from a source no type stands on whose other inclusion lands on the `from` type
  (`model/unbacked-edge`); an edge names types the artefact has (`model/unknown-type`); no two types
  share a name, nor two fields of one type, and none is a word of Fossil's (`model/duplicate-name`). Each is fixable: sent back at its JSON Pointer.
- **Decisions**, raised from the profile and the accepted artefact, never by the model: a type
  whose file has more than one candidate key, and that no edge lands on (an edge fixes the key it
  lands on), asks which identifies the thing, and assumes the profile's first (`key/<source>`, a safe
  default: any candidate identifies); an edge through a source no type stands on — a
  many-to-many inclusion pair, *affiliations* between laureates and institutions — asks whether each
  row is a link, or a thing counted on its own (`count/<edge>`: *when two laureates share an
  institution, one or two?*), and blocks, because each answer counts differently and neither is
  safe.
- **What it fills**: `understanding.relations` — one sentence per type, *each award has a laureate,
  a category and a year*, with a real example from the sample rows, the edge's end looked up across
  sources through its inclusion — and `decisions`. IRIs are keasy's: a type is
  `<origin>/vocab/<Type>`, a field `<origin>/vocab/<field>`, a subject
  `<origin>/id/<type>/{<source>.<key>}`, computed from the workspace's origin and the names, never
  written by the model.
- *What would reverse it:* a small model that names and links types worse with the profile's
  closed lists than a person does by hand, over the examples — then the types are drawn from the
  sources one to one, and only the names are asked.

### `mapping` — Fossil under a grammar, checked by fossil

- **Context**: a fossil `Vocabulary` — the accepted types as `declared` types, each with its IRIs and
  its fields' types from the profile's primitives (`Option<…>` where the column has nulls; an edge a
  `Ref<…>`, a `Seq<Ref<…>>` through a link source), and the sources with their columns — and
  `grammarFor`'s answer: the prelude and the EBNF of what follows it.
- **Contract**: the grammar, through `providerOptions.kanzo.grammar` (`localModel` holds every token
  to it). The prompt names each mapping's `@subject` and columns, so the model writes what is left.
- **Oracles**: fossil itself — the prelude and the mappings opened with `openProgram`, the sources
  typed with `describe` at `depth: "types"`, and every error of `diagnostics()` sent back with its
  line (`mapping/<fossil code>`); every accepted type has a mapping (`mapping/unmapped`); each
  mapping's `@subject` is the one keasy computed (`mapping/subject`). Three attempts, then the
  diagnostics are the answer.
- **What it fills**: the program — prelude and mappings — which **Advanced** opens. The chat never
  shows Fossil. It runs once the person has asked all they wanted: the page has one model, and the
  question chips are what the person is waiting on until then. *What would reverse it:* a preview
  that must start sooner for the first answer to land under a minute — then it runs as soon as the
  decisions are taken, behind the chips.
- *What would reverse it:* fossil's own: a small model under the grammar failing the competency
  questions where an emitter from the accepted `model` passes them — then the mapping is emitted.

### `requirements` — questions the data can answer

- **Context**: the accepted model's types, fields and edges, as `Type.field` names.
- **Contract**: `{ text, of, fields }`, `of` a type and `fields` a list of `Type.field`, both enums.
- **Oracle**: Ask's resolver — `resolveRelation` from `@kanzo-tech/mosaic` over the join graph the
  accepted model will be — reaches every field's type from `of` (`requirements/unreachable`); a tie
  is answerable, because Ask asks it back.
- **Offered** with `propose` through `useTask`, five at a time, as chips; a chip is answerable by
  construction. **A question the person types** is marked by Ask's own Task, `ask` from
  `@kanzo-tech/ai/data`, run over the same join graph with the profile's columns as its fields:
  answerable when its spec holds or only asks which way. Until a model is accepted, `answerable`
  stays `null`.
- *What would reverse it:* questions marked answerable here that Ask, over the built graph, cannot
  answer — then marking waits for the preview and runs Ask on it.

**Failure is said, not swallowed.** A Task that throws, or whose oracles still refuse after its
attempts, ends the chat's flow with its problem (`llm/failed` when it has no code of its own) and a
retry; nothing downstream runs on a refused artefact.

## The preview is in the chat

**Built 2026-10-13.** Once there is a program, it runs over the first 200 rows
of each source **into memory** — fossil's `run(program, { host, into: "memory", limit: 200 })`, in
this tab's run worker, which answers the corpus's files as bytes and writes nothing — and the files are
attached to the assistant page's engine from those bytes: each registered with DuckDB-WASM as a buffer
under a prefix of its own, and fossil's `attach` pointed at that prefix as a corpus at a URL, which
needs nothing of fossil it lacks (`lib/fossil/memory-corpus.ts`). `usePreview(program, profiled)`
(`lib/fossil/preview.ts`) is the hook: `idle`, `running` — the last corpus kept on screen —, `ready`
or `failed`, each corpus named by its program and cached as a graph's is, so a decision changed is a
preview of its own and the one it replaces is given back once nothing reads it. Inside `CorpusScope`
over it, `useCorpusAsk()` (`lib/fossil/ask.ts`) is Ask as Discover's panel runs it, and the person's
questions are answered in the chat with `AnswerCard`s over the sample. One door to fossil's executor,
`lib/fossil/executor.ts`, maps `{ job }` and `"memory"` onto `run`'s `into`.

**How the chat reads it** (`assistant-flow.tsx`, `preview-turn.tsx`). The preview runs the `mapping`
Task's program and nothing before it: the chat shows *writing how your files become a graph* until
there is one. A decision changed is a model accepted again, so the mapping writes the program again;
meanwhile the last program stays the preview's (`keepPreviousData` on the mapping) and its answers
stay on screen, dimmed and inert under *Updating…* beside the heading, until the new corpus lands and
its answers replace them. Each kept question is sent to `useCorpusAsk()`'s chat in turn — one at a time, as a chat
answers, and only once the model is ready — and drawn as Ask's panel draws it, an `AnswerCard` with
its `AskChips`. There is no composer under them: a tie Ask asks back is answered in Discover, over the
whole graph. A failed run is said with its problem and a retry (`rerun`).

**The whole graph is built once, when the person asks** — *Build the whole graph*: `useBuild(program,
profiled, { conversation })` (`graphs/new/_parts/use-build.ts`) makes it as the studio does, a draft
submitted and run under its job (`into: { job }`), and `lib/fossil/build.ts` is the machine its turn
reads, `building` → `done` or `failed`. A build outlives the assistant's page; the last turn's links
carry the person's question to Discover as `?q=`, and Ask sends it once the model is ready and takes it
off the URL as it does, so nothing asks it twice.

**Why in the chat, and not in Discover.** The preview is where the decisions are judged: the person
sees answers over their own rows next to the question that shaped them, changes a decision and sees
the answer change, before anything is written — 200 rows in memory cost seconds, so running it again
is cheap where building the graph again is not. And Discover only ever shows a whole graph, the
graph's own output under its id: no second corpus beside it to switch from, nothing that is not what
the graph holds.

**Build the whole graph** saves the conversation first and builds under the id that save answers —
which is a new conversation's when the one opened was built from already — so a graph always names
the conversation as it stood when it was asked for. Its turn reads `building` (with its percent once
the run reports one), `failed` with its problem and a retry, and `done` with **Ask your data** and a
link per question, `askHref(graphId, question)`. A decision changed after a build is a program with no
build: the action is offered again, and makes a new graph. The earlier shape — the preview built with the graph and opened in Discover under
`<id>~preview` until the whole landed — waited on a decision taken blind and put a sample where a
graph was expected.

*What would reverse it:* people who never look at the preview and go straight to building — then the
preview runs behind the build, and the chat goes to Discover as soon as the graph is made. Or a
preview that cannot answer what the person asked over 200 rows — a question whose answer needs the
whole of a source — then the chat says so and offers the build in its place.

## The conversation is kept

**Built 2026-10-13**, as reference chat systems keep one — the AI SDK's `UIMessage[]` per chat id,
resumed with `useChat({ id, messages })`; Vercel's chatbot template's `Chat` and `Message` tables;
OpenAI's Threads: a `conversations` table (`POST /v1/conversations`, `GET /v1/conversations/{id}`,
`PUT /v1/conversations/{id}/messages`), its messages a JSON array keasy never reads, under a 256 KiB
cap; and a `conversation` on each graph, set when it is created from its creator's own. The decisions
are data parts of those messages (`data-decision`: the options offered, the one taken, whether it was
assumed), so Discover's *What I decided* reads them from the graph's conversation and **Change**
opens `/graphs/new/assistant?conversation=<id>&decision=<id>`. `useAssistantConversation(id?)`
(`lib/assistant-conversation.ts`) is the web's side: `{ id, messages, save, decisions }`.

**One message per turn** (`conversation.ts`'s `messagesOf`): each carries a `data-turn` with its kind,
and its id is the kind and what it is about (`decide:<decision>`, `asked:<question>`), so a save
replaces a turn rather than adds one. The person's turns are `user` messages: `data-files` on the
pick, `data-about` on its reply, `data-decision` on a decision answered (`option: null` while it is
asked; the last word on each wins), `data-question` per question kept, and `data-program` on the
preview's turn. `restore` reads the same parts back, and the chat starts where they stood: the files
read again without listing their folders (a file whose connection is gone is said, as a problem of
the reading turn), the person's choices taken again, an assumption left to its default, the questions
kept, and the program last written previewed until the mapping writes it again. The `model` Task is
asked again, from the profile, so a decision is raised again by its id; **Change** in Discover
(`?decision=`) opens its turn at its options — over a built conversation with the note that a graph
was built from it just above, since that is where the page lands. *What would reverse it:* a model that raises other
decisions on the same files when asked again — then the accepted `model` artefact is kept too, as
structure, and reopening skips the Task.

**Saved whole after each reply, not appended.** The array is small — structure only, below — and
whole is what the AI SDK hands back on finish; an earlier answer taken again replaces every turn after
it, which an append cannot say; and a save sent twice, or retried after a timeout, is one save. *What
would reverse it:* conversations long enough that a reply's save is felt — then messages get rows of
their own, as the chatbot template's do, and a save sends what changed.

Saving starts at the person's first reply on the page — a conversation opened and only read is not
saved again — and waits while the files are read or the `model` Task answers, when the turns after
them are not said yet and a save would drop them. The id saved under goes on the URL
(`?conversation=`), so a reload resumes it.

**A conversation a graph was built from is that graph's record**, as a submitted graph's script is
(`graph/not-draft`): a save over it is refused (`conversation/built`), and the hook carries on in a new
conversation started from its messages — so Change rebuilds as a new graph with a conversation of its
own, and the first graph still lists what it was built with. The chat says so above its first turn
when it opens one.

**What is stored, and what is not.** The premise is that the person's data never leaves the browser,
and a saved conversation is no exception. Stored: the turns' kinds and ids, the options offered in
keasy's words, the person's choices, what they typed — their questions and the *what is it about?*
sentence —, the files they picked as locations (connection and path), and the program. Not stored:
sample rows, example values, counts, column statistics, an answer's rows, the assistant's prose (which
quotes a row: *e.g. Marie Curie · Physics · 1903*), a file's contents, and an option's `detail`. They
are recomputed from the profile when the conversation is opened again. One function holds it,
`toStored`, through which every save and every read goes: an allow-list, each kept part rebuilt from
the fields it may hold, so a field added upstream does not ride along unread; its test sends a message
carrying example rows through it and finds none. *What would reverse it:* a need for the exact
transcript, rows and all — an audit, a support case — and then it is stored in the person's own
storage, under their own credential, never in keasy's database.

## What left keasy's configuration

**Done 2026-10-13**, on kanzo-ui 0.44's `localModel`: one model, `MODEL` in `web/src/lib/ai.ts`, in a
worker of its own, for Ask, its offers and the assistant alike.

| Before | Now |
| --- | --- |
| `ai-gateway`, `ai-postgres` and, locally, `ai-models` with Docker Model Runner | none |
| `KEASY_AI_URL`, `KEASY_AI_CHAT_CONTEXT`, `KEASY_AI_COMPLETE_CONTEXT`, `AI_CHAT`, `AI_COMPLETE`, `AI_DB_PASSWORD` | `KEASY_MODEL_URL`: the path on keasy's origin its shards are served at (`/models`), read per request; empty, no model |
| the BFF's `/api/ai` forward, with its token exchange for the `ai-gateway` audience | nothing to forward |
| context windows that must match the deployed model | the window travels with the model |
| `make demo` switches the gateway to Qwen3 and back | the demo uses everyone's model |

**The shards are keasy's, served from its own origin, never a third party's** (2026-10-13). WebLLM's
default is its prebuilt list — the weights from Hugging Face, the library from GitHub — and keasy does
not fall back to it: with `KEASY_MODEL_URL` empty, or naming another origin, there is no model, and Ask
and the assistant say so (`ai/unavailable` with `reason: "unserved"`, the one code `@kanzo-tech/llm`'s
`AiError` has). `make models` (`infra/models.sh`) downloads them once — the weights at a pinned Hugging
Face revision, the library at a pinned commit of `binary-mlc-llm-libs`, every file checked — into
`infra/models`, which the `models` service (nginx, `compose.yaml`) serves at `/models`: through Next's
rewrite in development, which has no edge, and through Traefik in a deployment (`infra/prod/README.md`).
Each path names one content for good — `<model>/resolve/<revision>/` and `lib/<webllm>/<library>` —
so a shard is cached as immutable, and `ai.test.ts` holds the pins to the script's and the library to
the installed WebLLM. The CSP needed nothing: the shards and the worker are `'self'`.
*What would reverse it:* a deployment that cannot serve 2.3 GB from its own origin, where a CDN of its
own is the answer — still not WebLLM's prebuilt, whose files change under one URL.

**The download starts with intent** — when a graph opens, or the assistant — not when
Ask's panel does: `usePreloadModel` calls `loadLocalModel` once per page, in the background, and the
page works without the model meanwhile. How it stands is `@kanzo-tech/llm/local`'s `localModelLoad`,
drawn as kanzo-ui 0.45's `ModelBadge` (`ModelStatus`) in Ask's composer and the assistant's header —
*Preparing the model · 42%*, *Model ready*, or *Model failed* with the problem behind it; a question
asked meanwhile waits for it. WebLLM keeps it in
Cache Storage, behind `navigator.storage.persist()`. Not yet: versioning — the old one serving until
the new one is whole. *What would reverse it:* people who open graphs and never ask, on metered
connections — then the download waits for the first screen that asks.

**The e2e suite runs on a model double in the page**, because CI's Chromium has no WebGPU:
`e2e/support/model.ts` puts a scripted `LanguageModel`, and its load as a `ModelLoad`, on `window.__keasyModelDouble` before the page
loads, and `lib/ai.ts` asks it in place of WebLLM — in a development build only, behind
`process.env.NODE_ENV`, which `next build` inlines, so the production bundle has neither the branch nor
the name (`model-double.test.ts`, run on the built bundle in CI). Scenario 11 still forces a browser
without WebGPU, with no double; 12–16 and the dashboard's are real again over the double. What it
cannot show is WebLLM itself: that the pinned shards load and answer is a browser with WebGPU's to
check (`make models`, then the eval).

## The executor leaves the page's main thread

**Confirmed 2026-10-12:** `startRun` (`graphs/[id]/_parts/use-browser-graph-runner.ts`) imports
`@fossil-lang/executor` and calls `run`, which constructs `FossilExecutor` in the calling realm —
the page. Nothing in `web/src` creates a `Worker`. Today that blocks only a page whose person is
waiting for a run; with a preview run while they talk to the assistant, it would block the chat. The
executor moves to a worker of its own — done: `lib/fossil/run.worker.ts` runs both.

## Cross-origin isolation

Only needed if a threaded WASM fallback for the model is ever decided (kanzo-ui's page says why
there is none at first). What was checked on 2026-10-12, with `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp` added to `next.config.ts`'s headers
locally, against the dev stack:

- `auth.spec.ts` and `discover.spec.ts`: 14 of 15 passed — sign-in through Keycloak, a graph run to
  completion in the browser over the dev S3 store (`runToCompletion`), and Discover over its corpus.
  The one that failed, *the view and the dock's panel are the URL's*, fails the same way with the
  headers off: React Query's dev-only devtools overlay takes the dock's click.
- A test that opened Discover over that corpus read `crossOriginIsolated` true and `SharedArrayBuffer`
  defined, and saw no request blocked by COEP.
- From the isolated page, a ranged `fetch` of a presigned `e2e/data/people.csv` on the dev S3 store
  (`s3.localhost:9000`, another origin) answered 206 with `Content-Range` exposed: a CORS read, which
  COEP admits.
- By reading: the CSP keeps scripts, workers, `.wasm`, images and fonts on this origin; sign-in is a
  redirect to Keycloak with no popup; the two `target="_blank"` links carry `noopener`.

**Not checked:** a read from Azure — the dev stack has no Azure emulator. The e2e that ships with the
headers adds one, and asserts `crossOriginIsolated`.

## Order

keasy's part of phase 1 is the evaluation set, under `e2e/eval`: Ask's cases (`cases.ts`, one or two per
shape of question — 25 on Nobel and 11 on LDBC SNB, each with its expected rows, computed with DuckDB
over the example's files) and the four examples for the assistant, kept as data for the new
assistant. Four cases end in words and not in rows: two ties (a prize's country, a person's
friends), which must be asked back with the relations as numbered options, and two questions the data
cannot answer (prize money, an age), which must draw no card. The figures that need a date in a
cell are left out until the harness reads one. `EVAL_MODEL=<label> pnpm --filter @keasy/e2e eval` asks today's
Ask once, as a reference number — on the page's model, so in a browser with WebGPU, and with
the shards on a local copy (`make models`), as each case's browser starts with empty storage; `writeProgram` is not measured, it is replaced whole. The reference pass (2026-10-12, Qwen3-4B through Model Runner, today's Ask) answered **2 of 10**
right — prizes by category and airports by country. Two failed on the page's filter: the model picked
a relation that reaches it, and the answer read no rows, because today's Ask kept a page's clause only
when the answer's relation had its column (fixed in kanzo-ui, where the answer now crosses a chip as
the dashboard's tiles do). Five failed on the call itself: the model reasoned its way to the where —
*gender female*, *country Spain*, *born 1985–1989* — and called `answer` without it, or answered a
breakdown as one figure. One asked what the spec cannot say (*more than one prize*, a filter on a
count). Those are what the Task addresses: a small spec decoded against its schema, and oracles that
send back a spec that drops what the question asked for. Phase 1 (Ask as a Task) touches
`discover/_parts/ask-panel.tsx`; phase 3 is the guided chat, which replaced the wizard on
2026-10-13 — "Assistant" in the new-graph picker opens it. The gateway, the BFF's `/api/ai` forward
and their configuration went the same day. The phases are on
[Tasks](https://kanzo-tech.github.io/ui/docs/design/tasks#phases).
