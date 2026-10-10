//! What a caller may do to an object: the permission matrix of
//! `docs/design/permissions.md`, in one function.
//!
//! A handler asks for an [`Action`] on an object — `caller.ensure(Action::Operate,
//! &connection)` — never for a role by name. The roles are bundles of actions,
//! as Google Cloud's basic roles and Kubernetes' `view`/`edit`/`admin` are:
//! a reader reads, an editor uses and operates everything and manages what they
//! own, an admin manages everything. Each object has one owner — a person's
//! `sub`, or [`Actor::workspace`] for what the instance declares — as Unity
//! Catalog's securables do; the owner is not who created it, which
//! [`Provenance`](crate::domain::Provenance) keeps and never changes. Beyond
//! the owner, an object carries its [`Grant`]s: managers, people or groups,
//! who manage it as its owner does, and — on a secret — its users.

use serde::Serialize;
use utoipa::ToSchema;

use super::role::{Caller, Role};
use crate::domain::{Actor, Grant, Principal, PrincipalKind, Relation};
use crate::error::Refusal;

/// The permission vocabulary, from least to most.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// See the object and its status.
    Read,
    /// Build on it: a connection as a graph's source, its files listed or read;
    /// a secret in a connection; a completed graph's output read.
    Use,
    /// Change its status, not its configuration: test a connection or a
    /// secret, run a graph again.
    Operate,
    /// Change its configuration: edit, rename, delete; a graph's rules and
    /// dashboard; who else manages it, and who uses a secret.
    Manage,
    /// Give it to someone else to own: manage's one part a manager does not
    /// hold — Unity Catalog's rule that only the owner (or an admin) changes
    /// the owner.
    Transfer,
}

/// What kind of object a permission is asked of: the matrix has a row for each.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Secret,
    /// A source connection: data or a vocabulary.
    Source,
    /// The workspace's one sink: an admin's, reached through its graphs.
    Sink,
    Graph,
}

impl Kind {
    fn noun(self) -> &'static str {
        match self {
            Kind::Secret => "secret",
            Kind::Source => "connection",
            Kind::Sink => "sink",
            Kind::Graph => "graph",
        }
    }
}

/// An object permissions are asked of: what it is, who owns it, and what
/// has been granted on it.
pub trait Securable {
    fn kind(&self) -> Kind;
    fn owner(&self) -> &Actor;
    fn grants(&self) -> &[Grant];
}

/// What the caller may do to an object beyond reading it, worked out for each
/// response: the interface draws what this says and does not re-derive it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct Can {
    /// Build on it: a secret in a connection. Every editor uses a connection
    /// and reads a graph's output, so the interface reads this for secrets.
    #[serde(rename = "use")]
    pub use_: bool,
    /// Test it, or run it (again).
    pub operate: bool,
    /// Change, rename or delete it; a graph's rules and dashboard; share it.
    pub manage: bool,
    /// Give it to someone else to own.
    pub transfer: bool,
}

impl Caller {
    /// Whether the caller may take `action` on `object`. The whole matrix:
    ///
    /// | | read | use | operate | manage | transfer |
    /// |---|---|---|---|---|---|
    /// | secret | editor | owner, manager, user, admin; every editor on the workspace's | editor | owner, manager, admin | owner, admin |
    /// | source | reader | editor | editor | owner, manager, admin | owner, admin |
    /// | sink | reader | — (its graphs) | admin | admin | — |
    /// | graph | reader | reader | editor | owner, manager, admin | owner, admin |
    ///
    /// A grant raises an editor, never a reader: who holds no editor role
    /// here manages nothing, whatever was granted to them or their groups.
    pub fn may(&self, action: Action, object: &impl Securable) -> bool {
        let admin = self.holds(Role::Admin);
        let editor = self.holds(Role::Editor);
        let reader = self.holds(Role::Reader);
        let owner = object.owner();
        let owns = !owner.is_workspace() && owner.id == self.user_id;
        let granted = |relation: Relation| {
            object
                .grants()
                .iter()
                .any(|g| g.relation == relation && self.is(&g.principal))
        };
        let manages = owns || granted(Relation::Manager);
        match (object.kind(), action) {
            (Kind::Sink, Action::Read) => reader,
            (Kind::Sink, Action::Use | Action::Transfer) => false,
            (Kind::Sink, Action::Operate | Action::Manage) => admin,
            (_, Action::Transfer) => admin || (editor && owns),
            (_, Action::Manage) => admin || (editor && manages),
            (Kind::Secret, Action::Use) => {
                admin || (editor && (manages || owner.is_workspace() || granted(Relation::User)))
            }
            (Kind::Secret, Action::Read | Action::Operate) => editor,
            (Kind::Source | Kind::Graph, Action::Read) => reader,
            (Kind::Source, Action::Use) => editor,
            (Kind::Graph, Action::Use) => reader,
            (Kind::Source | Kind::Graph, Action::Operate) => editor,
        }
    }

