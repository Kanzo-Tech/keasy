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
in keasy's own configuration and runtime. What of it moves into kanzo-ui and fossil once they release it — the run
worker, the in-memory corpus, the model double, the conversation's keeping, the Tasks' guesses and the
evaluation set — is said in each section below, and the order is on [cleanup](cleanup.md).

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

- **Context**: the accepted model's types, and from each the paths Ask's model writes, two links out
  at most (`category`, `laureate.affiliation.name`, `^laureate.category`), keys left out.
- **Contract**: `{ text, of, fields }`, `of` a type and `fields` a list of paths from it, both enums.
- **Oracle**: Ask's resolver — `JoinResolver` from `@kanzo-tech/mosaic` over the join graph the
  accepted model will be (`joinGraphOf`, written by hand: nothing has run yet) — reaches each path
  from `of` (`requirements/unreachable`, naming the paths it does not).
- **Offered** with `propose` through `useTask`, five at a time, as chips; a chip is answerable by
  construction. **A question the person types** is marked by Ask's own Task, `ask` from
  `@kanzo-tech/ai/data`, run over the same join graph, which says what each field is: answerable when
  its spec holds or only asks the person a decision. Until a model is accepted, `answerable`
  stays `null`.
- *What would reverse it:* questions marked answerable here that Ask, over the built graph, cannot
  answer — then marking waits for the preview and runs Ask on it.

**What leaves for the libraries** (direction, 2026-10-13; [cleanup](cleanup.md)). Three of the
Tasks' pieces re-derive what a library will know exactly, and go once it releases:

- **`requirements`** (`tasks/requirements.ts`, 139 lines with its hand-made `joinGraphOf`) — its
  oracle is a second resolver over a join graph keasy builds by hand, hard-coding `id`, `src` and
  `dst`. Under kanzo-ui's paths design (`JoinResolver` the one door to the joins, Ask writing
  Malloy-style dotted paths), a question is answerable exactly when `JoinResolver.relation(root,
  shown)` validates its paths, and the fields offered are `JoinResolver.paths(root)`. The chips are
  then Ask's own offers over the accepted model's `JoinGraph`, and keasy's Task is deleted.
