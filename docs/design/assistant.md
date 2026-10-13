# The assistant, and time to smile

Status: a direction. Built: the model in the page, in place of the gateway, served from keasy's own
origin and preloaded with intent (2026-10-13), and the guided chat over introspect, with the Tasks'
turns still to fill. The pattern this rests on — a *Task*: a small model in the browser
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
   had a safe default is said, *I assumed …*, with **Change**, and blocks nothing.
5. *What would you like to know?* — questions already answerable from these files as chips, and the
   composer for one's own; each question kept says whether these files can answer it.
6. *Preparing a preview over 200 rows…*, then *your graph is ready to explore*, with **Ask your data** and
   the person's questions as prompts to take there.

**The person's replies are choices, chips or questions — never free-form instructions.** What they pick
is drawn as their message (*These 6 files*, *Two, one per person*), so the transcript reads as what
was decided. Free text goes in only where it is a question, or the optional *what is it about?*; the
composer is off otherwise, and says what the turn above it is waiting for.

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
page works without the model meanwhile. Ask and the assistant show *Preparing the model* with its
progress until it is ready (`ModelStatus`); a question asked meanwhile waits for it. WebLLM keeps it in
Cache Storage, behind `navigator.storage.persist()`. Not yet: versioning — the old one serving until
the new one is whole. *What would reverse it:* people who open graphs and never ask, on metered
connections — then the download waits for the first screen that asks.

**The e2e suite runs on a model double in the page**, because CI's Chromium has no WebGPU:
`e2e/support/model.ts` puts a scripted `LanguageModel` on `window.__keasyModelDouble` before the page
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
waiting for a run; with a preview built while they explore Discover, it would block Discover. The
executor moves to a worker of its own.

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
