# keasy on its libraries, and what it stops carrying

Status: a direction (2026-10-13). Nothing here is built. It is keasy's side of the cross-cutting
review of kanzo-ui, fossil and keasy, whose decisions are final, and of the keasy audit at
`1a05285` (PR #154). Line figures are estimates from that code, net of what replaces them, and are
measured again when each step lands.

Each decision is written on the page that owns it, and this page is the order they land in and the
ones no other page owns. Where a decision lives elsewhere, the row links to it.

## Order

Each step ships alone and leaves keasy smaller than before. A step marked ⇧ waits for a library
release, and keasy deletes in the same change that bumps the version.

| Step | What | Lines | Waits on |
|---|---|---|---|
| 0 | **No schema migrations**: a database of another schema is dropped and created again ([permissions](permissions.md#the-schema)) | — | done in #154 |
| 1 | **Decisions that only delete**: grants, sharing and transfer ([permissions](permissions.md#sharing-waits-for-its-dialog)); the schema diagram ([below](#the-schema-diagram-goes)) | ~1,125, 2 web deps | #154 merged, so the `grants` table goes without a migration |
| 2 | **Dead code, stale configuration, unused dependencies** ([below](#dead-code-and-configuration)) | ~240, 1–2 crates, 3 web deps | nothing |
| 3 | **Guards to lint rules** ([below](#guards-become-lint-rules)) | ~130 | nothing |
| 4 | **The web's own duplicates onto TanStack** ([below](#one-way-to-read-and-write-tanstack)) | ~360 | nothing |
| 5 | **Facts in place of guesses**: formatting, error titles, names, formats ([below](#facts-in-place-of-guesses)) | ~170 | nothing |
| 6 | **e2e** ([below](#e2e)) | ~65 | nothing |
| 7 | ⇧ **The Ask evaluation set to kanzo-ui** ([assistant](assistant.md#order)) | ~560 moved | kanzo-ui taking the set |
| 8 | ⇧ **kanzo-ui**: `Structure`, one model double, the conversation's keeping, library hooks on keasy's `QueryClient` ([below](#what-the-libraries-take)) | ~480 | a kanzo-ui release |
| 9 | ⇧ **fossil**: `run` in its own worker, `attach({ files })` | ~435 | a fossil alpha |
| 10 | ⇧ **kanzo-ui and fossil together**: the `requirements`, `words` and `profile` Tasks' guesses ([assistant](assistant.md#the-three-tasks)) | ~415 | kanzo-ui's paths design (wave 3) and fossil's annotations and corpus facts (wave 4) |
| 11 | ⇧ **Azure SAS to the Azure SDK** ([below](#azure-sas-is-signed-by-the-azure-sdk)) | ~90 now, ~200 in all | the SDK's SAS builder for the rest |

About **4,200 lines** in all, ~560 of them moved rather than deleted, of keasy's ~41.6k, and 5 web dependencies and 3–5 Rust crates. Steps
1–6 are keasy's alone and can start today; 2–6 change no behaviour a person sees, except the words
of a few errors and breadcrumbs, which become the right ones.

## What the libraries take

Each goes from keasy once its library releases it; until then keasy's copy stays and is not
improved.

| What keasy carries | Where | Goes to | Lines | Owned on |
|---|---|---|---|---|
| The run worker: protocol, `Host` over a port, abort, errors across `structuredClone` | `lib/fossil/run-worker.ts`, `run.worker.ts`, test | fossil: `run` runs in a worker of its own | ~310 | [assistant](assistant.md#the-executor-leaves-the-pages-main-thread) |
| An in-memory corpus attached through buffers under a prefix | `lib/fossil/memory-corpus.ts`, test | `@fossil-lang/corpus`'s `attach({ files })` | ~125 | [assistant](assistant.md#the-preview-is-in-the-chat) |
| The corpus's structure read three ways: raw SQL over `fossil_tables` and `fossil_columns` in `overview.tsx`, `useGraphKey`, `readJoinGraph` | `graphs/[id]/_parts/overview.tsx`, `lib/fossil/corpus.tsx` | `@kanzo-tech/graph`'s `Structure`, exported, read once per corpus | ~60 | here |
| Three model doubles | `e2e/support/model.ts`, `lib/ai.ts` + `model-double.test.ts`, `nobel.fixture.ts` | one in `@kanzo-tech/llm`, through `__KANZO_TESTING__` | ~180 | [assistant](assistant.md#what-left-keasys-configuration) |
| The conversation's keeping: whole saves after each reply, one at a time, the sealed record carried on in a new id | `lib/assistant-conversation.ts`, its hook test | `@kanzo-tech/ai`, on the AI SDK's `UIMessage[]` per id and `validateUIMessages`; keasy gives `load`/`save` against `/v1/conversations` and the privacy `keep` | ~200 | [assistant](assistant.md#the-conversation-is-kept) |
| `requirements`, `words`, and the guessed half of `profile` and `model` | `graphs/new/_parts/assistant/tasks/` | `JoinResolver` and Ask's paths; labels from annotations with `Intl`; the corpus's facts on `JoinGraph` | ~415 | [assistant](assistant.md#the-three-tasks) |
| The model's load as a store of keasy's | — | already `@kanzo-tech/llm/local`'s `localModelLoad`, drawn as `ModelBadge` | 0 (gone) | [assistant](assistant.md#what-left-keasys-configuration) |
| Library reads wrapped in keasy's own `useQuery` | `use-assistant.ts`, `use-source-descriptors.ts`, `overview.tsx`'s `useQueryRows` | the library's own hook, using TanStack Query inside on keasy's `QueryClient` from `QueryClientProvider` (a peer dependency) | ~40 | here |

**`Structure` is read once.** `@kanzo-tech/graph` already reads a corpus into `Structure` — its key,
its vertices with rows and columns, its edges with their ends and rows — and does not export it.
Once it does, the overview's types-and-edges tables, the graph key and Ask's `JoinGraph` are one
cached read of it, and keasy holds no SQL over fossil's catalogue views. *What would reverse it:*
something the overview shows that `Structure` does not carry — then it goes into `Structure`, not
back into a query here.

**The library hooks share keasy's `QueryClient`** (the review's decision on TanStack Query). Each
kanzo-ui hook that reads — a field's statistics, Ask's reads, the session — uses TanStack Query
inside, on the `QueryClient` its host provides through `QueryClientProvider`, and
`@tanstack/react-query` is a peer of the packages that read. There is no `queryOptions` surface to
call. keasy already provides `QueryClientProvider` in `providers.tsx`, so it adds nothing: the
library's reads land in keasy's cache, show in its devtools, and are cleared with it. keasy's own
reads keep using that same client as below — the query key factory, the `MutationCache` meta and the
mutation scope stay keasy's. What goes is keasy's `useQuery` wrapped around a library read that will
cache itself (`use-assistant.ts`'s reads of profile and Tasks once they are library hooks,
`use-source-descriptors.ts`), and with it the `useQuery` exceptions the failure guard names. *What
would reverse it:* a library read whose lifetime is not a query's — a stream, a model's load — which
stays a hook of the library's with no cache in Query; or a host without `QueryClientProvider`, which
the libraries then say they need rather than make a client of their own.

## The schema diagram goes

**Decided 2026-10-13: the schema diagram is removed, and with it `@xyflow/react` and `elkjs`.** It
draws the types and edges that the Vertices and Edges tables right under it list, on a graph stack
of its own: a layered ELK layout and a label width guessed from `text.length * 6.5`. keasy already
has one view layer for graphs, `@kanzo-tech/graph`, and two heavy dependencies for a picture of two
tables is the wrong trade. Goes: `graphs/[id]/_parts/schema-diagram.tsx` (128), `schema-layout.ts`
(75), its test (24), its slot in the overview, and the two dependencies — ~225 lines. *What would
reverse it:* people who need the shape at a glance and do not get it from the tables, schemas too
large to read as two lists — and then it is drawn with `@kanzo-tech/graph`'s canvas over the same
`Structure`, never a second graph stack.

## Azure SAS is signed by the Azure SDK

**Decided 2026-10-13: Azure credentials are vended through the Azure SDK for Rust, not signed by
hand.** `storage_client/vend.rs` (~250 lines of it) gets an Entra token, asks for a user-delegation
key, and writes the string-to-sign and its HMAC itself, for a directory SAS (`sr=d`, `sdd`) or an
account-key service SAS. It is credential code, written once and read by nobody since, and the only
reason for `hmac`, `sha2`, `quick-xml` and `chrono`. By reference:

- **The token**: `azure_identity`'s `ClientSecretCredential`, scope `https://storage.azure.com/.default`
  — in place of `entra_token`.
- **The key**: `azure_storage_blob` (1.1)'s `BlobServiceClient::get_user_delegation_key` — in place of
  `user_delegation_key` and its XML, so `quick-xml` goes.
- **The signature**: the maintained `azure_storage_blob` 1.1 has **no SAS builder**. The retired
  `azure_storage` 0.21 has one — `shared_access_signature::service_sas::BlobSharedAccessSignature`,
  with `BlobSignedResource::Directory`, `signed_directory_depth` and a `SasKey::UserDelegationKey` —
  but it is the SDK keasy would be leaving, pins `azure_core` 0.21 beside 1.x, and brings the `time`
  crate as a third clock. So the string-to-sign (`user_delegation_sas`, `service_sas`, ~60 lines with
  `hmac` and `sha2`) stays keasy's until `azure_storage_blob` ships SAS generation, and then goes.

Its timestamps move from `chrono` to `jiff` either way, so the server has one time crate. The tests
at the end of `vend.rs` stay — the SAS names the directory it opens and never `skoid` on a service
SAS; a silent Entra or blob endpoint is named `silent` within keasy's deadline — and the SDK's client
options (retries, timeouts) are set so they keep passing. ~90 lines now, ~200 once the signer moves.
*What would reverse it:* an SDK that cannot be held to keasy's deadline, or whose dependency tree
costs the server image more than the lines it saves — then the hand-written path stays, its HMAC
tested against Microsoft's published examples.

## Dead code and configuration

Removed outright; a dev stack that needs it says `make clean` once in the release note.

| What | Where | Lines |
|---|---|---|
| `NEXT_PUBLIC_KEASY_DEMO`, which nothing sets since the recorder hides the dev furniture itself | `compose.override.yaml`, `next.config.ts`, `providers.tsx`, the `Makefile` comment | ~18 |
| `KEASY_ORG_ADMIN_URL`, set in no environment, so the Members page always says *Ask your platform administrator* | `settings/(admin)/members/page.tsx` | ~12 |
| `KEASY_OIDC_AUDIENCE` and `KEASY_BIND_ADDR`, read with defaults and set by no deployment | `server/src/configuration.rs` | ~10 |
| `realm-migrate`, the shim for dev stacks provisioned before keasy declared itself in `compose.yaml` | `infra/dev/platform.yaml`, `realm-migrate.test.sh`, `infra-ci.yml` | ~90 |
| README: the *stack seeded before the examples moved* paragraph, `infra/dev/roles.yaml` (gone; the roles are `configs.keasy-roles`); `make seed`'s help without CORDIS; `.env.example`'s `KANZO_UI_REF=v0.44.0` | `README.md`, `Makefile`, `.env.example` | ~10 |
| `STORYBOARD.md`'s page objects (all built), another repo's to-do, and a settled question | `e2e/demos/STORYBOARD.md` | ~55 |
| `/graphs/[id]/recipe`, a route with no page; `selectColumn` on two list pages with no bulk action; `build`'s `percent`, which nothing feeds | `route-config.ts`, list pages, `lib/fossil/build.ts` | ~15 |
| `demo({ skip })`, which no demo passes, and the README's word for it | `demos/record/recorder.ts`, `README.md` | ~10 |
| `test.fixme("26 …")`, kept only for `coverage.spec.ts`: scenario 26 maps to `server/tests/api/failures.rs`; the history in `scenarios.ts` rewritten as what 11–15 force today | `e2e/tests/api.spec.ts`, `support/stack/scenarios.ts` | ~15 |
| `export` on thirteen names used only in their own file (`irisOf`, `inclusionId`, `backing`, `thingsOf`, `decisionItems`, `roleOf`, `sinkBase`, `sourceDescriptorsKey`, `serverSilent`, `getBranding`, `useAnswerRelations`, `GRAPH_POLL_MS`, `DEADLINE_MS`) | `web/src` | 0 |
| **Dependencies**: web `openapi-fetch` (only `@keasy/api` uses it), `streamdown` (`@kanzo-tech/ai`'s dependency, not a peer), `@fossil-lang/storage` (the executor's); server `tokio-stream` (no use), `chrono` beside `jiff` (with the Azure step) | `web/package.json`, `server/Cargo.toml` | 5 |

*What would reverse it:* for each variable, a deployment that sets it — then it is set in
`compose*.yaml` and `prod.env` and documented in the README, not left as a default nobody turns. For
`KEASY_ORG_ADMIN_URL`, a way to name the organization's console without a template: if `@kanzo-tech/auth`
carries the console URL, the Members page links it. For the dependencies, an import of them.

## Guards become lint rules

`web/src/failure-guards.test.ts` (131) and `server/src/guards.rs` (61) are regex scanners over the
source for rules ESLint and Clippy state exactly, with the per-site reason as the tools' own
suppression comment:

| Guard | Rule |
|---|---|
| no empty `catch` without a reason | ESLint `no-empty` — a block holding a comment is not empty, which is the guard's rule as written |
| no `??=` memo of a call's result | ESLint `no-restricted-syntax`, `AssignmentExpression[operator='??=']`, with the message saying `fetchQuery` |
| fetch only through the deadline helper | ESLint `no-restricted-globals` for `fetch`, off in the helper's own file |
| read with `useSuspenseQuery` but for named exceptions | ESLint `no-restricted-imports`, `importNames: ["useQuery"]` from `@tanstack/react-query`; an exception is `// eslint-disable-next-line … -- <reason>` at the site |
| `let _ = … .await` without a reason | Clippy `let_underscore_must_use` and `let_underscore_future` in `[lints.clippy]`, and `#[expect(clippy::let_underscore_must_use, reason = "…")]` at the site; `unused_result_ok` also catches the `.ok();` the guard says it cannot |

The error-boundary-per-route-group check stays a test: no lint rule reads the file tree. The
`notFound()` guard and the exception naming `use-folder-availability.ts` guard nothing any more and
go. ~130 lines. ESLint already runs in `web-ci.yml` and Clippy with `-D warnings` in `server-ci.yml`,
so the rules are enforced where the tests were. *What would reverse it:* a rule a linter cannot
state — one that reads two files at once, as the boundary check does — which stays a test, with what
it cannot prove.

## One way to read and write: TanStack

Each is TanStack Query's own pattern, already a dependency.

- **One list page.** Connections, credentials and graphs (`page.tsx`, 220, 203 and 191 lines) are the
  same skeleton — section, boundary, `useSuspenseQuery`, `useDataTable`, empty state or table with
  toolbar, search, *Create*, pagination and a row menu. One keasy `ResourceList<T>({ query, columns,
  empty, create, href, search })`, and each page keeps its columns. ~150. *What would reverse it:* a
  list that needs a bulk action or server pagination the others do not — then it composes the parts
  and leaves the skeleton.
- **Mutation feedback in one place.** 25 call sites write `onSuccess: toast + invalidate` and
  `onError: toastError(…, "Failed to …")`. A `MutationCache({ onSuccess, onError })` in
  `lib/api/query-client.ts` reads `mutation.meta` — `{ success, failure, invalidates }` — and the sites
  pass `meta`. ~80. Do it before the list page. *What would reverse it:* a mutation whose outcome is
  drawn in place, not toasted — it passes no `meta` and handles itself.
- **A query key factory.** Keys written by hand (`["get", "/v1/connections", {}]` in `lib/fossil/host.ts`
  and `use-build.ts`; `conversationQuery` copying openapi-react-query's key) and raw `useMutation` +
  `http.*` in four files become `$api.queryOptions("get", path, init)` — one `connectionsQuery`
  shared by its readers — and `$api.useMutation` everywhere. The three promise memos that forget
  failure (`graphProgram`, `rudof()`, `getBranding`) become `fetchQuery` with `staleTime: Infinity`.
  ~60. *What would reverse it:* a read openapi-react-query cannot type.
- **The save queue is a mutation scope.** `lib/assistant-conversation.ts` chains promises in a ref
  to serialise saves; `useMutation({ scope: { id } })` does exactly that, as `dashboard-store.tsx`
  already uses it. The two module stores that outlive a page (`lib/fossil/build.ts`,
  `use-browser-graph-runner.ts`) become `useMutation({ mutationKey })` read with `useMutationState`.
  ~70. If the conversation's keeping moves to `@kanzo-tech/ai` first, its queue goes with it. *What
  would reverse it:* a write that must merge with the one before it rather than wait for it.

## Facts in place of guesses

- **Formatting is kanzo-ui's and the browser's.** `lib/ui/format.ts`, `useSecondsSince`'s *seen N s
  ago*, a byte formatter built on `Intl.NumberFormat("en")` and a regex, `toLocaleString()` with no
  locale beside `"en"` and `"en-GB"`, and five pluralisers become `@kanzo-tech/ui`'s
  `FormatRelativeTime`, `FormatByte` and `FormatNumber` under one `LocaleProvider` in
  `providers.tsx`, and `Intl.PluralRules`. ~85. *What would reverse it:* a format Ark's components
  do not offer — then `Intl` directly, still under the page's locale.
- **Error titles come from the server.** keasy's words for its own failures live in
  `server/src/error.rs`'s `title()`; `lib/errors.ts` re-titles the server's codes (`probe/failed`,
  `resource/in-use`, `secret/not-found`, `graph/*`, `rbac/*`, `store/*`, `server/silent`), and
  `graph/interrupted` is worded three times. The web registry keeps only codes the server does not
  own — fossil's, kanzo-ui's, the browser's — and `markInterrupted` sends `{ code }` and the server
  fills the title. ~30. *What would reverse it:* a server code whose title the web must say
  differently for where it is shown — then the difference is a `detail`, not a second title.
- **Names come from the API, not title-casing.** Breadcrumbs title-case URL segments
  (`route-config.ts`), so `/connections/{name}` reads its slug capitalised; the workspace name is
  `titleCase(slug)`; credential field labels are property names with `_` replaced; a graph falls back
  to `id.slice(0, 8)`. They become the resource's own `name` (as graphs' crumbs already resolve
  theirs), the organization's name (`@kanzo-tech/auth`'s `Organization` gains `name`; until then
  `branding.name`), `#[schema(title = "…")]` on each credential field, and a `name` the server
  requires. ~40. *What would reverse it:* a resource with no name of its own — then the route table
  names it, never a transform of the URL.
- **Formats are fossil's.** `connections/new/page.tsx` hard-codes *CSV, Parquet, JSON* and *ShEx,
  SHACL, RDF* while the connection page reads fossil's `formats()`; the source picker picks an icon
  from the extension while each file carries its `reader`. Both read `formats()` (`formatsQuery`).
  `bindingName` re-derives `grammar.bnf`'s `IDENT`, and goes once `@fossil-lang/wasm` exports the
  identifier rule beside `formats`. ~15. *What would reverse it:* nothing keasy can see — the formats
  and the grammar are fossil's to say.

## e2e

- **A typed API client.** `support/stack/api.ts`'s `api(page, method, path, body)` — `fetch` in
  `page.evaluate`, every path a string, every body `unknown`, ~40 call sites casting `.body as {…}` —
  becomes `@keasy/api`'s `createApiClient({ baseUrl, fetch: (r) => page.request.fetch(r) })`, which
  shares the context's cookies and goes through the BFF as now. Requests malformed on purpose
  (scenario 23) keep a raw call. ~30.
- **`page.clock` for windows of time.** `graphs.spec.ts`'s 7 s and 3 s waits assert that nothing
  happens over a window; `page.clock.install()` and `fastForward()` assert the same in milliseconds,
  and so do the poll's and the autosave's timers. ~10.
- **One smoke fixture.** `geoGraph`, `snbGraph`, `cordisGraph` and `nobelGraph` differ by name and
  budget: one `seeded(example)` worker fixture keyed by `EXAMPLES`, and `s3-init`'s four seed blocks
  one `for ex in /examples/*/` loop, as the README already says an example is one folder. ~25.

*What would reverse it:* a call the typed client cannot express — a body that must be wrong on
purpose — which stays a raw call, and only that one.

## Not decided here

The audit found more that no decision above covers yet: hand-rolled empty states (`forbidden.tsx`,
`not-found.tsx`), the branding-to-theme adapter that belongs in `@kanzo-tech/theme`, two TanStack
forms' shared scaffolding (`createFormHook`), two delete confirmations, the tenant host built twice,
Discover's URL written twice in e2e, page objects re-exposing library harnesses, the 117 KB
`openapi.json` bundled for two string rules, and `CLOUDS` hard-coding what the contract could
publish. Each is small; each gets its line here when it is decided.
