# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Web Frontend (TypeScript/React):**

**Status:** No test framework currently configured.
- No testing dependencies in `web/package.json` (no Jest, Vitest, React Testing Library)
- No test configuration files found (no `jest.config.js`, `vitest.config.ts`)
- No `.test.ts`, `.spec.tsx` files in `web/src/`
- **Current approach:** Manual testing only

**Server (Rust):**

**Framework:**
- **Runner:** Built-in Rust testing via Cargo test
- **Assertion library:** Standard Rust `assert!`, `assert_eq!`, `assert!` macros
- **Config:** No special configuration required (Cargo default)

**Run Commands:**
```bash
cargo test              # Run all tests
cargo test -- --test-threads=1  # Run sequentially
cargo test --lib       # Run library tests only
```

## Test File Organization

**Rust Pattern:**
- **Location:** Co-located with implementation
  - Tests defined in same file as code using `#[cfg(test)] mod tests { ... }`
  - Example: `/Users/angel.ip/dev/kanzo/keasy/keasy/server/src/pipeline/extract.rs` contains test module at bottom
- **Naming:** Test module named `tests` inside each file
- **Structure:**
  ```
  src/
  ├── pipeline/
  │   ├── extract.rs          # Contains extract_summary() + #[cfg(test)] mod tests { }
  │   ├── types.rs
  │   └── mod.rs
  └── ...
  ```

## Test Structure

**Rust Test Suite:**

```rust
#[cfg(test)]
mod tests {
    use super::extract_summary;
    use fossil_lang::compiler::{Compiler, CompilerInput};

    fn compile_and_extract(src: &str) -> super::super::ValidationResult {
        let result = Compiler::default()
            .compile(CompilerInput::Source {
                name: "test".into(),
                content: src.into(),
            })
            .expect("compilation failed");
        extract_summary(&result.program)
    }

    #[test]
    fn join_to_output_edge_conditions() {
        // Test implementation
    }
}
```

**Patterns:**

1. **Setup helper functions:** Private helper functions in test module
   - `compile_and_extract()` compiles source and runs extraction
   - Marked with internal visibility

2. **Nested module imports:** Use `super::` and `super::super::` to access parent scope
   - `use super::extract_summary;` to import tested function
   - `super::super::ValidationResult` to access return type

3. **Test initialization:** No setup/teardown observed; each test is independent

## Mocking

**Framework:** Not applicable in current test code
- No mocking library detected in dependencies
- Tests use real implementations (Compiler, ProgramQuery)

**What to Mock:**
- External dependencies (if unit tests were introduced)
- Heavy I/O operations (file reads, network calls)
- Database connections

**What NOT to Mock:**
- Pure functions
- Type definitions
- Value objects (immutable data structures)

## Fixtures and Factories

**Test Data:**

**Rust approach:** Hard-coded inline source code in tests
```rust
let result = compile_and_extract(
    "type A do X: int Y: string end\n\
     type B do X: int Z: bool end\n\
     type Out do Y: string Z: bool end\n\
     let a = A { X = 1, Y = \"hi\" }\n\
     let b = B { X = 1, Z = true }\n\
     a |> join b on X = X |> each row -> Out { Y = row.Y, Z = row.Z }",
);
```

**Location:**
- Fixtures defined inline within test functions
- No separate fixture files observed
- Multi-line strings used for DSL/language samples

## Coverage

**Requirements:** Not enforced
- No coverage configuration files detected
- No coverage target specified in CI/documentation
- Tests are selective, not comprehensive

**View Coverage:**
```bash
cargo tarpaulin         # If tarpaulin installed
cargo llvm-cov         # LLVM-based coverage (requires tools)
```

## Test Types

**Unit Tests:**
- **Scope:** Individual function behavior in isolation
- **Approach:** Direct function invocation with varied inputs
- **Example:** `join_to_output_edge_conditions()` tests `extract_summary()` with specific Fossil language code
- **Assertion:** Detailed assertions on return value structure
  ```rust
  assert_eq!(result.pipeline.operations.len(), 1);
  let join_op = &result.pipeline.operations[0];
  assert_eq!(join_op.kind, "join");
  ```

**Integration Tests:**
- **Status:** Not structured as separate integration tests
- **Current approach:** End-to-end testing via real API (Frontend sends requests to Backend)

**E2E Tests:**
- **Framework:** Not used
- **Current approach:** Manual testing via UI or API clients

## Common Patterns

**Assertion Style - Rust:**

```rust
// Assertion with context message
assert!(
    !join_op.fields.is_empty(),
    "join operation fields are empty — frontend cannot create edges"
);

// Equality assertion
assert_eq!(result.pipeline.operations.len(), 1);
assert_eq!(join_op.kind, "join");

// Complex condition check
assert!(
    join_field_names.contains(&m.source.as_str()),
    "mapping.source '{}' not in join fields {:?} — edge will NOT be drawn",
    m.source, join_field_names
);
```

**Error Handling:**
```rust
// Expect pattern for test setup (panics on failure, which is acceptable in tests)
let result = Compiler::default()
    .compile(CompilerInput::Source { ... })
    .expect("compilation failed");
```

## Test Considerations

**For Web Frontend (when tests are added):**

Follow these patterns when implementing tests:

1. **Use shadcn/ui components in test mocks**
   - Avoid mocking shadcn components directly
   - Test component integration with UI components

2. **API mocking strategy:**
   - Mock API responses in `lib/api.ts`
   - Use factory functions for consistent test data

3. **Hook testing:**
   - Test custom hooks (`useMutation`, `useDelayedLoading`, etc.) in isolation
   - Verify state updates and callback behavior

4. **Component testing:**
   - Test component rendering with various prop combinations
   - Verify interaction handlers and state updates
   - Test integration with shadcn/ui components

**For Server (Rust):**

Current test pattern should be extended:

1. **Test module placement:** Keep `#[cfg(test)]` modules in source files
2. **Helper functions:** Extract complex test setup into private helpers
3. **Assertion messages:** Always include clear context messages for failed assertions
4. **Edge cases:** Test boundary conditions and error paths

---

*Testing analysis: 2026-02-26*
