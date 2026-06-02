use std::sync::Arc;

use fossil_lang::passes::GlobalContext;
use fossil_lang::traits::resolver::PathResolver;

/// Build a fossil [`GlobalContext`] with the stdlib + providers registered.
///
/// Used by the `/v1/providers` listing (the only remaining in-process fossil
/// touch point on the server — job execution runs via the `fossil` subprocess).
pub fn init_context(path_resolver: Arc<dyn PathResolver>) -> GlobalContext {
    let mut gcx = GlobalContext { path_resolver, ..Default::default() };
    fossil_providers::init(&mut gcx);
    fossil_stdlib::init(&mut gcx);
    gcx
}
