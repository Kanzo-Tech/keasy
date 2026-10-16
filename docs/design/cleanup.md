# keasy on its libraries, and what it stops carrying

keasy's side of the cross-cutting review of kanzo-ui, fossil and keasy, whose decisions are final.
Each decision is written on the page that owns it; this page holds the ones no other page owns and
what is still to land. What has landed is the tree, and git holds how.

## Open

A step marked ⇧ waits for a library release, and keasy deletes in the same change that bumps the version.

| What | Waits on |
|---|---|
| ⇧ **The Ask evaluation set to kanzo-ui** ([assistant](assistant.md#order)) | kanzo-ui taking the set |
| ⇧ **kanzo-ui**: `Structure`, the conversation's keeping, library hooks on keasy's `QueryClient` ([below](#what-the-libraries-take)) | a kanzo-ui release |
| **`joinGraphOf`'s tables stay**, described by fossil's mapping; why and what would reverse it on [the assistant page](assistant.md#the-three-tasks) | a `JoinGraph` from a mapping in kanzo-ui, and `@fossil-lang/types` exporting the `Primitive` table |
| **Azure's signer**: keasy's minimal user-delegation SAS signer ([below](#azure-has-one-credential-a-user-delegation-sas-through-the-azure-sdk)) | the Azure SDK's SAS builder |
| **The two module stores** (`lib/fossil/build.ts`, `use-browser-graph-runner.ts`) stay `useSyncExternalStore`: a build's state names its graph before it ends, and a live run holds its Stop and its ending, neither of which a mutation's state carries | nothing; a state a mutation can carry reopens it |
| **Field labels and file icons**: credential field labels are still the property names (utoipa 5 has no `title` on a field, only on a type); the source picker picks an icon by extension (the file's `reader` names a format, not whether it is a table) | utoipa; fossil |
| **e2e**: `page.clock` for windows of time, and one `seeded(example)` fixture | see [e2e](#e2e) |

## What the libraries take

Each goes from keasy once its library releases it; until then keasy's copy stays and is not
improved.

| What keasy carries | Where | Goes to | Owned on |
|---|---|---|---|
| The conversation's keeping: whole saves after each reply, one at a time, the sealed record carried on in a new id | `lib/assistant-conversation.ts`, its hook test | `@kanzo-tech/ai`, on the AI SDK's `UIMessage[]` per id and `validateUIMessages`; keasy gives `load`/`save` against `/v1/conversations` and the privacy `keep` | [assistant](assistant.md#the-conversation-is-kept) |
| `requirements`, and the guessed half of `profile` and `model` | `graphs/new/_parts/assistant/tasks/` | `JoinResolver` and Ask's paths; labels from annotations with `Intl`; the graph's facts on `JoinGraph` | [assistant](assistant.md#the-three-tasks) |
| Library reads wrapped in keasy's own `useQuery` | `use-assistant.ts`, `use-source-descriptors.ts`, `overview.tsx`'s `useQueryRows` | the library's own hook, using TanStack Query inside on keasy's `QueryClient` from `QueryClientProvider` (a peer dependency) | here |

**The catalogue is read once.** `@kanzo-tech/graph` reads a graph's catalogue (`graphar_vertex_types`,
`graphar_edge_types`, `graphar_properties`) into the `JoinGraph` — its types with rows and columns, its
edges with their ends and rows — and `GraphScope` holds it, cached under the graph: the overview's types-and-edges tables, the graph key and Ask's graph are that one read, and keasy holds
no SQL over the catalogue. *What would reverse it:* something the overview shows that the `JoinGraph`
does not carry — then it goes into the library's read, not back into a query here.

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

**The schema diagram is removed, and with it `@xyflow/react` and `elkjs`.** It
draws the types and edges that the Vertices and Edges tables right under it list, on a graph stack
of its own: a layered ELK layout and a label width guessed from `text.length * 6.5`. keasy already
has one view layer for graphs, `@kanzo-tech/graph`, and two heavy dependencies for a picture of two
tables is the wrong trade. *What would
reverse it:* people who need the shape at a glance and do not get it from the tables, schemas too
large to read as two lists — and then it is drawn with `@kanzo-tech/graph`'s canvas over the same
`Structure`, never a second graph stack.

## Azure has one credential: a user-delegation SAS through the Azure SDK

**keasy vends Azure storage one way.** A service principal gets an Entra token,
the token gets a user-delegation key, and the key signs a directory-scoped user-delegation SAS
(`sr=d`, `sdd`). This is how Apache Polaris and Unity Catalog vend Azure credentials, and it is what
Microsoft recommends over account keys. The SAS is tied to an Entra identity, can be revoked with
the key, and never carries the account key.

**There is no account-key kind**: Azure has one secret kind, `AzureServicePrincipal`.

`storage_client/vend.rs` gets the Entra token and the key through the Azure SDK for Rust, and signs the SAS itself:

- **The token**: `azure_identity`'s `ClientSecretCredential`, scope
  `https://storage.azure.com/.default`.
- **The key**: `azure_storage_blob` (1.1)'s `BlobServiceClient::get_user_delegation_key`.
- **The signature**: the maintained `azure_storage_blob` 1.1 has no SAS builder. The retired
  `azure_storage` 0.21 has one (`BlobSharedAccessSignature`), and it is **rejected**: it is the SDK
  keasy would be leaving, it pins `azure_core` 0.21 beside 1.x, and it brings in the `time` crate as a
  third clock. keasy keeps a minimal user-delegation SAS signer (`user_delegation_sas`, ~60 lines with
  `hmac` and `sha2`) until `azure_storage_blob` can build the SAS, and then deletes it.

The timestamps are `jiff`'s, so the server has one time crate. The tests at the end of `vend.rs` stay: the SAS names the directory it opens, and a silent Entra or blob endpoint is named `silent` within keasy's deadline. The SDK's client options (retries, timeouts) are set so those tests keep passing. *What would reverse it:* a customer whose storage account cannot use Entra. Then
an account key comes back as a second kind, signed by the SDK, never by hand.

**The token and the key are the Azure SDK's.** The SDK sends through keasy's own `reqwest` client (`Bounded`, an `HttpClient`), with no retries, so the silent tests name Entra and Azure Blob within keasy's deadline; they reach a silent `https` listener, because the SDK reaches Entra over `https` only, and Azure Blob with a credential that has its token already. The signer stays: no 1.x crate builds a SAS.

The SDK brings what rejecting `azure_storage` 0.21 was partly about: `time` 0.3 beside `jiff`, and
`azure_core` 1.1's `hmac` 0.12 and `sha2` 0.10 beside keasy's 0.13 and 0.11. The price is taken for less of keasy's own
code between it and Entra. *What would reverse it:* an SDK version, or a dependency it
brings, that breaks the build or an advisory check; or the `https`-only authority host blocking a real
deployment's Entra — then the token and the key are fetched by hand.

## Configuration is what a deployment sets

keasy reads no variable that no deployment sets, and ships no flag for a state nothing turns on: a
value nothing varies is fixed in code. *What would reverse it:* for each variable, a deployment that
sets it — then it is set in `compose*.yaml` and documented in the README, not left as
a default nobody turns. That includes the OIDC audience and the bind address. For the Members page's
console link, an organization whose console is not the Keycloak one `@kanzo-tech/auth` knows. For a
dependency, an import of it.

## Guards become lint rules

The rules ESLint and Clippy state exactly are lint rules, with the per-site reason as the tools' own
suppression comment, not regex scanners over the source:

| Guard | Rule |
|---|---|
| no empty `catch` without a reason | ESLint `no-empty` — a block holding a comment is not empty, which is the guard's rule as written |
| no `??=` memo of a call's result | ESLint `no-restricted-syntax`, `AssignmentExpression[operator='??=']`, with the message saying `fetchQuery` |
| fetch only through the deadline helper | ESLint `no-restricted-globals` for `fetch`, off in the helper's own file |
| read with `useSuspenseQuery` but for named exceptions | ESLint `no-restricted-imports`, `importNames: ["useQuery"]` from `@tanstack/react-query`; an exception is `// eslint-disable-next-line … -- <reason>` at the site |
| `let _ = … .await` without a reason | Clippy `let_underscore_must_use` and `let_underscore_future` in `[lints.clippy]`, and `#[expect(clippy::let_underscore_must_use, reason = "…")]` at the site; `unused_result_ok` also catches the `.ok();` the guard says it cannot |

The error-boundary-per-route-group check is a test: no lint rule reads the file tree. ESLint already runs in `web-ci.yml` and Clippy with `-D warnings` in `server-ci.yml`,
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
  The two module stores are the exception: a build's state names its graph before it ends, and a
  live run holds its Stop and its ending, neither of which a mutation's state carries; they stay
  `useSyncExternalStore`.

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
  `bindingName` is fossil's, derived from the lexer, and both call sites (`sources.ts`,
  `assistant/tasks/profile.ts`) call it. *What would reverse it:* nothing keasy can see — the formats
  and the grammar are fossil's to say.

## e2e

- **A typed API client.** `support/stack/api.ts` is `@keasy/api`'s `createApiClient`, which shares
  the context's cookies and goes through the edge and the web. Requests malformed on purpose (scenario 23) keep a
  raw call.
- **`page.clock` for windows of time.** `graphs.spec.ts`'s 7 s and 3 s waits assert that nothing
  happens over a window; `page.clock.install()` and `fastForward()` assert the same in milliseconds,
  and so do the poll's and the autosave's timers. ~10.
- **One smoke fixture.** `geoGraph`, `snbGraph` and `nobelGraph` differ by name and
  budget: one `seeded(example)` worker fixture keyed by `EXAMPLES`. ~25.

*What would reverse it:* a call the typed client cannot express — a body that must be wrong on
purpose — which stays a raw call, and only that one.

The windows stay real where `page.clock` cannot help: asserting that nothing happened after a
`fastForward` needs a point where the page's requests have settled, which the clock does not give.
One `seeded(example)` fixture is not taken: seeding inside a test puts SNB's 15 minutes under the
test's timeout instead of the worker fixture's.

## Not decided here

The audit found more that no decision above covers yet: hand-rolled empty states (`forbidden.tsx`,
`not-found.tsx`), the branding-to-theme adapter that belongs in `@kanzo-tech/theme`, two TanStack
forms' shared scaffolding (`createFormHook`), two delete confirmations, the tenant host built twice,
Discover's URL written twice in e2e, page objects re-exposing library harnesses, the 117 KB
`openapi.json` bundled for two string rules, and `CLOUDS` hard-coding what the contract could
publish. Each is small; each gets its line here when it is decided.
