# The assistant, and time to smile

Status: a direction, not built. The pattern this rests on — a *Task*: a small model in the browser
fills a small artefact under a JSON Schema, a deterministic oracle checks it, a bounded loop repairs
it or asks the person — and its API, its model and its decisions are kanzo-ui's, on
[Tasks](https://kanzo-tech.github.io/ui/docs/design/tasks). fossil's half — `fossil-profile` in place
of introspect, and a mapping spec from which Fossil is emitted — is on
[Profile, and the mapping a model proposes](https://kanzo-tech.github.io/fossil-lang/docs/design/profile).
This page is keasy's part: the assistant's screens, the metric they are built for, and what changes
in keasy's own configuration and runtime.

## The problem

The new-graph wizard (`graphs/new/_parts/assistant-wizard.tsx`, 528 lines) asks one call,
`writeProgram`, for a whole program, with `FOSSIL_PROMPT`. The model does not see the `.shex`; it
guesses keys and edges; the studio's checker reports after the fact, and nothing repairs. "Done"
means "it compiles". And every call goes through the BFF's `/api/ai` forward to the gateway, so the
question leaves the browser and the AI is down whenever the gateway is.

## Time to smile

**The metric is the time from the first file connected to the first answer of Ask in Discover.** The
smile is on the first answer about one's own data, not on "graph created". Design targets, not
measurements: the profile in about 5 s, *What I understood* in about 20 s, the first answer under
60 s; the full graph builds in the background, and the model download is preloaded when the
assistant opens.

It is measured in three places, and nothing leaves the browser for any of them: in CI, where
Playwright times the whole path over the four examples (median and p90 per version); in user tests,
where the tester exports their local journal by hand; and in the app, which can show it to whoever
uses it.

## Three screens instead of five

The person using the assistant knows their data, not RDF or ShEx. ShEx is still how the ontology is
made operational, but it sits underneath, as SQL sits under a tile.

1. **Your data.** Pick files from a connection. *What is it about?* is optional, with ghost-text
   suggestions; *What would you like to know?* offers questions already answerable from these files.
2. **What I understood.** The things in the data with real counts and real example rows — *each
   award has a laureate, a category and a year; e.g. Marie Curie · Physics · 1903* — never shape,
   IRI, predicate or cardinality. Rename, remove, add. A question only when there is no safe default.
3. **Explore.** Discover over a 200-row preview while the full graph builds, with the assumptions
   taken listed and changeable.

Shapes, mapping and program are generated and verified in the background (`requirements`, `model`,
`mapping`, then `emit`, as one `defineFlow`). **Advanced**, one click away, keeps ShEx and the Fossil
editor under the same checks.

**Competency questions are Ask's questions.** "Done" is each selected question answered by Ask over
the sample graph, seen in Discover, not a technical checklist. Their queries are generated against
the shapes, not the mapping, and the person confirms them before they are frozen as tests, so the
test and the code do not come from the same source.

**Assumptions instead of blocks.** A decision with a safe default — *when two people share a Nobel,
is it one award or two?* — is taken, recorded as an assumption, and changed later from Discover.
Only what has no safe answer blocks.

**What would reverse it:** time to smile measured worse with three screens than with five on the
four examples, or people changing most assumptions after the fact — then the decisions go back into
the flow, in front of the preview.

## What leaves keasy's configuration

| Today | After |
| --- | --- |
| `ai-gateway`, `ai-postgres` and, locally, `ai-models` with Docker Model Runner | none |
| `KEASY_AI_URL`, `KEASY_AI_CHAT_CONTEXT`, `KEASY_AI_COMPLETE_CONTEXT`, `AI_CHAT`, `AI_COMPLETE`, `AI_DB_PASSWORD` | `KEASY_MODEL_URL`: where the model's shards are served |
| the BFF's `/api/ai` forward, with its token exchange for the `ai-gateway` audience | nothing to forward |
| context windows that must match the deployed model | the window travels with the model |
| `make demo` switches the gateway to Qwen3 and back | the demo uses everyone's model |

The model is downloaded the first time it is needed — the assistant or Ask's panel — in the
background with progress, preloaded when a graph or the wizard opens, kept in Cache Storage or OPFS
behind `navigator.storage.persist()`, and versioned: the old one serves until the new one is whole.

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
locally:

- The dev web's page was `crossOriginIsolated`, `SharedArrayBuffer` was defined, and none of its own
  requests were blocked.
- From that page, a ranged `fetch` of a presigned `e2e/data/people.csv` on the dev S3 store
  (`s3.localhost:9000`, another origin) answered 206 with `Content-Range` exposed: a CORS read, which
  COEP admits, and the shape of every read the executor and DuckDB-WASM make with a vended credential.
- By reading: the CSP keeps scripts, workers, `.wasm`, images and fonts on this origin; sign-in is a
  redirect to Keycloak with no popup; the two `target="_blank"` links carry `noopener`.

**Not checked**, and owed before the headers ship: sign-in through Keycloak, `runToCompletion` and
Discover over the e2e corpus (`e2e/tests/discover.spec.ts`), and a read from Azure. The sandbox's
network policy denied `registry.terraform.io` (the dev realm) and the image registries the stack
pulls from, and the dev stack has no Azure emulator. The e2e that ships with the headers runs those
three and asserts `crossOriginIsolated`.

## Order

Phase 0 is keasy's first: an evaluation set under `e2e/eval` — Ask's storyboards, and the four
examples (nobel, openflights, snb, cordis) for the assistant — and a baseline of today's system
with three or four small models, the WebLLM provider behind `LanguageModel` among them, measured on
real devices. Phase 1 (Ask as a Task) touches `discover/_parts/ask-panel.tsx`; phase 3 replaces the
wizard with the three screens. The phases are on [Tasks](https://kanzo-tech.github.io/ui/docs/design/tasks#phases).
