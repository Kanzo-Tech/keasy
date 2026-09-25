//! Which connection signs a locator: the deepest storage source it lies
//! under, at a path boundary, never the sink.

use keasy_api::connections::{ConnectionView, Direction};

use crate::domain::StorageUrl;
use crate::storage_client::relative_path;

pub fn is_public_http(locator: &str) -> bool {
    locator.starts_with("https://") || locator.starts_with("http://")
}

/// The object path `locator` names under `base`, when it names one.
fn object_under<'a>(locator: &'a str, base: &str) -> Option<&'a str> {
    let rest = locator
        .strip_prefix(base.trim_end_matches('/'))?
        .strip_prefix('/')?;
    relative_path(rest).ok().map(|()| rest)
}

/// The deepest storage connection `locator` lies under.
fn owner<'a>(locator: &str, connections: &'a [ConnectionView]) -> Option<&'a ConnectionView> {
    connections
        .iter()
        .filter_map(|c| c.target.storage().map(|s| (c, s)))
        .filter(|(_, s)| object_under(locator, &s.url).is_some())
        .max_by_key(|(_, s)| s.url.trim_end_matches('/').len())
        .map(|(c, _)| c)
}

/// The connection that signs `locator`: its owner, when that is a source. A
/// source rooted above the sink does not reach into it.
pub fn signer<'a>(locator: &str, connections: &'a [ConnectionView]) -> Option<&'a ConnectionView> {
    owner(locator, connections).filter(|c| {
        c.target
            .storage()
            .is_some_and(|s| s.direction == Direction::Source)
            && StorageUrl::parse(locator).is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use keasy_api::connections::{ConnectionKind, ConnectionTarget, ModelTarget, StorageTarget};

    fn view(name: &str, target: ConnectionTarget) -> ConnectionView {
        ConnectionView {
            name: name.into(),
            credential: "acct".into(),
            target,
            created_by: String::new(),
            created_at: String::new(),
            updated_by: String::new(),
            updated_at: String::new(),
            validation: None,
        }
    }

    fn conn(name: &str, url: &str, direction: Direction) -> ConnectionView {
        view(
            name,
            ConnectionTarget::Storage(StorageTarget {
                url: url.into(),
                kind: ConnectionKind::Data,
                direction,
            }),
        )
    }

    fn workspace() -> Vec<ConnectionView> {
        vec![
            conn("bucket", "s3://b/", Direction::Source),
            conn("shapes", "s3://b/vocab/", Direction::Source),
            conn("data", "s3://b/data", Direction::Source),
            conn("sink", "s3://b/output/", Direction::Sink),
            view(
                "claude",
                ConnectionTarget::Model(ModelTarget {
                    model: None,
                    max_tokens: None,
                }),
            ),
        ]
    }

    fn signed_by(locator: &str) -> Option<String> {
        signer(locator, &workspace()).map(|c| c.name.clone())
    }

    #[test]
    fn the_deepest_connection_signs() {
        assert_eq!(
            signed_by("s3://b/vocab/shop.shex").as_deref(),
            Some("shapes")
        );
        assert_eq!(signed_by("s3://b/people.csv").as_deref(), Some("bucket"));
        assert_eq!(signed_by("s3://b/data/x.csv").as_deref(), Some("data"));
    }

    #[test]
    fn a_connection_owns_a_locator_only_at_a_path_boundary() {
        let only_data = vec![conn("data", "s3://b/data", Direction::Source)];
        assert!(signer("s3://b/data/x.csv", &only_data).is_some());
        assert!(signer("s3://b/data-private/x.csv", &only_data).is_none());
        assert!(signer("s3://b/data", &only_data).is_none());
        assert!(signer("s3://b/data/", &only_data).is_none());
        assert_eq!(
            signed_by("s3://b/data-private/x.csv").as_deref(),
            Some("bucket")
        );
    }

    #[test]
    fn the_sink_is_not_signed_even_under_a_source_rooted_above_it() {
        assert_eq!(signed_by("s3://b/output/job/vertex/Person.parquet"), None);
    }

    #[test]
    fn a_locator_cannot_climb_out_of_its_connection() {
        assert_eq!(signed_by("s3://b/vocab/../output/job/x.parquet"), None);
        assert_eq!(signed_by("s3://other/x.csv"), None);
    }

    #[test]
    fn a_public_locator_is_not_a_cloud_one() {
        let public = vec![conn("web", "https://example.org/", Direction::Source)];
        assert!(signer("https://example.org/x.csv", &public).is_none());
    }
}
