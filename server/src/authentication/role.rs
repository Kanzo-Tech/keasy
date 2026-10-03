//! Who may call a handler, read off the verified token.
//!
//! Three roles, `reader ⊂ editor ⊂ admin`, and the hierarchy is not here: it is
//! declared once as Keycloak composite roles (`infra/auth`), and the token
//! carries the expanded set, so an admin's token says admin, editor and reader.
//! A handler states the least role it admits by taking [`Reader`], [`Editor`]
//! or [`Admin`], and asks [`Caller::may_modify`] before changing what someone
//! else made. The work in a workspace is shared: every role reads all of it.

use std::ops::Deref;

use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;

use super::middleware::AuthenticatedUser;
use crate::domain::Actor;
use crate::error::{ErrorCode, Refusal};

/// A role this application declares on its Keycloak client.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema, strum::EnumIter,
)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Reader,
    Editor,
    Admin,
}

impl Role {
    pub const fn name(self) -> &'static str {
        match self {
            Role::Reader => "reader",
            Role::Editor => "editor",
            Role::Admin => "admin",
        }
    }

    const fn bit(self) -> u8 {
        1 << self as u8
    }
}

/// The roles a token carries in this workspace's organization: a set, never a
/// rank. Names this application does not declare are ignored.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Roles(u8);

impl Roles {
    pub fn from_claim<'a>(names: impl IntoIterator<Item = &'a str>) -> Self {
        use strum::IntoEnumIterator;
        Roles(names.into_iter().fold(0, |set, name| {
            Role::iter()
                .find(|r| r.name() == name)
                .map_or(set, |r| set | r.bit())
        }))
    }

    pub fn contains(self, role: Role) -> bool {
        self.0 & role.bit() != 0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
}

impl std::fmt::Display for Roles {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use strum::IntoEnumIterator;
        let names: Vec<_> = Role::iter()
            .filter(|r| self.contains(*r))
            .map(Role::name)
            .collect();
        f.write_str(&names.join(","))
    }
}

/// Why a handler refused its caller. Opaque on purpose.
#[derive(Debug)]
pub enum RbacError {
    AuthRequired,
    NoMembership,
    InsufficientRole,
}

impl From<RbacError> for Refusal {
    fn from(e: RbacError) -> Self {
        match e {
            RbacError::AuthRequired => Refusal::new(
                StatusCode::UNAUTHORIZED,
                ErrorCode::AuthSessionRequired,
                "Authentication required",
            ),
            RbacError::NoMembership => Refusal::new(
                StatusCode::FORBIDDEN,
                ErrorCode::RbacNoMembership,
                "No role in this workspace",
            ),
            RbacError::InsufficientRole => Refusal::new(
                StatusCode::FORBIDDEN,
                ErrorCode::RbacInsufficientRole,
                "Insufficient permissions",
            ),
        }
    }
}

/// Who is calling, and the roles they hold here.
#[derive(Clone, Debug)]
pub struct Caller {
    /// The Keycloak `sub`.
    pub user_id: String,
    /// Their display name, kept with what they write. Never logged.
    pub name: String,
    pub roles: Roles,
}

impl Caller {
    /// The caller as what they write records them.
    pub fn actor(&self) -> Actor {
        Actor {
            id: self.user_id.clone(),
            name: self.name.clone(),
        }
    }

    pub fn holds(&self, role: Role) -> bool {
        self.roles.contains(role)
    }

    /// For a minimum that depends on the request, not the route: a write
    /// credential asks for more than a read one.
    pub fn require(&self, role: Role) -> Result<(), Refusal> {
        if self.holds(role) {
            return Ok(());
        }
        tracing::info!(authz = "deny:insufficient-role", required = role.name());
        Err(RbacError::InsufficientRole.into())
    }

    /// An admin changes anything; an editor changes what they made.
    pub fn may_modify(&self, created_by: &str) -> bool {
        self.holds(Role::Admin) || (self.holds(Role::Editor) && self.user_id == created_by)
    }

    /// [`Self::may_modify`], or `rbac/forbidden` naming what it was about.
    pub fn ensure_may_modify(&self, created_by: &str, resource: &str) -> Result<(), Refusal> {
        if self.may_modify(created_by) {
            return Ok(());
        }
        tracing::info!(authz = "deny:forbidden", resource);
        Err(Refusal::forbidden(format!(
            "Only its creator or an admin may change this {resource}"
        )))
    }
}

