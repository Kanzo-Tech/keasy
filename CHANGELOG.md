# Changelog

Notes worth writing by hand. GitHub generates the "What's Changed" list from PR
titles on its own; what lands here is what that list cannot say — a break a
reader has to act on.

## Unreleased

### Breaking: the surface language dropped prefixes and CURIEs

`@fossil-lang/*` `0.3.0-alpha.5` removed `prefix` declarations and CURIEs from
the language keasy's editor speaks. This is not a keasy migration falling short:
the language changed underneath the programs.

Verified against the real wasm — a program in the syntax keasy used to suggest
comes back with 20 errors of severity 1, the first of them:

> `prefix` declares a vocabulary, and there is no vocabulary left to declare:
> the CURIE is gone from every position it held

The shape that replaces it:

```
prefix ex: <https://example.org/>      →  type { Person } := io.shex("@vocab/person.shex")
User : ex:Person from users            →  @subject = "https://example.org/user/{User.id}"
    iri = `${ex:}user/${.id}`          →  bare property keys
```

**A job script saved before this release will show red in the editor**, and
there is no migration: no instance was deployed carrying one, so rewriting is
cheaper and more honest than a translator for programs nobody wrote. The Job
Studio's empty buffer already teaches the new form.
