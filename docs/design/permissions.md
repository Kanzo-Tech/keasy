# Permissions

Status: phase A implemented (owners, actions, the matrix, the web drawing it). Phase B's server is
implemented — grants to people and groups, secrets used by grant, transfer, departure — and its
Share dialog and the directory it picks from are not built yet ([What phase B leaves
open](#what-phase-b-leaves-open)).

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
  Zanzibar/OpenFGA as a service (too much for four resource types in one SQLite file; phase B stores
  grants as a local table of tuples instead), Keycloak Authorization Services (per-object policy
  belongs to keasy's data, not the IdP).

## Vocabulary

| Action | Means |
|---|---|
| **read** | See the object and its status. |
| **use** | Build on it: a source in a graph, its files listed or read; a secret in a connection; a completed graph's output read. |
| **operate** | Change its status, not its configuration: test a connection or a secret; run or re-run a graph. |
| **manage** | Change its configuration: edit, rename, delete; a graph's rules and dashboard; share it. |
| **transfer** | Give it to someone else to own: manage's one part a manager does not hold. |

Stopping a run is its own case: its runner, or whoever manages the graph.

## Roles

| Role | On every object of the workspace |
|---|---|
| reader | read graphs, outputs, dashboards, rules and connection metadata; use completed outputs; Ask |
| editor | reader, plus create; **use** and **operate** everything but another person's secret; **manage** what they own or were made a manager of |
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

| Object | read | use | operate | manage | transfer | create |
|---|---|---|---|---|---|---|
| Secret (metadata; the value is never returned) | editor | owner, manager, a `user` grant, admin; every editor on the workspace's | editor (Test) | owner, manager, admin | owner, admin | editor |
| Source connection (data, vocabulary) | reader | editor (in a graph, list files, vend a read) | editor (Test) | owner, manager, admin | owner, admin | editor |
| Sink / workspace storage | reader | through its graphs only | admin (Test) | admin | — (the workspace's) | admin |
| Graph | reader | reader (vend a completed output) | editor (run, run again); stop: runner, owner, manager, admin | owner, manager, admin | owner, admin | editor |
| Rules, dashboard | reader | — | — | the graph's manage | — | — |
| Ask | reader | — | — | — | — | — |

A grant raises an editor and never a reader: who holds no editor role manages nothing, whatever was
granted to them or to a group they are in.

The server holds it in one function, `Caller::may` (`server/src/authentication/permission.rs`);
handlers call `caller.ensure(Action::…, &object)`. A route still states the least role it admits
(`Reader`, `Editor`, `Admin` extractors, and the OpenAPI `security` that `authorization.rs` checks):
that is the *create* column and the floor; the object decides the rest.

Testing records who asked on the report (`validation.by`) and never as the object's `updated_by`.

## The wire and the web

Views carry `can: { use, operate, manage, transfer }` — worked out per caller, drawn by the web,
never re-derived — and `grants`, the object's grants, which everyone who reads the object sees (as
Google Drive shows everyone with access who else has it). `can_modify` is gone; graphs keep
`can_stop`.

The web hides what the caller's *role* can never do (a reader is offered no menu, as on graphs) and
shows what the *object* denies them disabled, with the reason (`web/src/lib/permissions.ts`,
`components/blocked.tsx`), as the graph header always did. So an editor's Connections menu offers
Test on a seeded connection, and Delete disabled: "The workspace owns this connection: only an admin
can change it".

## Decisions

1. **An editor may run, and run again, another person's graph**: it is operate. Running overwrites
   the output, which is the point of running again.
2. **Using a secret requires an explicit grant** — Unity Catalog's rule, the safest reference.
   Implicit for its owner, its managers and admins; the workspace's own (seeded) secrets are granted
   to every editor. It is asked where a connection is created or repointed, and only there: a
   connection already made on a secret keeps working when the grant is revoked, as an external
   location keeps its storage credential.
3. **Readers do not see a source's files**: listing them is use, an editor's, as reading them is.
4. **No fourth role**: reader ⊂ editor ⊂ admin.
5. **Grantees are people and Keycloak organisation groups**, by id, from a token claim.
6. **Folders carry no permissions yet.**
7. **When someone leaves, what they own passes to the workspace**, and the grants made to them go.
   What they created still says they did.
8. **A manager shares and does not transfer.** Only the owner or an admin gives an object away, as
   only a securable's owner or a metastore admin changes its owner in Unity Catalog; the previous
   owner keeps nothing by having owned it.

## Migration

The schema is upgraded in place from the one before it (`server/src/database.rs`, `UPGRADE`):
phase B adds the `grants` table and its indexes, and moves nothing else. A database from before
phase A is refused, as every schema older than the previous one is.

## Grants

`grants` holds one tuple a row — Zanzibar's object, relation, principal — in keasy's SQLite file,
not a service. The object is in exactly one of three columns, `secret`, `connection` or `graph`, so
each has its foreign key: a rename carries the grant along, a delete takes it away. `relation` is
`manager`, or `user` on a secret. A principal is a person's `sub` or a group's Keycloak id, kept with
the name it had when granted, for people to read and never to authorize on.

Every object is read with its grants (one correlated subquery, `database::grants_of`), so
`Caller::may` stays a pure function of the caller and the object, and the matrix stays one match.

Groups come from the token. keasy's declaration asks for them (`groups: {}` in `compose.yaml`'s
`x-application`), the platform's Organization Group Ids mapper (kanzo-ui v0.38.0) writes the ids of
the person's groups there — ancestors included — as `organization.<alias>.groups`, and
`token.rs` reads them into `Caller`. A path, which Keycloak's own mapper writes, is never read.

| Call | Who | What |
|---|---|---|
| `PUT /v1/{secrets,connections,graphs}/{id}/grants` | manage | Replaces the object's grants whole, as Drive's dialog applies its changes on *Save*: what stays keeps who granted it and when. None on the sink, no `user` of what is not a secret, none to its owner, at most 100 — past that, a group. |
| `PUT /v1/{secrets,connections,graphs}/{id}/owner` | transfer | Gives it to a person, by `sub` and name, or to the workspace (`{ "id": "workspace" }`). |

Departure is `grants::depart(sub)`: every secret, connection and graph `sub` owns passes to the
workspace in one transaction, and the grants to them are deleted.

## What phase B leaves open

Three things wait on one decision — **where keasy reads the organization's directory** (its members
and groups, by name), which Keycloak's admin API answers only to a credential holding
`realm-management`'s `view-users` and `view-organizations`, and `view-users` sees the whole realm,
every organization's people included:

- **The Share dialog's picker.** The token carries group ids and no names, so naming *Research* in
  the dialog needs the directory. Until then `PUT …/grants` takes the name the caller gives.
- **Overage.** Past 100 groups the token carries `groups_overage` and no ids; Entra ID's answer is
  to read the membership from the directory. Until then a grant to a group holds for no one in
  overage — the side to fail on — and the server logs `groups:overage`.
- **Departure's trigger.** A person who left never calls again, so only the directory can say they
  left: a sweep comparing owners and grantees with the organization's members, calling `depart`.

## Phase B

- Done: the `grants` table; `may` reading it, for people and groups; using a secret by grant;
  transfer; departure as a function; `can.use` and `can.transfer`; `can_modify` removed; the
  connection form offers a secret the caller may not use disabled, naming whom to ask.
- Not yet: the directory, and with it the Share dialog, overage and departure's sweep.
