# Permissions

Status: phase A implemented (owners, actions, the matrix, the web drawing it). Phase B is marked
**[B]** throughout and not built yet.

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
| **manage** | Change its configuration: edit, rename, delete; a graph's rules and dashboard; **[B]** share and transfer. |

Stopping a run is its own case: its runner, or whoever manages the graph.

## Roles

| Role | On every object of the workspace |
|---|---|
| reader | read graphs, outputs, dashboards, rules and connection metadata; use completed outputs; Ask |
| editor | reader, plus create; **use** and **operate** everything; **manage** what they own (**[B]** or were made a manager of) |
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
| Secret (metadata; the value is never returned) | editor | editor; **[B]** a grant | editor (Test) | owner, **[B]** manager, admin | editor |
| Source connection (data, vocabulary) | reader | editor (in a graph, list files, vend a read) | editor (Test) | owner, **[B]** manager, admin | editor |
| Sink / workspace storage | reader | through its graphs only | admin (Test) | admin | admin |
| Graph | reader | reader (vend a completed output) | editor (run, run again); stop: runner, owner, **[B]** manager, admin | owner, **[B]** manager, admin | editor |
| Rules, dashboard | reader | — | — | the graph's manage | — |
| Ask | reader | — | — | — | — |

The server holds it in one function, `Caller::may` (`server/src/authentication/permission.rs`);
handlers call `caller.ensure(Action::…, &object)`. A route still states the least role it admits
(`Reader`, `Editor`, `Admin` extractors, and the OpenAPI `security` that `authorization.rs` checks):
that is the *create* column and the floor; the object decides the rest.

Testing records who asked on the report (`validation.by`) and never as the object's `updated_by`.

## The wire and the web

Views carry `can: { operate, manage }` — worked out per caller, drawn by the web, never re-derived.
`can_modify` (= `can.manage`) stays one release, deprecated; graphs keep `can_stop`.

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
   to every editor. **[B]** Phase A keeps today's behaviour (any editor uses any secret) but already
   asks `may(Use, &secret)` where a connection is created or repointed, so phase B changes only
   `may`.
3. **Readers do not see a source's files**: listing them is use, an editor's, as reading them is.
4. **No fourth role**: reader ⊂ editor ⊂ admin.
5. **[B] Grantees are people and Keycloak organisation groups**, by id, from a token claim.
6. **Folders carry no permissions yet.**
7. **[B] When someone leaves, what they own passes to the workspace.**

## Migration (phase A)

The schema is upgraded in place from the one before it (`server/src/database.rs`, `UPGRADE`):
`credentials`, `connections` and `graphs` are rebuilt with `owner` and `owner_name`, backfilled with
`owner = created_by`, and `owner = workspace` where `created_by = bootstrap`. Every row is kept.

## Phase B

- A `grants(object, principal, relation)` table, `relation` = `manager` or `user` (of a secret).
  `may` reads it: managers manage as owners do; using a secret asks for a `user` grant unless the
  caller owns or manages it, is an admin, or the workspace owns it.
- Principals are a person's `sub` or a group's id. Groups come from a token claim: kanzo-ui's realm
  must map each organisation member's Keycloak group ids into the access token (a group-membership
  mapper on the keasy client, ids rather than names, under the organisation, as `organization.<alias>.groups`),
  and `token.rs` reads it into `Caller`.
- `PUT /v1/{secrets|connections|graphs}/{id}/owner` (transfer: the owner or an admin) and a Share
  dialog for managers and secret users.
- Departure: when a member leaves the organisation, what they own passes to `workspace`.
- Remove `can_modify`.
