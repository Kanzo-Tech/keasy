# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
keasy/
├── server/                  # Rust backend server
│   ├── src/
│   │   ├── main.rs         # Server entry point, initialization
│   │   ├── config.rs       # ServerConfig from environment
│   │   ├── middleware/     # Auth, middleware stack
│   │   ├── routes/         # HTTP endpoint handlers (Axum)
│   │   ├── db/             # SQLite database and schema
│   │   ├── job/            # Job execution and management
│   │   ├── pipeline/       # Pipeline extraction from Fossil
│   │   ├── graph/          # RDF graph operations
│   │   ├── dcat/           # DCAT catalog generation
│   │   ├── cloud/          # Cloud storage integration
│   │   ├── script/         # Fossil script validation
│   │   ├── settings/       # Organization and preferences
│   │   ├── validation/     # SHACL/ShEx validation
│   │   ├── ai/             # LLM provider integration
│   │   ├── rdf/            # RDF format utilities
│   │   └── crypto/         # Encryption/decryption utilities
│   ├── Cargo.toml          # Rust dependencies
│   └── target/             # Build artifacts (gitignored)
│
├── web/                     # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx           # Root layout, providers
│   │   │   ├── globals.css          # Global styles
│   │   │   ├── (auth)/              # Auth route group
│   │   │   ├── (main)/              # Protected route group with sidebar
│   │   │   │   ├── page.tsx        # Dashboard
│   │   │   │   ├── layout.tsx      # Main layout with sidebar
│   │   │   │   ├── (data)/         # Data management routes
│   │   │   │   ├── settings/       # Settings pages
│   │   │   │   └── ...
│   │   │   └── api/                 # API routes (proxy/local handlers)
│   │   │       ├── jobs/
│   │   │       ├── connections/
│   │   │       ├── cloud-accounts/
│   │   │       ├── settings/
│   │   │       ├── graph/
│   │   │       ├── validate/
│   │   │       ├── conversations/
│   │   │       └── ...
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn/ui components
│   │   │   ├── job-detail/          # Job visualization components
│   │   │   ├── pipeline-flow/       # Pipeline diagram
│   │   │   ├── settings/            # Settings forms
│   │   │   ├── app-sidebar.tsx      # Main navigation sidebar
│   │   │   ├── dynamic-breadcrumbs.tsx
│   │   │   ├── nav-main.tsx
│   │   │   ├── nav-user.tsx
│   │   │   ├── team-switcher.tsx
│   │   │   ├── theme-provider.tsx
│   │   │   ├── swr-provider.tsx
│   │   │   └── ...
│   │   ├── hooks/
│   │   │   └── use-mobile.ts        # Responsive breakpoint hook
│   │   └── lib/
│   │       ├── api.ts               # Fetch client with typed methods
│   │       ├── types.ts             # TypeScript interfaces (matching server)
│   │       ├── utils.ts             # Utility functions
│   │       ├── formatters.ts        # Data formatting
│   │       ├── error-codes.ts       # Error code mapping
│   │       ├── graph-rendering.ts   # Graph visualization logic
│   │       ├── dashboard-store.ts   # Client state management
│   │       ├── ai-providers.ts      # AI provider list
│   │       ├── route-config.ts      # Route definitions
│   │       └── ...
│   ├── public/                      # Static assets
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── next.config.js
│   └── node_modules/                # Dependencies (gitignored)
│
└── .planning/
    └── codebase/                    # This documentation
        ├── ARCHITECTURE.md
        ├── STRUCTURE.md
        ├── CONVENTIONS.md
        ├── TESTING.md
        ├── STACK.md
        ├── INTEGRATIONS.md
        └── CONCERNS.md
