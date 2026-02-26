# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Client-Server Monorepo with Async Task-Based Processing

This is a full-stack data pipeline application split into two main systems:
- **Server (Rust)**: Async HTTP API with background job execution, RDF graph management, and Fossil language script execution
- **Web (Next.js)**: React dashboard with real-time job monitoring, pipeline visualization, and RDF graph exploration

**Key Characteristics:**
- Event-driven job execution with semaphore-based concurrency control
- RDF graph as central data abstraction for catalog generation and data discovery
- Bidirectional API communication: server serves REST endpoints, web calls via `fetch()`
- Fossil language as domain-specific language for pipeline scripts
- Database persistence (SQLite) for job state, cloud accounts, and settings

## Layers

**Presentation Layer:**
- Purpose: Render UI components and manage user interactions
- Location: `web/src/app/`, `web/src/components/`
- Contains: Next.js page components, React UI components (shadcn/ui), hooks
- Depends on: API client layer, utility functions, state management
- Used by: End users accessing the web dashboard

**API Route Layer:**
- Purpose: Handle HTTP requests from frontend, delegate to business logic
- Location: `web/src/app/api/` (Next.js route handlers) and `server/src/routes/` (Axum routes)
- Contains: Endpoint handlers, request/response transformations
- Depends on: Core business logic (jobs, graphs, settings, etc.)
- Used by: Web client making fetch requests

**Business Logic Layer:**
- Purpose: Core domain logic for jobs, pipelines, RDF graphs, and settings
- Location: `server/src/job/`, `server/src/pipeline/`, `server/src/graph/`, `server/src/settings/`, `server/src/dcat/`
- Contains: Job lifecycle management, pipeline extraction, RDF operations, DCAT catalog generation
- Depends on: Data access layer, Fossil language, RDF libraries (oxigraph, oxrdf)
- Used by: Route handlers, background job execution

**Data Access Layer:**
- Purpose: Database interaction and cloud provider connectivity
- Location: `server/src/db/`, `server/src/cloud/`
- Contains: SQLite schema, CRUD operations, cloud storage abstraction (S3, GCS, Azure)
- Depends on: Database drivers (rusqlite), object_store library
- Used by: Business logic for persistence and external storage

**Infrastructure Layer:**
- Purpose: Cross-cutting concerns and configuration
- Location: `server/src/middleware/`, `server/src/config.rs`, `server/src/validation/`, `server/src/ai/`
- Contains: Authentication middleware, environment config, input validation, AI provider clients
- Depends on: External services (LLMs), cryptography libraries
- Used by: API routes and business logic

## Data Flow

**Job Execution Flow:**

1. User creates job via `POST /api/jobs` with Fossil script
2. Web API route calls `createJob()` from `lib/api.ts`
3. Server validates script using `script::validate()` from `server/src/script/`
4. Server extracts pipeline metadata using `pipeline::extract_summary()` from `server/src/pipeline/extract.rs`
5. Server stores job in SQLite via `db::jobs::create()` with initial "draft" status
6. Server returns job object to web client
7. User triggers execution via `POST /api/jobs/{id}` or automatic execution
8. Server spawns async task via `runner.spawn()` from `server/src/job/runner.rs`
9. Job runner acquires semaphore permit (concurrency control)
10. Fossil runtime executes script using cloud connections from `server/src/cloud/resolver.rs`
11. Pipeline produces RDF triples that are inserted into in-memory `RdfGraph` via `graph.insert_triples()`
12. If DCAT enabled, `dcat::generate_dcat_catalog()` creates catalog metadata
13. Results cached in `OutputCache` (LRU) for fast retrieval
14. Job status updated to "completed" or "failed"
15. Web polls `/api/jobs/{id}` via SWR and updates UI when status changes

**Graph Data Discovery Flow:**

1. User queries graph via `POST /api/graph/search` with search text
2. Server executes SPARQL on RdfGraph to find matching nodes
3. Results return as SearchResult[] with label and group
4. User expands node via `POST /api/graph/expand` with node ID
5. Server executes targeted SPARQL to get neighbors and triples
6. Graph visualization rendered using react-force-graph-2d or recharts
7. User interacts with tabular export via `POST /api/jobs/{id}/discover/chart`
8. Server executes aggregation SPARQL and returns TabularData

**Settings Propagation Flow:**

1. User updates org settings via `PUT /api/settings/organization`
2. Next.js route handler updates SQLite via `db::settings::org::update()`
3. Next.js route calls server endpoint with `SaveOrgSettingsRequest`
4. Server persists to its database for DCAT generation
5. Changes apply to next job execution automatically

**State Management:**

- **Server State**: `AppState` struct (in-memory) contains:
  - `db: Database` - SQLite connection pool
  - `runner: Arc<JobRunner>` - Background job executor
  - `catalog: Arc<RdfGraph>` - Unified RDF catalog
  - `output_cache: Arc<Mutex<OutputCache>>` - LRU cache for job outputs
  - `api_key: SecretString` - API authentication key

- **Web State**: Via SWR (client-side)
  - Fetches fresh data on component mount
  - Auto-refetches based on conditions (e.g., poll every 2s if jobs running)
  - Context providers manage theme, preferences, SWR config globally

