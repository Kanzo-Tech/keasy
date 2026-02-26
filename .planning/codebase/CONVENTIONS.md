# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- **TypeScript/React files:** camelCase with component names as PascalCase for exported components (e.g., `settings-nav.tsx`, `CodeEditor`, `code-editor.tsx`)
- **Directories:** kebab-case for feature/section directories (e.g., `/components/job-detail`, `/settings/cloud-accounts`)
- **Utility/lib files:** camelCase (e.g., `api-proxy.ts`, `codemirror-theme.ts`, `dashboard-store.ts`)
- **Rust source files:** snake_case (e.g., `extract.rs`, `rdf_graph.rs`, `auth.rs`)
- **Rust module directories:** snake_case (e.g., `cloud`, `dcat`, `graph`, `pipeline`)

**Functions:**
- **TypeScript:** camelCase for all functions and hooks
  - Custom hooks prefixed with `use` (e.g., `useMutation`, `useDelayedLoading`, `useGraphModel`, `useMobile`)
  - Higher-order functions: `createHandler`, `connectionCompletion`, `detectMacroContext`
- **Rust:** snake_case for all functions and methods (e.g., `extract_summary`, `extract_source_name`, `compile_and_extract`)

**Variables:**
- **TypeScript:** camelCase for constants and variables
  - Configuration constants: SCREAMING_SNAKE_CASE when appropriate (e.g., API environment variables)
  - React component props: camelCase (e.g., `connections`, `providers`, `className`, `placeholder`)
- **Rust:** snake_case for variables, constants, and type instances
  - Type definitions: PascalCase
  - Constants requiring emphasis: SCREAMING_SNAKE_CASE

**Types:**
- **TypeScript:** PascalCase for all interfaces, types, and type aliases
  - Exported types: `Job`, `ValidationResult`, `PipelineSummary`, `Connection`, `FileEntry`, `AiSettings`
  - Props interfaces: Suffixed with `Props` when used as component props (e.g., `CodeEditorProps`)
  - Union/discriminated types: `JobStatus = "draft" | "pending" | "running" | "completed" | "failed" | "cancelled"`
- **Rust:** PascalCase for types and structs (e.g., `ExtractionResult`, `AppState`, `OutputCache`)

## Code Style

**Formatting:**
- **TypeScript/React:** No explicit formatter config file, follows Next.js defaults
  - Imports from internal modules use path alias `@/` (defined in `tsconfig.json`)
  - Line length: appears to default to 80-100 characters
  - 2-space indentation (standard JavaScript convention)
- **Rust:** Standard Rust formatting via `rustfmt` (Cargo default)
  - 4-space indentation

**Linting:**
- **TypeScript/React:** ESLint configured with `eslint-config-next` (flat config format)
  - Config file: `eslint.config.mjs` in web directory
  - Includes Next.js Core Web Vitals and TypeScript support
  - Script: `npm run lint` (defined in `web/package.json`)
- **Rust:** Cargo clippy (standard Rust linting via `cargo clippy`)

**Imports Organization:**

TypeScript imports follow Next.js conventions:

```typescript
// 1. React and external libraries
import { useEffect, useRef, useCallback } from "react";
import type { Metadata } from "next";

// 2. Internal component/type imports with path aliases
import { PreferencesProvider } from "@/components/preferences-provider";
import { CodeEditor } from "@/components/code-editor";
import type { Connection, FileEntry, ProviderInfo } from "@/lib/types";

// 3. Utilities/styles
import { cn } from "@/lib/utils";
import "./globals.css";
```

Rust imports follow standard Rust convention (grouped by category):
```rust
use std::collections::HashMap;
use axum::extract::State;
use crate::AppState;
use super::types::*;
```

**Path Aliases:**
- TypeScript: `@/*` maps to `./src/*` (defined in `web/tsconfig.json`)
- All internal imports in TypeScript use this alias

## Error Handling

**Patterns:**

**TypeScript/React:**
- **API errors:** Custom `ApiError` class in `lib/api.ts` with `code` and message properties
- **Try-catch in async contexts:** Used in mutations and API calls
  - Error handler wraps with `toastError()` for user feedback
  - Example: `useMutation` hook catches errors and displays them via toast notifications
- **Fallback values:** Components use optional chaining and nullish coalescing
  - `connections.find((s) => s.name === connectionName) ?? null`
  - Default props with `= []` or `= false` pattern

