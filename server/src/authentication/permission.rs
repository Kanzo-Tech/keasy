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
//! [`Provenance`](crate::domain::Provenance) keeps and never changes.

use serde::Serialize;
use utoipa::ToSchema;

use super::role::{Caller, Role};
use crate::domain::Actor;
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
    /// dashboard.
    Manage,
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

/// An object permissions are asked of: what it is and who owns it.
pub trait Securable {
    fn kind(&self) -> Kind;
    fn owner(&self) -> &Actor;
}

/// What the caller may do to an object beyond reading it, worked out for each
/// response: the interface draws what this says and does not re-derive it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct Can {
    /// Test it, or run it (again).
    pub operate: bool,
    /// Change, rename or delete it; a graph's rules and dashboard.
    pub manage: bool,
}

impl Caller {
    /// Whether the caller may take `action` on `object`. The whole matrix:
    ///
    /// | | read | use | operate | manage |
    /// |---|---|---|---|---|
    /// | secret | editor | editor | editor | owner, admin |
    /// | source | reader | editor | editor | owner, admin |
    /// | sink | reader | — (its graphs) | admin | admin |
    /// | graph | reader | reader | editor | owner, admin |
    ///
    /// Phase B adds, without changing a handler: managers granted on an object
    /// manage it as its owner does; and **using a secret** requires a grant —
    /// implicit for its owner, its managers and admins, and given to every
    /// editor on what the workspace owns. Until then any editor uses any
    /// secret, as before.
    pub fn may(&self, action: Action, object: &impl Securable) -> bool {
        let admin = self.holds(Role::Admin);
        let editor = self.holds(Role::Editor);
        let reader = self.holds(Role::Reader);
        let owner = object.owner();
        let owns = !owner.is_workspace() && owner.id == self.user_id;
        match (object.kind(), action) {
            (Kind::Sink, Action::Read) => reader,
            (Kind::Sink, Action::Use) => false,
            (Kind::Sink, Action::Operate | Action::Manage) => admin,
            (_, Action::Manage) => admin || (editor && owns),
            (Kind::Secret, Action::Read | Action::Use | Action::Operate) => editor,
            (Kind::Source | Kind::Graph, Action::Read) => reader,
            (Kind::Source, Action::Use) => editor,
            (Kind::Graph, Action::Use) => reader,
            (Kind::Source | Kind::Graph, Action::Operate) => editor,
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
            operate: self.may(Action::Operate, object),
            manage: self.may(Action::Manage, object),
        }
    }
}

/// Who may, said to who may not.
fn refusal(action: Action, kind: Kind) -> String {
    let noun = kind.noun();
    match (kind, action) {
        (Kind::Sink, Action::Use) => "The sink is reached through its graphs".into(),
        (Kind::Sink, _) => "Only an admin may test or change the sink".into(),
        (_, Action::Manage) => format!("Only its owner or an admin may change this {noun}"),
        (_, Action::Operate) => format!("Only an editor may test or run this {noun}"),
        (_, Action::Use) => format!("Only an editor may use this {noun}"),
        (_, Action::Read) => format!("Only an editor may see this {noun}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authentication::role::Roles;

    struct Object(Kind, Actor);

    impl Securable for Object {
        fn kind(&self) -> Kind {
            self.0
        }
        fn owner(&self) -> &Actor {
            &self.1
        }
    }

    fn caller(sub: &str, held: &[&str]) -> Caller {
        Caller {
            user_id: sub.into(),
            name: sub.into(),
            roles: Roles::from_claim(held.iter().copied()),
        }
    }

    fn person(sub: &str) -> Actor {
        Actor {
            id: sub.into(),
            name: sub.into(),
        }
    }

    const READER: &[&str] = &["reader"];
    const EDITOR: &[&str] = &["editor", "reader"];
    const ADMIN: &[&str] = &["admin", "editor", "reader"];

    /// Every cell of the matrix, for a reader, an editor who owns the object,
    /// another editor and an admin: `[read, use, operate, manage]`.
    #[test]
    fn the_matrix_cell_by_cell() {
        use Action::*;
        let cells = |kind: Kind, who: &Caller| {
            let object = Object(kind, person("u-owner"));
            [Read, Use, Operate, Manage].map(|a| who.may(a, &object))
        };
        let reader = caller("u-r", READER);
        let owner = caller("u-owner", EDITOR);
        let other = caller("u-e", EDITOR);
        let admin = caller("u-a", ADMIN);
        let table = [
            (Kind::Secret, &reader, [false, false, false, false]),
            (Kind::Secret, &owner, [true, true, true, true]),
            (Kind::Secret, &other, [true, true, true, false]),
            (Kind::Secret, &admin, [true, true, true, true]),
            (Kind::Source, &reader, [true, false, false, false]),
            (Kind::Source, &owner, [true, true, true, true]),
            (Kind::Source, &other, [true, true, true, false]),
            (Kind::Source, &admin, [true, true, true, true]),
            (Kind::Sink, &reader, [true, false, false, false]),
            (Kind::Sink, &owner, [true, false, false, false]),
            (Kind::Sink, &other, [true, false, false, false]),
            (Kind::Sink, &admin, [true, false, true, true]),
            (Kind::Graph, &reader, [true, true, false, false]),
            (Kind::Graph, &owner, [true, true, true, true]),
            (Kind::Graph, &other, [true, true, true, false]),
            (Kind::Graph, &admin, [true, true, true, true]),
        ];
        for (kind, who, expected) in table {
            assert_eq!(cells(kind, who), expected, "{kind:?} for {}", who.user_id);
        }
    }

    /// What the workspace owns, no person does: a caller whose `sub` happened
    /// to spell `workspace` would manage nothing by it.
    #[test]
    fn what_the_workspace_owns_only_an_admin_manages() {
        let seeded = Object(Kind::Source, Actor::workspace());
        let editor = caller("workspace", EDITOR);
        assert!(editor.may(Action::Operate, &seeded), "any editor tests it");
        assert!(!editor.may(Action::Manage, &seeded));
        assert!(caller("u-a", ADMIN).may(Action::Manage, &seeded));
    }

    #[test]
    fn a_refusal_says_who_may() {
        let other = caller("u-e", EDITOR);
        let source = Object(Kind::Source, person("u-owner"));
        let refused = other.ensure(Action::Manage, &source).unwrap_err();
        assert_eq!(refused.status, axum::http::StatusCode::FORBIDDEN);
        assert_eq!(
            other.can(&source),
            Can {
                operate: true,
                manage: false
            }
        );
    }
}