```

## Directory Purposes

**server/src/:**
- **main.rs**: Application bootstrap. Initializes config, database, job runner, tracing. Sets up Axum router and starts HTTP listener.
- **config.rs**: Loads `ServerConfig` from environment variables (port, data_dir, secret_key, etc.).
- **middleware/**: Cross-cutting HTTP middleware. Currently: API key authentication via Bearer token.
- **routes/**: HTTP endpoint handlers organized by domain (jobs, graph, settings, conversations, etc.). Each module exports handler functions passed to Axum router.
- **db/**: SQLite database wrapper. Contains schema definition, migrations, and CRUD operations organized by entity (jobs, cloud_accounts, connections, conversations, settings).
- **job/**: Job lifecycle management. Types define Job and JobStatus. Runner handles async execution with semaphore concurrency control. Errors classify failures.
- **pipeline/**: Extracts pipeline structure (inputs, operations, outputs) from Fossil AST. ProgramQuery navigates type information.
- **graph/**: RDF operations. RdfGraph wraps oxigraph Store. Methods for insert, query, convert to JSON/GraphML/Turtle, search, and expand.
- **dcat/**: DCAT catalog generation. Extract DCAT metadata from job results. Generator builds catalog triples.
- **cloud/**: Cloud storage abstraction. Resolver maps cloud accounts to object_store readers. Reads data from S3, GCS, Azure, or local filesystem.
- **script/**: Fossil language integration. Validates scripts before execution. Rewrites scripts for execution context.
- **settings/**: Organization settings (publisher metadata), user preferences, AI provider configs stored and retrieved from database.
- **validation/**: SHACL/ShEx validation against data shapes. Used to validate job output against declared shape.
- **ai/**: LLM provider clients. Currently supports multiple providers (OpenAI, Anthropic, etc.). Client makes API calls.
- **rdf/**: RDF format utilities. Handles serialization/deserialization (Turtle, JSON-LD, RDF/XML, N-Triples).
- **crypto/**: Encryption/decryption for stored secrets using AES-GCM. PBKDF2 key derivation.

**web/src/app/:**
- **layout.tsx**: Root layout. Wraps all pages with providers (theme, SWR, tooltip, toast, preferences).
- **globals.css**: Global Tailwind CSS, custom properties, scrollbar styling.
- **(auth)/**: Route group for unauthenticated pages (future auth flow).
- **(main)/**: Route group for main application. Protected by middleware pattern. Contains sidebar layout.
  - **page.tsx**: Dashboard showing readiness status and recent activity.
  - **layout.tsx**: Main layout with sidebar, breadcrumbs, and content area.
  - **(data)/**: Data management routes for jobs and connections.
  - **settings/**: Settings pages for org, preferences, AI providers, cloud accounts.
- **api/**: Next.js API routes. Each subdirectory mirrors REST structure (jobs, connections, etc.). Routes proxy to Rust server or handle local logic.

**web/src/components/:**
- **ui/**: shadcn/ui base components (button, card, dialog, input, etc.). Generated from Radix UI.
- **job-detail/**: Components for job visualization (overview, validation results, discovery view, catalog view).
- **pipeline-flow/**: Pipeline diagram visualization using react-force-graph-2d.
- **settings/**: Forms for org settings, preferences, AI providers, cloud accounts.
- **app-sidebar.tsx**: Main navigation sidebar. Uses shadcn/ui Sidebar with navigation items.
- **dynamic-breadcrumbs.tsx**: Breadcrumb navigation based on current route.
- **nav-main.tsx**: Primary navigation links.
- **nav-user.tsx**: User profile section in sidebar.
- **team-switcher.tsx**: Organization selector (future).
- **theme-provider.tsx**: next-themes wrapper for light/dark mode toggle.
- **swr-provider.tsx**: SWR client configuration (baseURL, fetcher, error handling).

**web/src/lib/:**
- **api.ts**: Typed fetch client. Functions for each endpoint (fetchJobs, createJob, updateJob, etc.). Handles request/response transformation and error mapping.
- **types.ts**: TypeScript interfaces matching Rust server types. Job, Connection, Settings, GraphData, etc.
- **utils.ts**: Utility functions (hasRunningJobs, cn for class merging, etc.).
- **formatters.ts**: Format dates, durations, data sizes, SPARQL queries.
- **error-codes.ts**: Map error codes to user-friendly messages.
- **graph-rendering.ts**: Graph visualization logic (node layout, styling, forces).
- **dashboard-store.ts**: Client-side store for dashboard state (selected job, filters).
- **ai-providers.ts**: List of supported AI providers with metadata.
- **route-config.ts**: Route definitions and navigation config.

## Key File Locations

**Entry Points:**
- `server/src/main.rs`: Server application entry, initialization, HTTP listener startup
- `web/src/app/layout.tsx`: Root React component, provider setup
- `web/src/app/(main)/page.tsx`: Dashboard landing page
- `web/src/app/(main)/layout.tsx`: Main app layout with sidebar

**Configuration:**
- `server/src/config.rs`: Server configuration from environment
- `server/Cargo.toml`: Rust dependencies and build config
- `web/package.json`: Node dependencies and scripts
- `web/tsconfig.json`: TypeScript compiler options
- `web/tailwind.config.ts`: Tailwind CSS theme and customization
- `web/next.config.js`: Next.js build and runtime config

**Core Logic:**
- `server/src/job/runner.rs`: Background job execution with concurrency control
- `server/src/pipeline/extract.rs`: Extract pipeline metadata from Fossil AST
- `server/src/graph/rdf_graph.rs`: In-memory RDF triple store operations
- `server/src/dcat/generator.rs`: DCAT catalog generation
- `server/src/db/mod.rs`: Database initialization and schema
- `web/src/lib/api.ts`: REST client with typed methods

**Testing:**
- `server/src/**/*.rs` - Tests inline with `#[cfg(test)]` modules
- `web/**/*.test.ts` or `web/**/*.spec.ts` - Jest/Vitest test files (if present)