/// The caller, admitted if they hold `min`.
fn admit(parts: &Parts, min: Role) -> Result<Caller, Refusal> {
    let user = parts
        .extensions
        .get::<AuthenticatedUser>()
        .ok_or(RbacError::AuthRequired)?;
    if user.roles.is_empty() {
        tracing::info!(authz = "deny:no-membership");
        return Err(RbacError::NoMembership.into());
    }
    let caller = Caller {
        user_id: user.user_id.clone(),
        name: user.name.clone(),
        roles: user.roles,
    };
    caller.require(min)?;
    Ok(caller)
}

macro_rules! least_role {
    ($(#[$doc:meta])* $name:ident, $role:expr) => {
        $(#[$doc])*
        pub struct $name(pub Caller);

        impl Deref for $name {
            type Target = Caller;
            fn deref(&self) -> &Caller {
                &self.0
            }
        }

        impl<S: Send + Sync> FromRequestParts<S> for $name {
            type Rejection = Refusal;

            async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Refusal> {
                admit(parts, $role).map($name)
            }
        }
    };
}

least_role!(
    /// Admits anyone with a role here: everything in a workspace is read by all of it.
    Reader,
    Role::Reader
);
least_role!(
    /// Admits an editor or an admin: who builds graphs, connections and secrets.
    Editor,
    Role::Editor
);
least_role!(
    /// Admits an admin: who configures the workspace.
    Admin,
    Role::Admin
);

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use axum::http::Request;
    use axum::middleware::Next;
    use axum::routing::get;
    use tower::ServiceExt;

    fn roles(names: &[&str]) -> Roles {
        Roles::from_claim(names.iter().copied())
    }

    async fn read(_: Reader) -> &'static str {
        "read"
    }
    async fn edit(_: Editor) -> &'static str {
        "edit"
    }
    async fn administer(_: Admin) -> &'static str {
        "administer"
    }

    /// The three extractors behind a stand-in for the bearer layer. `user =
    /// false` is no token at all.
    fn app(user: bool, held: Roles) -> Router {
        Router::new()
            .route("/reader", get(read))
            .route("/editor", get(edit))
            .route("/admin", get(administer))
            .layer(axum::middleware::from_fn(
                move |mut request: Request<Body>, next: Next| async move {
                    if user {
                        request.extensions_mut().insert(AuthenticatedUser {
                            user_id: "u-1".to_string(),
                            name: "Ana Duarte".to_string(),
                            roles: held,
                        });
                    }
                    next.run(request).await
                },
            ))
    }

    async fn status(user: bool, held: Roles, path: &str) -> StatusCode {
        app(user, held)
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    #[test]
    fn a_claim_reads_as_a_set_of_the_roles_declared_here() {
        let set = roles(&["admin", "editor", "reader", "uma_authorization"]);
        assert!(set.contains(Role::Admin) && set.contains(Role::Editor));
        assert_eq!(set.to_string(), "reader,editor,admin");
        assert!(roles(&["owner", "member"]).is_empty());
    }

    /// The token carries composites expanded, so admitting is presence, never
    /// rank: a token naming only `admin` is admitted where an editor is not.
    #[tokio::test]
    async fn each_route_admits_who_holds_its_least_role() {
        let reader = roles(&["reader"]);
        let editor = roles(&["editor", "reader"]);
        let admin = roles(&["admin", "editor", "reader"]);
        for (held, admitted) in [
            (reader, ["/reader"].as_slice()),
            (editor, &["/reader", "/editor"]),
            (admin, &["/reader", "/editor", "/admin"]),
        ] {
            for path in ["/reader", "/editor", "/admin"] {
                let expected = if admitted.contains(&path) {
                    StatusCode::OK
                } else {
                    StatusCode::FORBIDDEN
                };
                assert_eq!(status(true, held, path).await, expected, "{held} {path}");
            }
        }
    }

    #[tokio::test]
    async fn no_role_here_is_admitted_nowhere_and_no_token_is_unauthorized() {
        for path in ["/reader", "/editor", "/admin"] {
            assert_eq!(
                status(true, Roles::default(), path).await,
                StatusCode::FORBIDDEN
            );
            assert_eq!(
                status(false, Roles::default(), path).await,
                StatusCode::UNAUTHORIZED
            );
        }
    }

    #[test]
    fn an_admin_changes_anything_and_an_editor_what_they_made() {
        let caller = |held: &[&str]| Caller {
            user_id: "u-1".into(),
            name: "Ana Duarte".into(),
            roles: roles(held),
        };
        assert!(caller(&["admin", "editor", "reader"]).may_modify("someone-else"));
        assert!(caller(&["editor", "reader"]).may_modify("u-1"));
        assert!(!caller(&["editor", "reader"]).may_modify("someone-else"));
        assert!(
            !caller(&["reader"]).may_modify("u-1"),
            "a reader changes nothing, not even what they made before"
        );
    }
}