**Rust:**
- **Result-based error handling:** Pervasive use of `Result<T, E>` throughout the codebase
- **Error response format:** Standardized via `ErrorEnvelope` and `ErrorDetail` structs in `crate::job::types`
- **HTTP error responses:** `error_response()` function in `routes/mod.rs` creates consistent JSON responses
- **Middleware errors:** API key authentication middleware returns early with error response (no panic)
- **Test assertions:** Comprehensive assertions with detailed messages:
  ```rust
  assert!(
      !join_op.fields.is_empty(),
      "join operation fields are empty — frontend cannot create edges"
  );
  ```

## Logging

**Framework:**
- **TypeScript:** Native `console` object (no wrapper framework detected)
- **Rust:** `tracing` crate (0.1) with `tracing-subscriber` for structured logging
  - JSON output configured in `main.rs`
  - Environment filtering via `RUST_LOG` env var

**Patterns:**

**TypeScript:**
- No logging detected in web/frontend code
- Error display via toast notifications (`sonner` library)

**Rust:**
- Structured logging with tracing macros:
  ```rust
  info!("Server started");
  warn!("KEASY_SECRET_KEY is not set — secrets will be stored unencrypted");
  ```
- JSON log format for production readiness
- Log level controlled via `RUST_LOG` environment variable

## Comments

**When to Comment:**
- **TypeScript:**
  - Comments used selectively for complex logic and context
  - JSDoc/TSDoc rare in observed code
  - Inline comments explain "why" not "what"
- **Rust:**
  - Comments explain test purpose and complex algorithm behavior
  - Example from test: `/// Verifies every condition the frontend needs to draw edges from`
  - Implementation comments explain non-obvious logic

**Documentation:**
- **TypeScript:** No JSDoc/TSDoc pattern observed
- **Rust:** Standard Rust doc comments with `///` for public items, but minimal in observed files

## Function Design

**Size:**
- **TypeScript:** Utility functions are small and focused
  - `cn()` - 2 lines
  - `hasRunningJobs()` - 3 lines
  - `formatSize()` - 3 lines
  - Custom hooks: 10-20 lines typical
  - Components: 40-250 lines depending on complexity
- **Rust:** Functions range from 5 lines (helpers) to 40+ lines for complex extraction logic

**Parameters:**
- **TypeScript:**
  - Prefer object/record parameters for multiple options
  - Example: `ConnectionCompletion` function takes `connections`, `providers`, `fileCache` as separate params
  - Props passed as object destructuring in component signatures
  - Callback type: `fn: (input: T) => Promise<void>` in `useMutation`
- **Rust:**
  - References preferred over owned values when not modifying
  - Generic type parameters for flexibility (e.g., `ProgramQuery`)
  - Pattern matching for exhaustive handling

**Return Values:**
- **TypeScript:**
  - Implicit returns in single-expression functions
  - Objects/tuples for multiple return values
  - Promises for async operations
  - Type-annotated return types on public functions
- **Rust:**
  - Result-based returns for fallible operations
  - Option types for nullable values
  - Explicit type annotations on all public functions

## Module Design

**Exports:**

**TypeScript:**
- **Named exports:** Standard for utilities, components, types
  ```typescript
  export function cn(...inputs: ClassValue[]) { ... }
  export function useMutation<T = void>(fn: ...) { ... }
  ```
- **Default exports:** Used for page components and layout components
  ```typescript
  export default function RootLayout({ children }) { ... }
  ```
- **Type exports:** Declared with `export type` or `export interface`
  ```typescript
  export interface CodeEditorProps { ... }
  export type JobStatus = "draft" | "pending" | ...
  ```

**Rust:**
- **Public modules:** Declared with `pub mod module_name;`
- **Public items:** Marked with `pub` keyword
- **Re-exports:** Not observed in codebase
- **Module aggregation:** Parent `mod.rs` declares sub-modules and re-exports public items

**Barrel Files:**
- **TypeScript:** Not observed in web frontend code
- **Rust:** `mod.rs` files act as module entry points (standard Rust pattern)
  - Example: `routes/mod.rs` exports all route sub-modules

## Performance Considerations

**Memoization:**
- React `useCallback` used for expensive computations and callback stability
  - `createExtensions` callback in `CodeEditor` component
  - Dependency arrays carefully specified to avoid unnecessary recalculations

**Caching:**
- **TypeScript:** File cache as ref in component: `fileCacheRef.current = new Map<string, FileEntry[]>()`
- **Rust:** LRU cache for RDF graphs: `OutputCache` wraps `lru::LruCache`

---

*Convention analysis: 2026-02-26*
