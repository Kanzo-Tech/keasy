# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5.x - Web frontend (Next.js application)
- Rust 1.90.0 - Backend server (Axum-based HTTP API)

**Secondary:**
- JavaScript - Next.js configuration and build scripts
- CSS - Styling with Tailwind CSS

## Runtime

**Environment:**
- Node.js - Web frontend development and build
- Rust async runtime - Server uses Tokio 1.x for async execution
- Linux containers - Docker deployment for both services

**Package Manager:**
- npm - Frontend package management
- Cargo - Rust backend package management
- Lockfile: `web/package.json.lock` exists, Rust uses `Cargo.lock`

## Frameworks

**Core Frontend:**
- Next.js 16.1.6 - Full-stack React framework with SSR/SSG
- React 19.2.3 - UI component library
- Tailwind CSS 4.x - Utility-first CSS framework

**Core Backend:**
- Axum 0.8 - Rust web framework (built on Tower)
- Tokio 1.x - Async runtime with full features
- Reqwest 0.12 - HTTP client library

**UI Components:**
- Radix UI 1.4.3 - Headless UI component library
- shadcn/ui - Component compositions (via Tailwind + Radix UI)
- class-variance-authority 0.7.1 - CSS class composition
- Lucide React 0.564.0 - Icon library
- Sonner 2.0.7 - Toast notifications

**Data & Validation:**
- RDF/Oxigraph stack - RDF graph database and processing
  - oxrdf 0.3.3 - RDF serialization
  - oxigraph 0.5 - RDF graph store
  - shex_validation, shacl_validation - Shape validation frameworks

**Visualization:**
- CodeMirror 6.x - Code editor with syntax highlighting
- @xyflow/react 12.10.1 - Node-based graph visualization
- react-force-graph-2d 1.29.1 - Force-directed graph rendering
- Recharts 2.15.4 - React charting library

**Data Fetching:**
- SWR 2.4.0 - React hook for data fetching and caching
- Fetch API - Native HTTP client (no Axios/Fetch libraries)

**Markdown:**
- react-markdown 10.1.0 - Markdown rendering
- remark-gfm 4.0.1 - GitHub-flavored markdown plugin

**Build Tools & Dev:**
- TypeScript 5.x - Type checking
- ESLint 9.x - Code linting (with Next.js config)
- Tailwind CSS PostCSS plugin - CSS compilation
- shadcn CLI 3.8.4 - Component generation
- Next.js ESLint config - React/Next.js linting rules

## Key Dependencies

**Critical:**
- Tokio 1.x - Async runtime for backend job execution
- Axum 0.8 - Web framework routing and middleware
- Oxigraph 0.5 - RDF graph processing and queries
- fossil-lang (git dependency) - Custom pipeline DSL integration
- SWR 2.4.0 - Frontend data fetching and caching

**Infrastructure:**
- object_store 0.12 - Cloud storage abstraction with AWS/GCP/Azure
- Rusqlite 0.32 - SQLite database with bundled library
- Tower HTTP - CORS and distributed tracing middleware
- Tracing/tracing-subscriber - Structured logging with JSON output

**Security:**
- AES-GCM 0.10 - Encryption for stored credentials
- PBKDF2 0.12 - Key derivation for secret encryption
- Secrecy 0.10 - Memory-safe secret handling
- Reqwest with rustls - TLS support without system OpenSSL

**Serialization:**
- Serde 1.x - Serialization framework
- Serde JSON 1.x - JSON handling

**Utilities:**
- UUID 1.x with v4 feature - UUID generation
- Jiff 0.2 - Date/time handling
- URL 2.x - URL parsing
- Regex 1.x - Pattern matching
- clsx 2.1.1 - Conditional CSS class composition
- tailwind-merge 3.4.0 - Tailwind class conflict resolution

## Configuration

**Environment Variables - Frontend:**
- `KEASY_API_URL` - Backend API base URL
- `KEASY_API_KEY` - API authentication key

**Environment Variables - Backend:**
- `KEASY_BIND_ADDR` - Server bind address (default: 0.0.0.0:8080)
- `KEASY_API_KEY` - API key for authentication (required)
- `KEASY_MAX_CONCURRENT_JOBS` - Job execution concurrency (default: 4)
- `KEASY_JOB_TIMEOUT_SECS` - Job timeout in seconds (default: 300)
- `KEASY_SHUTDOWN_GRACE_SECS` - Graceful shutdown timeout (default: 30)
- `KEASY_DATA_DIR` - Data directory path (default: ./data)
- `KEASY_SECRET_KEY` - Encryption key for stored credentials (optional)
- `KEASY_CACHE_CAPACITY` - Output RDF cache size (default: 1)
- `KEASY_CORS_ORIGINS` - CORS allowed origins (comma-separated)
- `RUST_LOG` - Tracing log level

**Build Config:**
- `web/tsconfig.json` - TypeScript compiler options with path aliases (`@/*`)
- `web/next.config.ts` - Next.js configuration (standalone output)
- `web/eslint.config.mjs` - ESLint configuration with Next.js rules
- `server/Cargo.toml` - Rust project manifest with dependencies
- `server/Dockerfile` - Multi-stage Docker build with Rust 1.90 and Debian runtime
- `docker-compose.yml` - Local development orchestration

## Platform Requirements

**Development:**
- Node.js 18+ - Frontend development
- Rust 1.90.0 - Backend compilation
- Docker & Docker Compose - Containerization and local deployment

**Production:**
- Deployment target: Linux containers (Docker)
- Database: SQLite with WAL mode
- Architecture: Two-service deployment (Next.js frontend, Rust backend)
- HTTP/REST API communication

---

*Stack analysis: 2026-02-26*
