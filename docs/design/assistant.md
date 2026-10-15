# The assistant, and time to smile

Status: a direction. Built: the model in the page, in place of the gateway, served from keasy's own
origin and preloaded with intent (2026-10-13); the guided chat (2026-10-13); and its three Tasks,
`model`, `mapping` and `requirements`, over fossil's profile (2026-10-13, below); the conversation
kept, and the preview run in memory and shown in the chat, the chat wired to both and to the build
(2026-10-13). **The chat as one thread, built 2026-10-14** ([below](#one-thread-top-to-bottom)): the
sources picked on pills above the composer and sent with what they are about as the first message, the
Tasks drawn as steps, the details pinned above the thread, the model badge in the app's header, and the
conversation closed by its build. **Decided, not built:** every result a new message at the end with a
checkpoint per preview that restores and cuts the thread, node and edge counts in the build's step, a
composer under the preview, and Discover showing decisions without *Change*; each says so where it is
described. The pattern this rests on — a *Task*: a small model in the browser fills a small artefact under a JSON Schema, a deterministic oracle checks it, a bounded loop repairs
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
with kanzo-ui's chat parts (`Conversation`, `Message`) as Ask's panel is.

**The person's replies are choices, chips or questions — never free-form instructions.** What they send
or write is drawn as their message (the files with *what is it about?*, a question); a choice made on a
decision's options is not said again as a reply — it stays selected where it was made, which is where
it is changed, by picking another. A thing said twice reads as two things. Free text goes in only where
it is a question, or the optional *what is it about?*; the composer's field is off otherwise, and says
in its placeholder what the thread waits on.

**A default taken is said once, with one door to its options: *I assumed: id · Change*.** The line is
what was taken, and *Change* opens the question under it; the options are not drawn beside it. This
reverses the rule that said an assumption's options are always in place, with no *Change*, because
they were a second door to the options of the decision it assumed for, and nobody read them as one —
the artifact the thread was designed in (*Asistente en un hilo*) draws the line alone, and a grid of
radios under every assumption turned a line into a form. A decision with no safe answer is the
opposite case and keeps its options in the open, because the thread waits on it. *What would reverse
it:* people who change an assumption and do not find *Change* — a line that reads as plain text —
then the options are in place again, and the line is their heading.
*What would reverse the whole rule:* a transcript read away from its options — exported, or shown
where they cannot be drawn — where the choice has to be said in words; then a decision answered is a
reply again.

## One thread, top to bottom

**Decided 2026-10-13, built 2026-10-14 except where a section says otherwise.** The whole of the assistant is one thread read from top to bottom:
what the person sends, the steps the assistant takes for it, and each result as a message after them,
in the order it happens. The references are ChatGPT's data analysis and Julius, which put a result —
a table, a chart — in the thread under the step that made it, rather than in a panel beside it;
Claude's connectors, for picking what a conversation reads; and AI Elements' `Tool` and `Checkpoint`,
for drawing a step and a point to return to. What it replaces is said in each rule: the separate turn
that picked the files from a tree, the assistant's own top bar, the messages that changed in place,
and the note above a built conversation.

The thread, for the Nobel files:

1. **The composer, with the sources on it.** The person picks files on the pills above the field, says
   *what is it about?* (or nothing), and sends both as their first message.
2. **Steps** — *Read the files*, *Propose the types*, and what comes after them, still to do.
3. ***Here's what's in your data*** — the things with real counts and what each holds, and how they
   hang together as sentences with one real row: *each award has a laureate, a category and a year;
   e.g. Marie Curie · Physics · 1903*. Never shape, IRI, predicate or cardinality. Under it, what was
   assumed, each as *I assumed: id · Change* — the option taken, and its options behind *Change*. They
   come before the decision that blocks, so the first thing the person is asked is the last thing said.
4. **The one decision with no safe answer**, as kanzo-ui's `Question`: its question and its options. It
   blocks what comes after it; an assumption blocks nothing.
5. ***What would you like to know?*** — the questions already answerable from these files, as
   `Suggestions`, and the composer for one's own; each question kept says whether these files can
   answer it. *That's all, show me a preview* ends it.
6. **Steps** — *Wrote the program · Open in the editor*, *Ran it over the first 200 rows of each file*
   — then **the preview**: each question kept, answered over the first 200 rows with Ask's cards, two
   to a row, a footnote that the whole graph counts every row, and **Build the graph**. (A checkpoint
   above it is decided and not built, [below](#checkpoints).)
7. **The build** — the person's *Build the graph*, its steps (*Kept this conversation*, *Built the graph
   from every row*), then *Your graph is ready* in a tinted panel with **Ask your data**, **Open the
   graph** and the person's questions — and the composer gives way to the conversation's close.

### Sources in the composer, as Claude's connectors

Above the composer's field, **one pill per readable connection** — *+ @CORDIS*, *+ @Nobel laureates* —
the connections `use-assistant.ts` already reads (`readable`: data, not the sink). A pill opens a small
menu anchored to it, as Claude's connector does: the connection's name with **Select all**, then each
readable file as a checkable item with its size. What is picked stays on the pill — *@Nobel laureates ·
6 files ×*, the cross clearing it. There are no attachment cards, no dialog and no file search. The
first message sends the picked files and *what is it about?* together, so the person's first act is
the one Claude's and ChatGPT's composers ask for — say what you want, with what you want it over — and
the assistant has both before its first step.

What goes: the *Which data do you want to explore?* turn, its `SourcePicker` tree in the thread
(folders opened one by one, a folder's box picking what is listed under it), its *Read these files*
reply, and the separate *what is it about?* turn after it. The tree was a second surface inside a
message — a form posted into the chat — and the reply under it said again what the tree already
showed. The menu lists what the connection's listing returns, and a folder it returns is a submenu
that lists itself when it is opened — a folder is never opened for the person. **Select all** takes
every file under the connection, folders included. The pill's cross and **Select all** are keasy's own
elements: `Menu`'s checkable items and `PromptInputHeader` are kanzo-ui 0.46's, and neither has a
chip with a cross. *What would reverse it:* a connection whose
readable files do not fit a menu — hundreds, or folders that only make sense as folders — then the
pill's menu opens a submenu per folder, and a search over it is Claude's next step, not a dialog.
Or more connections than fit above the field: then one *+ Add sources* pill lists them, each a
submenu, as Claude's *+* does.

### The details, pinned above the thread

Once the first message is sent, a block is pinned above the conversation, outside its scroll: the
sentence the person said the data is about, and *Used 6 files*, which opens to the files by their
connection and path. The steps scroll with the thread and never move it, and the person can always
read what the thread was made from without going back up to its first message. It is AI Elements'
`Sources` in shape (`Sources`, `SourcesTrigger` with a `count`, `SourcesContent`, `Source`), a thin
local component in `sources.tsx`, and a candidate for `@kanzo-tech/ai` in kanzo-ui 0.47. *What would
reverse it:* a thread short enough that the first message is always in view — then the block is a
repeat of it, and goes.

### The model badge in the page's header

*Model ready* (`ModelStatus`, kanzo-ui's `ModelBadge`) sits at the end of the page's own header, the
shell's, through `HeaderEnd` as Discover's controls do. The trail reads *Dashboard › Graphs › New
graph*, and once the conversation has built a graph, the graph's name in its place
(`/graphs/new/assistant?graph=<id>`, as `?draft=` names a recipe). **The assistant's top bar goes**: its *Graphs*
and *New graph* repeated the breadcrumbs beside it, and its other button, **Advanced**, becomes an
action on the step that writes the program — **Open in the editor**, which leaves for the studio with
the program and the picked files as its sources, as Advanced did. An action on the thing it acts on is
found there; one in a bar is found by those who look for a bar. *What would reverse it:* a header that
cannot hold the badge — on a phone, where the trail takes its width — then the badge goes in the
composer's toolbar, as Ask's does.

### Steps while it works

Each piece of work is **a step with its state**, in a list headed *What I am doing*: *Read 6 files ·
1,026 awards, 1,012 laureates*, *Proposed the types*, *Waiting for you: one decision has no safe
answer*, *Write the program*, *Run the preview*. A step is done, under way (or waiting on the person)
or still to come, and **the steps still to come are on the list from the start**, so the person reads
what is left as well as what is done. A step's state is derived each time from what the conversation
already knows (`steps.ts`: the reading, the `model` Task, the decisions, the program, the preview, the
build) and is not kept; a Task's problem is said where it stopped, with **Retry**, as before. The
`requirements` Task is not a step: while it runs, the `Suggestions` show as pending pills where the
questions will be. There are three lists in the thread — reading and proposing, writing and running,
and building — and the work to come on the first moves to the second once the questions are asked.

**The list is AI Elements' `ChainOfThought` in shape, not `Tool`.** A step takes `icon`, `label`,
`description` and a `status` of `complete`, `active` or `pending`, in `chain-of-thought.tsx` — a thin
local component, a candidate for `@kanzo-tech/ai` in kanzo-ui 0.47 so that replacing it is an import
swap. `Tool` was the first choice and is not the right one: it is a bordered, collapsible card bound
to an AI SDK tool part, with a badge for its state, and cannot say what has not started. The icons are
the library's: `Working`'s spinner for a step under way, so there is still one vocabulary for busy.
*What would reverse it:* steps that carry what a plain line cannot — a Task's attempts and its oracles'
diagnostics, opened on request — then a step that has them is a `Tool`, and the plain line stays for
the rest.

*What would reverse it (steps at all):* people in a user test who cannot say what the assistant was
doing from its steps — then a step is a sentence again, with its bar.

### Each result is a new message at the end

**Decided, not built.** Today the preview is still one message that is replaced in place under *Updating…*, dimmed and inert, as the section on the preview says. Every result is **a message added at the end, in the order it happens**, and **nothing transforms in
place**: *what's in your data* with what it assumed, the one decision, the suggested questions, the
preview, the build. A decision changed — on its `Question`, or behind an assumption's *Change* — stays
selected where it was made, and what it causes is new: the steps that write the program again and run
the preview again, and a new preview message after them. The preview that changed under *Updating…*,
dimmed and inert until the new corpus replaced it, goes: two previews are two messages, and the
earlier one still says what the earlier program answered. This is how ChatGPT's data analysis and
Julius read: a result is under the step that made it, and a new run is a new result below, never the
old one rewritten — so the thread is the order things happened in, which is what makes it a record.
*What would reverse it:* a preview that proves unreadable inside the thread — Ask's cards too narrow
in the column, or a decision and the answers it changed screens apart — then the assistant goes back to
a split layout, the chat beside a panel that holds the current preview.

### Checkpoints

**Decided, not built** — it waits on the thread above being append-only. **One checkpoint per preview run** — each time the program changes and runs again — drawn with
`@kanzo-tech/ai`'s `Checkpoint` (AI Elements' part, being added to kanzo-ui) above its preview, with
**Restore**. **Restoring cuts the thread there**, as AI Elements' `Checkpoint` example and v0 do:
every message after the checkpoint is removed, from the screen and from the stored conversation, and
the program and the decisions return to what they were at that point — so the checkpoint's preview is
the last message again, and the thread goes on from it. The current checkpoint is therefore always the
last one, and **building builds from it**. A checkpoint is what makes changing a decision safe to try —
a wrong turn is one click back, not a decision to remember and undo — and the cut keeps the thread one
line of what led to the build, rather than every branch tried and abandoned, which is what a record of
a graph needs. *What would reverse it:* restoring never used — every person going forward by changing
decisions again — then checkpoints go, and the last preview is the one built. Or people who restore
and then want back what the cut removed — then a restore keeps the messages after it, collapsed under
the checkpoint, instead of removing them.

### Building closes the conversation

**Built 2026-10-14**, except what the checkpoint gives. **Build the graph** adds the person's message,
then its steps, then *Your graph is ready* in a tinted panel with **Ask your data**, **Open the graph**
and the person's questions as links to Discover. The graph is named after the connections its files were
read through (*Nobel laureates*), since the conversation has no other name to give it. The composer is
replaced by *This conversation built <graph> and stays as it was built · Start a new one from here*,
which opens a new assistant, clean — *from the current checkpoint* waits on the checkpoints, and until
then a new conversation does not carry this one's. A conversation reopened after its build is the old
rule still: it carries on in a new conversation under a note at its top, because the close is drawn
only in the visit that built it and the graph's name is not read back. The build's step says *Built the
graph from every row* and no count: the run does not return one, and node and edge counts wait for it. This is the storage rule already — a conversation a graph was
built from is that graph's record ([below](#the-conversation-is-kept)) — now said in the UI where it
applies, instead of as a note above the first message when a built one is opened and a save that
quietly forked. *What would reverse it:* people who build and then keep refining in the same place,
for whom the new conversation reads as a wall — then a build is a checkpoint marked built and the
conversation stays open, and a graph's record is that checkpoint rather than the conversation.

### What is kanzo-ui's, and what is keasy's

**From kanzo-ui** (a kanzo-ui PR adds them): `Checkpoint` in `@kanzo-tech/ai`, with its restore action;
a slot above `PromptInput`'s field, for the pills; and checkable items in `@kanzo-tech/ui`'s `Menu`
(Ark's checkbox items), for the files in a pill's menu. `Tool` is there already.

**keasy's**: the pills and their menus, over the connections' listings; the order of the messages
(`converse`, now an append-only thread); closing the conversation on build; the Tasks' runs as `Tool`
parts; and the checkpoints — what each holds, and what restoring one sets back, cuts and runs.

Why a conversation rather than screens: it is **one presentation with Ask**, which is where the person
goes next, so the hand-off is the same surface continuing; **the transcript keeps what was decided**,
in order, where a wizard's earlier screens are out of sight once passed; and it is still **bounded by
the Tasks** — the small model fills `requirements`, `model` and `mapping` under their schemas and the
oracles check them, and each turn is a Task's output or the person's pick from it. Nothing the person
types is an instruction to the model.

Shapes, mapping and program are generated and verified in the background (`requirements`, `model`,
`mapping`, then `emit`, as one `defineFlow`). **Open in the editor**, on the step that writes the
program, keeps ShEx and the Fossil editor under the same checks.

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
whose profile takes too long for the reading step; then the step reads `depth: "types"` first and
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
- **What it fills**: the program — prelude and mappings — which **Open in the editor**, on its step,
  opens. The chat never shows Fossil. It runs once the person has asked all they wanted: the page has one model, and the
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

**What left for the libraries, and what did not** (2026-10-15, with kanzo-ui 0.47 and fossil's GraphAr
graph; [cleanup](cleanup.md)). Three of the Tasks' pieces re-derived what a library knows:

- **`words`** (`tasks/words.ts`) — `spoken`, the identifier split into words, is gone: it is
  `@kanzo-tech/mosaic`'s `splitWords` (it keeps an acronym's case, `ID`, where `spoken` lowered it),
  the one split that `RelationPicker`, Ask's chips and a column's label read. A type's or an edge's words
  in the page's language are `typeWords` and `edgeWords`, which Discover gets with no code of keasy's:
  the graph is described by its mapping (`withMapping`, [the graph](graph.md#the-mapping-describes-the-graph-after-its-first-paint)).
  **What stays** is what no library offers: `plural`, `singular` and `withArticle`, an English
  heuristic for the assistant's own sentences (*One: an award has institutions*), and `pascal` and
  `camel`, which make the identifiers the `model` Task proposes. *What would reverse it:* the
  sentences rewritten so they need no plural — titles that avoid plurals (*Award count by university*),
  as this section said before — which also lets `plural`, `singular` and `withArticle` go, and the
  file with them.
- **`requirements`** (`tasks/requirements.ts`) — its oracle is `JoinResolver`, Ask's own, over a
  `JoinGraph` that `joinGraphOf` writes from the accepted model. It **stays**: the questions are
  offered before any program has run, so there is no attached graph to read a `JoinGraph` from, and
  kanzo-ui's one constructor of one (`readJoinGraph`) reads an attached GraphAr graph and nothing
  else. It is data in the library's shape, not a second resolver. *What would reverse it:* kanzo-ui
  exporting a constructor of a `JoinGraph` from a declared model — then `joinGraphOf` is that call;
  or the questions waiting for the preview, and Ask offering them over it.
- **`profile`'s facts** — `profiledOf` is the one transform of fossil's `profile()` answer into the
  shape the Tasks read, and nothing else reads the profile twice: the studio's checker describes at
  `depth: "types"` (`use-source-descriptors.ts`), which is a different question. The
  `Primitive` → DuckDB table in `requirements.ts` is the one fact still written here that fossil's
  catalogue states; it goes when `@fossil-lang/types` exports the table.

**Failure is said, not swallowed.** A Task that throws, or whose oracles still refuse after its
attempts, fails its step with its problem (`llm/failed` when it has no code of its own) and **Retry**
on it; nothing downstream runs on a refused artefact.

## The preview is in the chat

**Built 2026-10-13.** Once there is a program, it runs over the first 200 rows
of each source **into memory** — fossil's `run(program, { host, into: "memory", limit: 200 })`, in
fossil's run worker, which answers the corpus's files as bytes and writes nothing — and the files are
attached to the assistant page's engine from those bytes (`attachFiles`, `lib/fossil/attach.ts`): the
buffers are registered under a prefix of their own, `@kanzo-tech/graphar-duckdb`'s `attachGraph` reads
the GraphAr graph from them, and detaching gives them back — the same graph a build writes, read the
same way ([the graph](graph.md)). *What would reverse it:* fossil or `graphar-duckdb` offering the
in-memory form themselves — then keasy's registration of the buffers goes, as `@fossil-lang/corpus`'s
`attach({ files })` once promised it would. `usePreview(program, profiled)`
(`lib/fossil/preview.ts`) is the hook: `idle`, `running` — the last corpus kept on screen —, `ready`
or `failed`, each corpus named by its program and cached as a graph's is, so a decision changed is a
preview of its own and the one it replaces is given back once nothing reads it. Inside `CorpusScope`
over it, `useCorpusAsk()` (`lib/fossil/ask.ts`) is Ask as Discover's panel runs it, and the person's
questions are answered in the chat with `AnswerCard`s over the sample. One door to fossil's executor,
`lib/fossil/executor.ts`, maps `{ job }` and `"memory"` onto `run`'s `into`.

**How the thread reads it** (`assistant-flow.tsx`, `preview-turn.tsx`). The preview runs the `mapping`
Task's program and nothing before it: *Write the program* is the step it waits on, then *Run the
preview*. A decision changed is a model accepted again, so the mapping writes the program again, and
its run is a new checkpoint and a new preview message at the end; the one before stays where it was,
answering what its program answered. Today's preview turn is one message that changes in place — the
last answers dimmed and inert under *Updating…* until the new corpus replaces them — and that goes with
the thread ([each result is a new message](#each-result-is-a-new-message-at-the-end)). Each kept question is sent to `useCorpusAsk()`'s chat in turn — one at a time, as a chat
answers, and only once the model is ready — and drawn as Ask's panel draws it, an `AnswerCard` with
its `AskChips`. There is no composer under them: a tie Ask asks back is answered in Discover, over the
whole graph. A failed run is said with its problem and a retry (`rerun`).

**The whole graph is built once, when the person asks** — *Build the graph*: `useBuild(program,
profiled, { conversation })` (`graphs/new/_parts/use-build.ts`) makes it as the studio does, a draft
submitted and run under its job (`into: { job }`), and `lib/fossil/build.ts` is the machine its step
reads, `building` → `done` or `failed`. A build outlives the assistant's page; the last message's links
carry the person's question to Discover as `?q=`, and Ask sends it once the model is ready and takes it
off the URL as it does, so nothing asks it twice.

**Why in the chat, and not in Discover.** The preview is where the decisions are judged: the person
sees answers over their own rows next to the question that shaped them, changes a decision and sees
the answer change, before anything is written — 200 rows in memory cost seconds, so running it again
is cheap where building the graph again is not. And Discover only ever shows a whole graph, the
graph's own output under its id: no second corpus beside it to switch from, nothing that is not what
the graph holds.

**Build the graph** builds the current checkpoint's program, and saves the conversation first and
builds under the id that save answers, so a graph always names the conversation as it stood when it
was asked for. Its step reads `building` (with its percent once the run reports one), `failed` with
its problem and **Retry**, and `done`, after which *Your graph is ready* carries **Ask your data**,
**Open the graph** and a link per question, `askHref(graphId, question)`. Nothing is changed after a
build in the conversation it closed: a decision changed is a new conversation started from the
checkpoint, and building there makes a new graph. The earlier shape — the preview built with the graph and opened in Discover under
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
assumed), so Discover's *What I decided* reads them from the graph's conversation and shows them, with
a link to the conversation. **Discover changes nothing**: it has no *Change*. A decision is changed
from the conversation — opened, closed by its build, and *Start a new one from here* from its
checkpoint — so there is one door to a decision, the thread it was taken in, and no second route
(`?decision=`) that opens the assistant at one. *What would reverse it:* people who look for the
decision in Discover and give up before finding the conversation — then *What I decided* links each
decision to its message in the conversation, still read-only. `useAssistantConversation(id?)`
(`lib/assistant-conversation.ts`) is the web's side: `{ id, messages, save, decisions }`, over
`@kanzo-tech/ai`'s `useKeptChat`.

**One message per turn** (`conversation.ts`'s `messagesOf`; checkpoints below are decided, not built, and
a preview is one message until they are): each carries a `data-turn` with its
kind, and its id is the kind and what it is about (`decide:<decision>`, `asked:<question>`,
`preview:<checkpoint>`), so a save of a message already there replaces it and a new result adds one.
The person's messages are `user` messages (`sent`, `decided`, `asked`, `asked-all`, `build-reply`): the
first carries `data-files` and `data-about` together, as the composer sends them, and the steps are
not kept — they are said again from what the conversation knows; `data-decision` on a decision answered (`option: null` while it is asked;
the last word on each wins), and `data-question` per question kept. Each preview message carries its
checkpoint, `data-checkpoint`: the program it ran and the option each decision stood at; the last is
the current one, since restoring cuts what came after it. `restore` reads the same parts back, and the thread starts where it stood: the
files read again without listing their folders (a file whose connection is gone is said, as a problem
of the reading step), the current checkpoint's choices taken again, an assumption left to its default,
the questions kept, and its program previewed until the mapping writes it again. The `model` Task is
asked again, from the profile, so a decision is raised again by its id. *What would reverse it:* a
model that raises other
decisions on the same files when asked again — then the accepted `model` artefact is kept too, as
structure, and reopening skips the Task.

**Saved whole after each reply, not appended.** The array is small — structure only, below — and
whole is what the AI SDK hands back on finish; the thread grows at its end, but a decision's last word
changes a message already saved and a restore removes every message after its checkpoint, which an
append cannot say; and a
save sent twice, or retried after a timeout, is one save. *What
would reverse it:* conversations long enough that a reply's save is felt — then messages get rows of
their own, as the chatbot template's do, and a save sends what changed.

Saving starts at the person's first reply on the page — a conversation opened and only read is not
saved again — and waits while the files are read or the `model` Task answers, when the messages after
them are not said yet and a save would drop them. The id saved under goes on the URL
(`?conversation=`), so a reload resumes it.

**A conversation a graph was built from is that graph's record**, as a submitted graph's script is
(`graph/not-draft`): a save over it is refused (`conversation/built`). The thread says so where it
applies: building closes it, and its composer gives way to *This conversation built <graph> and stays
as it was built · Start a new one from here* — a new conversation from the current checkpoint, so a
change rebuilds as a new graph with a conversation of its own, and the first graph still lists what it
was built with. The note above the first message of a built conversation, and the save that quietly
carried on in a new one, go with it.

**What is stored, and what is not.** The premise is that the person's data never leaves the browser,
and a saved conversation is no exception. Stored: the messages' kinds and ids, the options offered in
keasy's words, the person's choices, what they typed — their questions and the *what is it about?*
sentence —, the files they picked as locations (connection and path), and each checkpoint's program
and choices. Not stored:
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
of its own and edits `app-config.json` to name it (`infra/prod/README.md`); and Hugging Face's terms,
once read, forbidding this use.

**The download starts with intent** — when a graph opens, or the assistant — not when
Ask's panel does: `usePreloadModel` calls `loadLocalModel` once per page, in the background, and the
page works without the model meanwhile. How it stands is `@kanzo-tech/llm/local`'s `localModelLoad`,
drawn as kanzo-ui 0.45's `ModelBadge` (`ModelStatus`) in Ask's composer and the page's header over the
assistant —
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

The thread is built (2026-10-14) on kanzo-ui 0.46's slot above `PromptInput`'s field and checkable
`Menu` items; what is left of it is the append-only thread with `Checkpoint` and its restore, the build's
counts, a composer under the preview, and Discover without *Change*. The `nobel-assistant` demo (`e2e/demos/nobel-assistant.demo.ts`) keeps what it
has — its subtitles at the top, and the model double answering at a model's pace — and is rewritten to
the thread's flow with it: the files picked on *@Nobel laureates*' pill and sent with *what is it
about?*, the steps, each result below the last, a decision changed and a checkpoint restored, and the
build closing the conversation.