## Naming Conventions

**Files:**
- Rust: snake_case (e.g., `job_runner.rs`, `rdf_graph.rs`)
- TypeScript/TSX: kebab-case for components (e.g., `app-sidebar.tsx`), snake_case for utilities (e.g., `api.ts`)
- Test files: Append `.test.ts` or `.spec.ts` to module name

**Directories:**
- Rust: plural for modules with multiple files (e.g., `routes/`, `db/`), singular for single-file modules
- TypeScript: Feature-based grouping (e.g., `components/job-detail/`, `app/(main)/`)
- API routes: Mirror REST structure (e.g., `/api/jobs/[id]/` maps to `web/src/app/api/jobs/[id]/`)

**Functions:**
- Rust: snake_case, verb-noun pattern (e.g., `insert_triples()`, `extract_summary()`)
- TypeScript: camelCase, verb-noun pattern (e.g., `fetchJobs()`, `validateScript()`)

**Types:**
- Rust: PascalCase (e.g., `JobRunner`, `RdfGraph`)
- TypeScript: PascalCase interfaces/types (e.g., `Job`, `ValidationResult`)

**Constants:**
- Rust: SCREAMING_SNAKE_CASE (e.g., `MAX_CONCURRENT_JOBS`)
- TypeScript: camelCase (e.g., `defaultTimeout`)

## Where to Add New Code

**New Feature:**
- If REST endpoint: Create route in `server/src/routes/{domain}/` and API method in `web/src/lib/api.ts`
- If page: Create file in `web/src/app/(main)/{feature}/page.tsx` using App Router conventions
- If reusable component: Add to `web/src/components/` in feature subdirectory
- If business logic: Add module to appropriate `server/src/` subdirectory

**New Component/Module:**
- React component: `web/src/components/{feature}/{component}.tsx` (use shadcn/ui building blocks)
- Rust module: Follow existing pattern in `server/src/{domain}/mod.rs`, export public items
- API client method: Add to appropriate section in `web/src/lib/api.ts` with typed generics

**Utilities:**
- Shared helpers: `web/src/lib/utils.ts` or feature-specific file in `lib/`
- Rust utilities: Create module in `server/src/` (e.g., `server/src/rdf/utils.rs`)
- Formatters: Add to `web/src/lib/formatters.ts` or feature-specific formatter

**Styling:**
- Global styles: `web/src/app/globals.css`
- Component styles: Inline Tailwind classes (no separate CSS files)
- Theme colors: Define in `web/tailwind.config.ts` custom properties

## Special Directories

**server/target/:**
- Purpose: Rust build artifacts
- Generated: Yes (cargo build)
- Committed: No (gitignored)
- Contains: debug/, release/, doc/ subdirectories with compiled binaries and docs

**web/node_modules/:**
- Purpose: Node package dependencies
- Generated: Yes (npm install)
- Committed: No (gitignored)
- Install: `npm install` from `web/package.json`

**web/.next/:**
- Purpose: Next.js build output and cache
- Generated: Yes (npm run build or dev server)
- Committed: No (gitignored)
- Clean: `rm -rf .next` to force rebuild

**server/src/db/schema.rs:**
- Purpose: SQLite table definitions and migrations
- Structure: Each table (jobs, connections, cloud_accounts, etc.) has CREATE TABLE and schema version tracking
- Modify carefully: Migrations must be backward compatible

**web/src/components/ui/:**
- Purpose: shadcn/ui component library
- Pattern: Generated from Radix UI, customized with Tailwind
- Modify: Update classes for styling, structure usually fixed
- Don't move: Paths referenced in imports across codebase

---

*Structure analysis: 2026-02-26*