## Key Abstractions

**RdfGraph:**
- Purpose: In-memory RDF triple store for catalog and discovery
- Examples: `server/src/graph/rdf_graph.rs`
- Pattern: Wrapper around oxigraph Store with methods for insert, query, clear, export
- Methods: `insert_triples()`, `evaluate_query()`, `get_graph()`, `export()`

**Job:**
- Purpose: Represents a pipeline execution unit
- Examples: `server/src/job/types.rs`, `web/src/lib/types.ts`
- Pattern: Serializable struct with status enum and metadata
- Fields: id, status, script, pipeline, error, timestamps, catalog

**Pipeline:**
- Purpose: Structured representation of data transformation workflow
- Examples: `server/src/pipeline/types.rs`
- Pattern: Extracted from Fossil AST, contains inputs, operations, outputs
- Abstraction: Hides Fossil language complexity from frontend

**Database:**
- Purpose: SQLite connection manager with schema and migrations
- Examples: `server/src/db/mod.rs`
- Pattern: Single connection with WAL mode, Arc<Mutex<>> for thread-safe sharing
- Methods: `open()`, migrate schema, transaction handling

**JobRunner:**
- Purpose: Async background job executor with concurrency control
- Examples: `server/src/job/runner.rs`
- Pattern: Semaphore-based queue with JoinSet for task tracking
- Manages: Job state transitions, timeout enforcement, DCAT generation

**CloudOutputResolver:**
- Purpose: Unified interface for reading data from cloud/local storage
- Examples: `server/src/cloud/resolver.rs`
- Pattern: Abstracts over object_store (S3, GCS, Azure) and local filesystem
- Used by: Fossil runtime to fetch input files

**ProgramQuery:**
- Purpose: Type-safe navigation of Fossil language AST after type-checking
- Examples: `server/src/pipeline/mod.rs`
- Pattern: Builder over IrProgram with helper methods for introspection
- Methods: `resolve_type_name()`, `resolve_fields()`, `lookup_fields_by_def()`

## Entry Points

**Server Main:**
- Location: `server/src/main.rs`
- Triggers: `cargo run` or container startup
- Responsibilities:
  - Initialize tracing subscriber for structured logging
  - Load `ServerConfig` from environment variables
  - Create SQLite database with schema migration
  - Verify encryption key for stored secrets
  - Build Axum router with middleware and routes
  - Start HTTP listener on configured port

**Web Entry:**
- Location: `web/src/app/layout.tsx` (root)
- Triggers: Browser navigation
- Responsibilities:
  - Initialize theme provider (light/dark mode)
  - Set up SWR provider for data fetching
  - Apply global fonts and CSS
  - Render layout structure with sidebar

**Authenticated Routes:**
- Location: `web/src/app/(main)/` - Protected by middleware pattern
- Flow: Sidebar navigation triggers Next.js route transition
- Pages: Dashboard, jobs list, job detail, settings

**API Routes:**
- Location: `web/src/app/api/**/route.ts` - Next.js API routes
- Pattern: Each route file exports GET/POST/PUT/DELETE handlers
- Proxy: Some routes proxy to Rust server, others handle local logic

## Error Handling

**Strategy:** Typed error envelopes with error codes for programmatic handling

**Patterns:**

- **Server (Rust)**:
  - `job::errors::JobError` - Structured with code and message
  - `classify_error()` - Categorizes runtime failures (timeout, validation, execution)
  - Error responses wrapped in `ErrorEnvelope` with HTTP status codes
  - Tracing logs all errors with context for debugging

- **Web (TypeScript)**:
  - `ApiError` class extends Error with `code` field (from `lib/api.ts`)
  - Thrown from `throwResponseError()` when non-2xx response
  - Caught by components and displayed via toast (via `toast-error.ts`)
  - Form validation errors shown inline (e.g., in job creation)

**Error Classification:**
- `ValidationError` - Script or input validation failed
- `ExecutionError` - Fossil runtime failed during execution
- `TimeoutError` - Job exceeded timeout threshold
- `InternalError` - Unexpected server error
- `NotFound` - Resource doesn't exist

## Cross-Cutting Concerns

**Logging:**
- Server: Tracing library with JSON structured logging, configurable via `RUST_LOG` env var
- Examples: `server/src/main.rs` initializes with environment filter
- Web: Console logs in development, no structured logging in production

**Validation:**
- Server: `server/src/validation/` module for shape validation against SHACL/ShEx
- Pipeline validation: `script::validate()` checks Fossil script structure
- Input validation: Fields checked before database insertion

**Authentication:**
- Server: API key authentication via `middleware/auth.rs`
- Flow: Request middleware extracts `Authorization: Bearer <api_key>` header
- Key stored in `AppState.api_key` as `SecretString`
- Web: No per-user auth (API key stored in env or Keasy config)

**Encryption:**
- Secrets at rest: Cloud account credentials encrypted with `KEASY_SECRET_KEY`
- Method: AES-GCM with PBKDF2 key derivation in `server/src/crypto/`
- Key stored: Set via `KEASY_SECRET_KEY` environment variable

---

*Architecture analysis: 2026-02-26*
