# Permissions

Status: phase A implemented (owners, actions, the matrix, the web drawing it). Phase B — grants to
people and groups, secrets used by grant, transfer, departure — had its server built and no screen,
and **is removed until a Share dialog exists** (decided 2026-10-13, [Sharing waits for its
dialog](#sharing-waits-for-its-dialog)). This page states the model without it, and so does the
code.

## The problem

keasy had three Keycloak roles, `reader ⊂ editor ⊂ admin`, and one ownership test,
`may_modify = admin || (editor && sub == created_by)`. That test guarded everything that was not
reading, so it was closed on harmless actions and open on powerful ones:

- Testing (re-validating) a connection or a secret counted as a change, because it stores a report.
  Seeded connections are created by the bootstrap, which nobody signs in as, so no editor could ever
  test them, and the Connections menu was hidden altogether.
- Any editor could read data through any source and build a connection on any secret, yet could
  not test them.
- A reader could list a source's object keys but not read the objects.
- Running a graph was its creator's; stopping it was its runner's. Only an admin could run a departed
  colleague's graph again.
- Ownership was `created_by`: immutable, untransferable, and "bootstrap" was a fake person.
- Graphs showed a denied action disabled with its reason; connections and credentials hid it.

## References

- **Grafana** ([roles and permissions](https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/)):
  org roles Viewer, Editor and Admin, and per-folder and per-dashboard permissions that raise or
  lower them. This is keasy's *shape*: three workspace roles, plus per-object exceptions.
- **Databricks Unity Catalog** ([ownership](https://docs.databricks.com/data-governance/unity-catalog/manage-privileges/ownership.html),
  [privileges](https://docs.databricks.com/aws/en/data-governance/unity-catalog/access-control/permissions-concepts)):
  every securable has exactly one owner — a user, a group or a service principal — and ownership is
  transferable; `MANAGE` is granted to many; using a securable (`USE`, `READ FILES`, using a storage
  credential) is separate from managing it. keasy already vends UC-style temporary path credentials,
  so these are its *semantics*: one owner, a system owner for what the system made, use apart from
  manage, and an explicit grant to use a credential.
- **Google Cloud IAM** ([roles](https://cloud.google.com/iam/docs/roles-overview)) and **Kubernetes
  RBAC** ([docs](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)): code asks for a
  *permission* (`verb` on a resource); roles are bundles of permissions; granting is a verb of its
  own. This is keasy's *discipline*: a handler asks `caller.may(Action, &object)`, never a role name.
- Considered and not taken: GitHub's five repository roles (an "operator" role is not needed, see
  decision 4), Snowflake's role-owned objects (the `workspace` principal plays that part),
  Zanzibar/OpenFGA as a service (too much for four resource types in one SQLite file; phase B, when it
  returns, stores grants as a local table of tuples instead), Keycloak Authorization Services
  (per-object policy belongs to keasy's data, not the IdP).

## Vocabulary

| Action | Means |
|---|---|
| **read** | See the object and its status. |
| **use** | Build on it: a source in a graph, its files listed or read; a secret in a connection; a completed graph's output read. |
| **operate** | Change its status, not its configuration: test a connection or a secret; run or re-run a graph. |
| **manage** | Change its configuration: edit, rename, delete; a graph's rules and dashboard. |

Stopping a run is its own case: its runner, or whoever manages the graph.

## Roles

| Role | On every object of the workspace |
|---|---|
| reader | read graphs, outputs, dashboards, rules and connection metadata; use completed outputs; Ask |
| editor | reader, plus create; **use** and **operate** everything but another person's secret; **manage** what they own |
| admin | editor, plus **manage** everything, the workspace's own objects and the sink included |

The roles stay Keycloak client roles, composites declared once (`compose.yaml`, `x-application`),
read per organisation from the token. Member administration stays in the organisation's Keycloak
console: a keasy admin is not an organisation admin.

## Ownership

Every secret, connection and graph has an **owner**, kept apart from its provenance:
`created_by` says who made it and never changes; `owner` says whose it is and is what permissions
read. The owner is a person's `sub` or the principal **`workspace`**. What the bootstrap declares
(the seeded secrets and connections, the sink) is owned by `workspace`: every editor uses and
operates it, only an admin manages it. Views answer `owner: { id, name }`.

## The matrix

| Object | read | use | operate | manage | create |
|---|---|---|---|---|---|
| Secret (metadata; the value is never returned) | editor | owner, admin; every editor on the workspace's | editor (Test) | owner, admin | editor |
| Source connection (data, vocabulary) | reader | editor (in a graph, list files, vend a read) | editor (Test) | owner, admin | editor |
| Sink / workspace storage | reader | through its graphs only | admin (Test) | admin | admin |
| Graph | reader | reader (vend a completed output) | editor (run, run again); stop: runner, owner, admin | owner, admin | editor |
| Rules, dashboard | reader | — | — | the graph's manage | — |
| The assistant's conversation | reader | — | — | owner, admin (save it; once a graph is built from it, nobody) | editor |
| Ask | reader | — | — | — | — |

The server holds it in one function, `Caller::may` (`server/src/authentication/permission.rs`);
handlers call `caller.ensure(Action::…, &object)`, and only that: graph routes load with the
module's own lookup (`graphs::any`) and ask `caller.ensure` as secrets and connections do — the
graph-only `graphs::permitted`, which loaded and ensured in one call, is gone. *What would reverse
it:* a fourth kind of object whose every route loads-then-ensures — then one generic
`permitted<T: Securable>` serves all of them, not a graph-only one. A route still states the least
role it admits (`Reader`, `Editor`, `Admin` extractors, and the OpenAPI `security` that
`authorization.rs` checks): that is the *create* column and the floor; the object decides the rest.

Testing records who asked on the report (`validation.by`) and never as the object's `updated_by`.

## The wire and the web

Views carry `can: { use, operate, manage }` — worked out per caller, drawn by the web, never
re-derived. `can_modify` is gone; graphs keep `can_stop`. `can.transfer` and `grants` leave the views
with phase B.

The web hides what the caller's *role* can never do (a reader is offered no menu, as on graphs) and
shows what the *object* denies them disabled, with the reason (`web/src/lib/permissions.ts`,
`components/blocked.tsx`), as the graph header always did. So an editor's Connections menu offers
Test on a seeded connection, and Delete disabled: "The workspace owns this connection: only an admin
can change it".

## Decisions

1. **An editor may run, and run again, another person's graph**: it is operate. Running overwrites
   the output, which is the point of running again.
2. **Using another person's secret is not possible without its owner or an admin.** Unity
   Catalog's rule is that using a credential takes an explicit grant; with no way to grant, the grant
   is nobody's, so an editor uses their own secrets and the workspace's (seeded) ones, and an admin
   uses any. It is asked where a connection is created or repointed, and only there: a connection
   already made on a secret keeps working, as an external location keeps its storage credential.
3. **Readers do not see a source's files**: listing them is use, an editor's, as reading them is.
4. **No fourth role**: reader ⊂ editor ⊂ admin.
5. **Folders carry no permissions yet.**
6. **When someone leaves, nothing is stranded**: an admin manages everything, so what a departed
   person owned is an admin's to change or delete. What they created still says they did. Moving the
   owner to the workspace on departure returns with the directory, which is the only thing that can
   say someone left.

## The schema

**There are no migrations** (2026-10-13). The server creates its schema in an empty database and
refuses to start on one whose schema differs, untouched, saying to delete the data volume
(`server/src/database.rs`, `apply_schema`); a schema change is the database dropped and created
again — `make clean`, or `docker compose down -v`. The single-step upgrade that brought the
`grants` table, and then the conversations, forward in place is gone with its test: no deployment
holds data that must outlive a schema change, and an upgrade written for each change is code kept
for a database nobody has. *What would reverse it:* a deployment whose data must survive a schema
change — then each change carries its migration, tested against a database of the schema before.

## Sharing waits for its dialog

**Decided 2026-10-13: grants, sharing and transfer are removed until a Share dialog exists.** Phase B's
server was built ahead of its screen: `PUT /v1/{secrets,connections,graphs}/{id}/grants` and
`PUT …/owner` had no web caller, the only client was one e2e test (`roles.spec.ts`), and the dialog
waited on a directory nobody has decided how to read (below). An API nobody can reach from the product
is surface to keep secure, documented and tested for no one; and the three copies of share and of
transfer in `routes/access.rs` were already asking to be collapsed for a feature without a user.

What goes, all of it (~900 lines):

| Where | What |
|---|---|
| server | `routes/access.rs` (the six `PUT …/grants` and `…/owner` handlers), `grants.rs` (replace, transfer, `depart`), `domain/grant.rs`; the `grants` table and `database::grants_of`; `Relation`, `Action::Transfer`, `Securable::grants` and the `granted` and `manages` arms of `Caller::may`; the `groups` claim read in `token.rs` and its `groups:overage` log in `middleware.rs` |
| matrix | the *transfer* column; *manager* and the `user` grant from every row |
| API | the six routes; the schemas `Grant`, `GrantRequest`, `GrantsRequest`, `OwnerRequest`, `TransferRequest`, `Principal`, `PrincipalKind`; `can.transfer` and `grants` on every view (`api/openapi.json` and `api/src/schema.d.ts` regenerated) |
| web | `transfer`'s reason in `lib/permissions.ts`; `can.transfer` in fixtures (`graphs.test.ts`) |
| compose | `groups: {}` in `x-application`, which asked the platform's Organization Group Ids mapper for ids only grants read |
| tests | the grant, transfer, group and departure cases of `server/tests/api/permissions.rs`; the shared-secret case of `e2e/tests/roles.spec.ts` |

What stays: `owner` apart from `created_by`, the `workspace` principal, the four actions and
`Caller::may` as one match. The schema changes with no migration ([The schema](#the-schema)).

*What would reverse it:* a Share dialog being built — a screen where a person picks someone in the
workspace and says *manager* or *may use this secret*. Then phase B comes back as it was designed: the
`grants` table as Zanzibar tuples in keasy's SQLite file (object, relation, principal; the object in
one of three columns with its foreign key), grants to people and to Keycloak organization groups by id
from the token, `PUT …/grants` replacing an object's grants whole as Drive's dialog applies on *Save*,
`PUT …/owner` for owner or admin only (a manager shares and does not transfer, as in Unity Catalog),
and one handler per verb generic over a `Securable` trait (`load`, `seen_by`) rather than three
copies. It comes back with its dialog, in the same change.

### What the dialog waits on

**Where keasy reads the organization's directory** — its members and groups by name — which
Keycloak's admin API answers only to a credential holding `realm-management`'s `view-users` and
`view-organizations`, and `view-users` sees the whole realm, every organization's people included.
The directory is what names *Research* in the dialog's picker (the token carries group ids and no
names), what reads membership past 100 groups (the token's `groups_overage`, Entra ID's rule), and
what says someone left (a sweep comparing owners with members, moving what they owned to the
workspace). The dialog and the directory are one decision.