    /// Whether a grant to `principal` is a grant to the caller: to them, or
    /// to a group the token says they are in here.
    fn is(&self, principal: &Principal) -> bool {
        match principal.kind {
            PrincipalKind::User => principal.id == self.user_id,
            PrincipalKind::Group => self.groups.contains(&principal.id),
        }
    }

    /// [`Self::may`], or `rbac/forbidden` saying who may.
    pub fn ensure(&self, action: Action, object: &impl Securable) -> Result<(), Refusal> {
        if self.may(action, object) {
            return Ok(());
        }
        let kind = object.kind();
        tracing::info!(authz = "deny:forbidden", resource = kind.noun(), ?action);
        Err(Refusal::forbidden(refusal(action, kind)))
    }

    /// What the caller may do to `object`, for its view.
    pub fn can(&self, object: &impl Securable) -> Can {
        Can {
            use_: self.may(Action::Use, object),
            operate: self.may(Action::Operate, object),
            manage: self.may(Action::Manage, object),
            transfer: self.may(Action::Transfer, object),
        }
    }
}

/// Who may, said to who may not.
fn refusal(action: Action, kind: Kind) -> String {
    let noun = kind.noun();
    match (kind, action) {
        (Kind::Sink, Action::Use) => "The sink is reached through its graphs".into(),
        (Kind::Sink, Action::Transfer) => "The workspace owns the sink".into(),
        (Kind::Sink, _) => "Only an admin may test or change the sink".into(),
        (_, Action::Transfer) => format!("Only its owner or an admin may give this {noun} away"),
        (_, Action::Manage) => {
            format!("Only its owner, its managers or an admin may change this {noun}")
        }
        (Kind::Secret, Action::Use) => {
            "Only who this secret is shared with may use it: ask its owner".into()
        }
        (_, Action::Operate) => format!("Only an editor may test or run this {noun}"),
        (_, Action::Use) => format!("Only an editor may use this {noun}"),
        (_, Action::Read) => format!("Only an editor may see this {noun}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authentication::role::Roles;

    struct Object(Kind, Actor, Vec<Grant>);

    impl Securable for Object {
        fn kind(&self) -> Kind {
            self.0
        }
        fn owner(&self) -> &Actor {
            &self.1
        }
        fn grants(&self) -> &[Grant] {
            &self.2
        }
    }

    fn caller(sub: &str, held: &[&str]) -> Caller {
        Caller {
            user_id: sub.into(),
            name: sub.into(),
            roles: Roles::from_claim(held.iter().copied()),
            groups: vec![],
        }
    }

    fn in_groups(mut caller: Caller, groups: &[&str]) -> Caller {
        caller.groups = groups.iter().map(|g| g.to_string()).collect();
        caller
    }

    fn person(sub: &str) -> Actor {
        Actor {
            id: sub.into(),
            name: sub.into(),
        }
    }

    fn grant(kind: PrincipalKind, id: &str, relation: Relation) -> Grant {
        Grant {
            principal: Principal {
                kind,
                id: id.into(),
                name: id.into(),
            },
            relation,
            granted_by: person("u-owner"),
            granted_at: "t".into(),
        }
    }

    const READER: &[&str] = &["reader"];
    const EDITOR: &[&str] = &["editor", "reader"];
    const ADMIN: &[&str] = &["admin", "editor", "reader"];

    /// Every cell of the matrix, for a reader, an editor who owns the object,
    /// another editor and an admin, nothing granted: `[read, use, operate,
    /// manage, transfer]`.
    #[test]
    fn the_matrix_cell_by_cell() {
        use Action::*;
        let cells = |kind: Kind, who: &Caller| {
            let object = Object(kind, person("u-owner"), vec![]);
            [Read, Use, Operate, Manage, Transfer].map(|a| who.may(a, &object))
        };
        let reader = caller("u-r", READER);
        let owner = caller("u-owner", EDITOR);
        let other = caller("u-e", EDITOR);
        let admin = caller("u-a", ADMIN);
        let table = [
            (Kind::Secret, &reader, [false, false, false, false, false]),
            (Kind::Secret, &owner, [true, true, true, true, true]),
            (Kind::Secret, &other, [true, false, true, false, false]),
            (Kind::Secret, &admin, [true, true, true, true, true]),
            (Kind::Source, &reader, [true, false, false, false, false]),
            (Kind::Source, &owner, [true, true, true, true, true]),
            (Kind::Source, &other, [true, true, true, false, false]),
            (Kind::Source, &admin, [true, true, true, true, true]),
            (Kind::Sink, &reader, [true, false, false, false, false]),
            (Kind::Sink, &owner, [true, false, false, false, false]),
            (Kind::Sink, &other, [true, false, false, false, false]),
            (Kind::Sink, &admin, [true, false, true, true, false]),
            (Kind::Graph, &reader, [true, true, false, false, false]),
            (Kind::Graph, &owner, [true, true, true, true, true]),
            (Kind::Graph, &other, [true, true, true, false, false]),
            (Kind::Graph, &admin, [true, true, true, true, true]),
        ];
        // Each row is named by its place in the table, never by a caller's id.
        for (row, (kind, who, expected)) in table.into_iter().enumerate() {
            assert_eq!(cells(kind, who), expected, "row {row}: {kind:?}");
        }
    }

    /// What the workspace owns, no person does: a caller whose `sub` happened
    /// to spell `workspace` would manage nothing by it.
    #[test]
    fn what_the_workspace_owns_only_an_admin_manages() {
        let seeded = Object(Kind::Source, Actor::workspace(), vec![]);
        let editor = caller("workspace", EDITOR);
        assert!(editor.may(Action::Operate, &seeded), "any editor tests it");
        assert!(!editor.may(Action::Manage, &seeded));
        assert!(!editor.may(Action::Transfer, &seeded));
        assert!(caller("u-a", ADMIN).may(Action::Manage, &seeded));
    }

    /// A manager, named or through a group, manages as the owner does — and
    /// shares — but gives nothing away.
    #[test]
    fn a_manager_manages_and_does_not_transfer() {
        let graph = Object(
            Kind::Graph,
            person("u-owner"),
            vec![
                grant(PrincipalKind::User, "u-m", Relation::Manager),
                grant(PrincipalKind::Group, "g-research", Relation::Manager),
            ],
        );
        let named = caller("u-m", EDITOR);
        let member = in_groups(caller("u-x", EDITOR), &["g-other", "g-research"]);
        let outsider = in_groups(caller("u-y", EDITOR), &["g-other"]);
        for who in [&named, &member] {
            assert!(who.may(Action::Manage, &graph), "{}", who.user_id);
            assert!(!who.may(Action::Transfer, &graph), "{}", who.user_id);
        }
        assert!(!outsider.may(Action::Manage, &graph));
    }

    /// A user's `sub` never matches a group's id, nor the other way round.
    #[test]
    fn a_grant_names_a_person_or_a_group_never_both() {
        let source = Object(
            Kind::Source,
            person("u-owner"),
            vec![grant(PrincipalKind::Group, "u-m", Relation::Manager)],
        );
        assert!(!caller("u-m", EDITOR).may(Action::Manage, &source));
        let source = Object(
            Kind::Source,
            person("u-owner"),
            vec![grant(PrincipalKind::User, "g-research", Relation::Manager)],
        );
        let member = in_groups(caller("u-x", EDITOR), &["g-research"]);
        assert!(!member.may(Action::Manage, &source));
    }

    /// A grant raises an editor, never a reader.
    #[test]
    fn a_reader_granted_manager_manages_nothing() {
        let graph = Object(
            Kind::Graph,
            person("u-owner"),
            vec![grant(PrincipalKind::User, "u-r", Relation::Manager)],
        );
        assert!(!caller("u-r", READER).may(Action::Manage, &graph));
    }

    /// Unity Catalog's rule for a storage credential: using a secret takes a
    /// grant, which its owner, its managers and admins hold implicitly, and
    /// every editor holds on what the workspace owns.
    #[test]
    fn using_a_secret_takes_a_grant() {
        let shared = Object(
            Kind::Secret,
            person("u-owner"),
            vec![
                grant(PrincipalKind::User, "u-user", Relation::User),
                grant(PrincipalKind::Group, "g-data", Relation::User),
                grant(PrincipalKind::User, "u-m", Relation::Manager),
            ],
        );
        for who in [
            caller("u-user", EDITOR),
            in_groups(caller("u-x", EDITOR), &["g-data"]),
            caller("u-m", EDITOR),
            caller("u-owner", EDITOR),
            caller("u-a", ADMIN),
        ] {
            assert!(who.may(Action::Use, &shared), "{}", who.user_id);
        }
        assert!(!caller("u-y", EDITOR).may(Action::Use, &shared));
        assert!(!caller("u-user", READER).may(Action::Use, &shared));
        assert!(
            !caller("u-user", EDITOR).may(Action::Manage, &shared),
            "a user uses it and changes nothing"
        );

        let seeded = Object(Kind::Secret, Actor::workspace(), vec![]);
        assert!(caller("u-y", EDITOR).may(Action::Use, &seeded));
        assert!(!caller("u-r", READER).may(Action::Use, &seeded));
    }

    #[test]
    fn a_refusal_says_who_may() {
        let other = caller("u-e", EDITOR);
        let source = Object(Kind::Source, person("u-owner"), vec![]);
        let refused = other.ensure(Action::Manage, &source).unwrap_err();
        assert_eq!(refused.status, axum::http::StatusCode::FORBIDDEN);
        assert_eq!(
            other.can(&source),
            Can {
                use_: true,
                operate: true,
                manage: false,
                transfer: false,
            }
        );
    }
}