- **`words`** (`tasks/words.ts`, 67) — `spoken`, `plural`, `singular`, `withArticle`, an English
  heuristic. Words come from the data: an `rdfs:label` or `sh:name` annotation in the page's
  language (fossil's annotations design), else the identifier split as a last resort, with
  `Intl.ListFormat` and `Intl.PluralRules`; titles avoid plurals (*Award count by university*). What
  keasy still needs, `pascal` and `camel` for the names the `model` Task proposes, stays.
- **`profile`'s and `model`'s facts** (~60 of `profile.ts`, ~150 of `model.ts`) — candidate keys,
  identifier-ness and a column's datatype guessed from names and a sample, which fossil's corpus
  will carry (term type, datatype, label, endpoint keys, the profile stored in the corpus) and
  `@kanzo-tech/graph`'s `JoinGraph` will carry to Ask.

About 415 lines and their tests. *What would reverse it:* a library that cannot answer for an
unbuilt model — `JoinResolver` needing a corpus where the assistant has only an accepted artefact.
Then keasy keeps a `JoinGraph` built from the artefact, through the library's one constructor, never
a second resolver.

**Failure is said, not swallowed.** A Task that throws, or whose oracles still refuse after its
attempts, ends the chat's flow with its problem (`llm/failed` when it has no code of its own) and a
retry; nothing downstream runs on a refused artefact.

## The preview is in the chat

**Built 2026-10-13.** Once there is a program, it runs over the first 200 rows
of each source **into memory** — fossil's `run(program, { host, into: "memory", limit: 200 })`, in
fossil's run worker, which answers the corpus's files as bytes and writes nothing — and the files are
attached to the assistant page's engine from those bytes with `@fossil-lang/corpus`'s
`attach(name, { engine, files })` (fossil 0.3.0-alpha.32), which registers the buffers under a prefix
of their own and gives them back on detach: fossil reads what fossil wrote. *What would reverse it:*
fossil dropping that `attach` form — then keasy registers the buffers itself again. `usePreview(program, profiled)`
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
OpenAI's Threads: a `conversations` table (`GET` and `PUT /v1/conversations/{id}`, the id a UUID
the client makes, as the AI SDK's chat ids are, and the first save starting it), its messages a JSON
array keasy never reads, under a 256 KiB cap; and a `conversation` on each graph, set when it is created from its creator's own. The decisions
are data parts of those messages (`data-decision`: the options offered, the one taken, whether it was
assumed), so Discover's *What I decided* reads them from the graph's conversation and **Change**
opens `/graphs/new/assistant?conversation=<id>&decision=<id>`. `useAssistantConversation(id?)`
(`lib/assistant-conversation.ts`) is the web's side: `{ id, messages, save, decisions }`, over
`@kanzo-tech/ai`'s `useKeptChat`.

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

**The keeping is `@kanzo-tech/ai`'s, and the store and the filter keasy's** (kanzo-ui 0.46,
`useKeptChat`). Reading once per id, validating what comes back with the AI SDK's
`validateUIMessages`, and saving whole after each reply, one save at a time, are the library's;
keasy hands it `load(id)` and `save(id, messages)` against `GET` and `PUT /v1/conversations/{id}`,
and `keep` — `keptPart`, the allow-list `toStored` is made of, part by part. A message the filter
leaves no part of is not stored. What stays keasy's is the rule of its record: a conversation a graph
was built from is not saved over — opened, the chat carries on from its messages under a new id; built
from meanwhile, in another tab, the save that meets `conversation/built` writes the new id instead.
*What would reverse it:* a second guided chat in the library that needs a different saving rule —
appended, not whole — and then the library's piece is the narrower one and keasy keeps its own rule;
or the library's `keep` running anywhere but on keasy's side of the save, which would put the privacy
premise in someone else's hands.

## What left keasy's configuration

**Done 2026-10-13**, on kanzo-ui 0.44's `localModel`: one model, in a worker of its own, for Ask, its
offers and the assistant alike — since kanzo-ui 0.46, the first model `/models/app-config.json` lists.

| Before | Now |
| --- | --- |
| `ai-gateway`, `ai-postgres` and, locally, `ai-models` with Docker Model Runner | none |
| `KEASY_AI_URL`, `KEASY_AI_CHAT_CONTEXT`, `KEASY_AI_COMPLETE_CONTEXT`, `AI_CHAT`, `AI_COMPLETE`, `AI_DB_PASSWORD` | none: the page reads `/models/app-config.json`; no listing, no model |
| the BFF's `/api/ai` forward, with its token exchange for the `ai-gateway` audience | nothing to forward |
| context windows that must match the deployed model | the window travels with the model |
| `make demo` switches the gateway to Qwen3 and back | the demo uses everyone's model |

**The weights come from WebLLM's own arrangement, pinned** (2026-10-14). The browser fetches the MLC
weights from Hugging Face and the compiled library from GitHub, the two places WebLLM's prebuilt list
names, and keasy hosts neither: what it serves is one static file, `web/public/models/app-config.json`
— WebLLM's own `AppConfig`, which `lib/ai.ts` hands to `@kanzo-tech/llm`'s provider once,
`localProvider({ baseURL: "/models", worker })`, and which serves exactly what it lists; a listing
that lists nothing is no model, and Ask and the assistant say so (`llm/unavailable` with
`reason: "unserved"`). keasy's code names no model, no URL and no pin. Unlike the prebuilt list, the
record is pinned: `model` is the weights' repository at a commit
(`.../Qwen3-4B-q4f16_1-MLC/resolve/<40 hex>/`), `model_lib` the library at a commit of
`binary-mlc-llm-libs`, under the release of WebLLM it was compiled for, and `integrity` is WebLLM's
SRI on `mlc-chat-config.json`, the library and `tokenizer.json` — the three it verifies; `ai.test.ts`
holds the record to WebLLM's `ModelRecord` and `AppConfig`, every URL to a commit, and the library to
the installed release. A commit-sha URL resolves on Hugging Face (checked 2026-10-14); the large
files redirect to `us.aws.cdn.hf.co`, which answers CORS with `*`, range requests included. The
browser therefore needs egress to `huggingface.co`, `us.aws.cdn.hf.co` and
`raw.githubusercontent.com`; the CSP's `connect-src https:` already covers them, and a policy that
enumerated hosts would add exactly those. Privacy is unchanged: inference stays in the page and
nothing about a question is sent; what the three hosts see is a download of public files, with the
person's IP address and user agent.

To point keasy at another model or host, edit that record: `model` takes the base URL of any host that
serves the same files, `model_lib` the library for the WebLLM release the web installs (`v0_2_86` in
its path today), and `integrity` the SRI of the three files whose bytes are pinned — `openssl dgst
-sha256 -binary <file> | base64`, prefixed `sha256-`. A host of your own must answer cross-origin
requests (`Access-Control-Allow-Origin`), range requests included, and its hostname joins the egress
list above.

What this does not cover, and nothing here has verified: the weight shards. WebLLM checks no hash on
them, so the commit in the URL is the only pin — a commit's files do not change, and Hugging Face
could still withdraw them. Hugging Face's terms have not been read for this use. Its anonymous
resolver limit is 3,000 requests per five minutes per IP address, and a first load is about 80
requests, so a few dozen first loads from one shared address in that window are refused (HTTP 429)
and the model fails to load, retried by the person. Whether the CDN host answers CORS identically
from every region is unverified: only `us.aws.cdn.hf.co` was seen. The browser keeps the files in Cache Storage, so
only the first load pays any of this.

*What would reverse it:* an organization that cannot open egress to Hugging Face and GitHub, or many
first loads behind one IP address meeting the limit — then the operator mirrors the files to a host
of its own and edits `app-config.json` to name it (above); and Hugging Face's terms,
once read, forbidding this use.

**The download starts with intent** — when a graph opens, or the assistant — not when
Ask's panel does: `usePreloadModel` calls `loadLocalModel` once per page, in the background, and the
page works without the model meanwhile. How it stands is `@kanzo-tech/llm/local`'s `localModelLoad`,
drawn as kanzo-ui 0.45's `ModelBadge` (`ModelStatus`) in Ask's composer and the assistant's header —
*Preparing the model · 42%*, *Model ready*, or *Model failed* with the problem behind it; a question
asked meanwhile waits for it. WebLLM keeps it in
Cache Storage, behind `navigator.storage.persist()`. Not yet: versioning — the old one serving until
the new one is whole. *What would reverse it:* people who open graphs and never ask, on metered
connections — then the download waits for the first screen that asks.

**The e2e suite runs on `@kanzo-tech/llm`'s model double**, because CI's Chromium has no WebGPU:
`e2e/support/model.ts` registers a scripted model with `@kanzo-tech/testing`'s
`playwright(page, { models })` before the page loads. It goes into `@kanzo-tech/llm/local`'s provider
registry, which `localModel()` asks before the models the origin serves, so it answers in their place
— its load included — and every prompt is recorded. keasy's code has no branch for it, and the
library's has none either: a test is a provider like any other. A script that runs in the page before
keasy could register one too, as it could replace `fetch` or `Worker`; one that runs there can already
do anything the page can. The Tasks' unit tests use the same double, `scriptedModel` from
`@kanzo-tech/llm/testing` (`nobel.fixture.ts`). Scenario 11 still forces a browser without WebGPU,
with no script; 12–16 and the dashboard's run over the script. What it cannot show is WebLLM itself:
that the pinned shards load and answer is a browser with WebGPU's to check (open a graph, then
kanzo-ui's evaluation set). *What would reverse it:* a page that runs third-party script before its
own — then the registry must refuse what the page did not register, in the library.

## The executor leaves the page's main thread

**Confirmed 2026-10-12:** `startRun` (`graphs/[id]/_parts/use-browser-graph-runner.ts`) imports
`@fossil-lang/executor` and calls `run`, which constructs `FossilExecutor` in the calling realm —
the page. Nothing in `web/src` creates a `Worker`. Today that blocks only a page whose person is
waiting for a run; with a preview run while they talk to the assistant, it would block the chat.

**The worker is fossil's** (fossil 0.3.0-alpha.32): `run` starts a module worker of its own wherever
`Worker` is a constructor, proxies the `Host` to the page, and a stopped run terminates it. keasy calls
it from the page through `lib/fossil/executor.ts`'s door, and keeps no worker, protocol or port of its
own; the CSP's `worker-src 'self'` admits it, as the bundle serves it. *What would reverse it:* a run
that needs something only keasy's page holds and fossil's protocol cannot carry — then that crosses
in fossil's protocol, not in a second worker here.

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

**Ask's evaluation set is kanzo-ui's** (moved 2026-10-14, `packages/ai/eval`): it scores
`@kanzo-tech/ai/data`'s `ask` Task, which is kanzo-ui's, beside the Nobel fixtures it is asked over.
keasy keeps no copy: `e2e/eval`, its `eval` project and script, and the four assistant examples that
nothing ran are gone. *What would reverse it:* a measure that only keasy's page can take — the
assistant's whole flow, file to first answer, which is *time to smile* — and then that one lives here,
written when something runs it.

The reference pass (2026-10-12, Qwen3-4B through Model Runner, the Ask of the day) answered **2 of
10** right; what failed, and what the Task changed for it, is kanzo-ui's to record beside the set.
Phase 1 (Ask as a Task) touches `discover/_parts/ask-panel.tsx`; phase 3 is the guided chat, which
replaced the wizard on 2026-10-13 — "Assistant" in the new-graph picker opens it. The gateway, the
BFF's `/api/ai` forward and their configuration went the same day. The phases are on
[Tasks](https://kanzo-tech.github.io/ui/docs/design/tasks#phases).
