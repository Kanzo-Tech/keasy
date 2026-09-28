//! Which connection holds a locator: the one source whose location contains
//! it, compared as canonical locations — never as text.

use crate::database::Database;
use crate::domain::{ConnectionView, Direction, StorageCredentialInput, StorageLocation};
use crate::error::Refusal;

/// The source connection that holds `locator`, with the credential it reads
/// through and the locator as that credential reaches it. Locations never
/// overlap, so within one store there is at most one; a locator that names no
/// store (`s3://b/…` on two endpoints) and fits two is refused, not guessed.
pub async fn holder(
    db: &Database,
    locator: &StorageLocation,
) -> Result<Option<(ConnectionView, StorageLocation, StorageCredentialInput)>, Refusal> {
    let connections = super::persistence::list(&*db.read().await, None)?;
    let mut holding = Vec::new();
    for connection in connections {
        if connection
            .target
            .storage()
            .is_none_or(|s| s.direction != Direction::Source)
        {
            continue;
        }
        let (location, credential) = super::storage(db, &connection).await?;
        if let Ok(object) = locator.clone().within(&credential)
            && location.contains(&object)
        {
            holding.push((connection, object, credential));
        }
    }
    match holding.len() {
        0 | 1 => Ok(holding.pop()),
        _ => Err(Refusal::invalid(format!(
            "{locator} lies under {}, which name the same bucket on different services",
            holding
                .iter()
                .map(|(c, ..)| format!("{:?}", c.name))
                .collect::<Vec<_>>()
                .join(" and ")
        ))),
    }
}
