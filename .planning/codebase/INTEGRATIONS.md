# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**AI Providers:**
- Anthropic (Claude) - LLM integration for natural language queries
  - SDK/Client: Reqwest HTTP client
  - Auth: API key stored in `AiSettings` (encrypted storage)
  - Models: Default `claude-sonnet-4-20250514`
  - Endpoint: `https://api.anthropic.com/v1/messages` (inferred)
  - Location: `server/src/ai/client.rs` - ask_llm() function

- OpenAI (ChatGPT) - Alternative LLM provider
  - SDK/Client: Reqwest HTTP client
  - Auth: API key stored in `AiSettings`
  - Models: Default `gpt-4o`
  - Endpoint: `https://api.openai.com/v1/chat/completions` (inferred)
  - Location: `server/src/ai/client.rs` - ask_openai() function

**Feature Location:**
- Web UI configuration: `web/src/lib/ai-providers.ts` - Defines available AI providers
- Backend implementation: `server/src/ai/client.rs` - HTTP requests to AI APIs
- API routes: `server/src/routes/settings.rs` - AI provider configuration endpoints

## Data Storage

**Databases:**
- SQLite 3.x (Bundled with rusqlite)
  - Connection: SQLite database file at `KEASY_DATA_DIR/keasy.db`
  - Client: Rusqlite 0.32 (synchronous, with bundled SQLite library)
  - Configuration: WAL (Write-Ahead Logging) mode with foreign keys enabled
  - Schema: Located in `server/src/db/schema.rs` - Manages migrations
  - Tables managed: jobs, conversations, cloud_accounts, connections, settings, secrets

- RDF Graph Store (In-Memory + Optional Persistence)
  - Oxigraph 0.5 - RDF triple store
  - Jiff 0.2 - Date/time handling
  - Used for data validation and transformation pipeline processing
  - Loaded from job outputs and catalogs
  - Location: `server/src/graph/rdf_graph.rs`

**File Storage:**
- Local filesystem access via path arguments in jobs
- Cloud provider integration via object_store
  - See Cloud Storage section below

**Caching:**
- In-Memory LRU Cache (Rust lru 0.12)
  - Caches RDF graph outputs to avoid reprocessing
  - Size configurable via `KEASY_CACHE_CAPACITY` (default: 1)
  - Location: `server/src/main.rs` - OutputCache struct

## Authentication & Identity

**API Authentication:**
- API Key-based authentication
  - Passed via HTTP requests from frontend to backend
  - Configured via `KEASY_API_KEY` environment variable
  - Middleware: `server/src/middleware/auth.rs` - api_key_auth middleware
  - Implementation: Header-based authentication (likely Authorization header)

**AI Provider Credentials Storage:**
- Encrypted storage for API keys
  - Encryption: AES-256-GCM (aes-gcm 0.10)
  - Key derivation: PBKDF2 (pbkdf2 0.12 with HMAC)
  - Secret handling: Secrecy crate (0.10) for memory-safe operations
  - Location: `server/src/db/secrets.rs` - Secure credential storage
  - Verification: Database verifies encryption key on startup (config.rs)

## Monitoring & Observability

**Logging:**
- Structured logging with JSON output
  - Framework: Tracing 0.1 and tracing-subscriber 0.3
  - Format: JSON logs (via json feature)
  - Log level: Configured via `RUST_LOG` environment variable
  - Location: `server/src/main.rs` - Logging initialization
  - Includes: Request tracing via Tower HTTP TraceLayer

**Error Tracking:**
- Custom error handling via ApiError
  - Error format: JSON with error code and message
  - Location: `web/src/lib/api.ts` - ApiError class
  - Error responses: `server/src/routes/mod.rs` - error_response() function

**Request Tracing:**
- Tower HTTP TraceLayer for HTTP tracing
- Accessible via structured logging

## Cloud Storage Integration

**Cloud Providers:**
- AWS S3
  - SDK: object_store 0.12 with "aws" feature
  - Builder: AmazonS3Builder
  - Config keys: Credentials mapped from environment variables
  - Location: `server/src/cloud/mod.rs` - build_store() function

- Google Cloud Storage (GCP)
  - SDK: object_store 0.12 with "gcp" feature
  - Builder: GoogleCloudStorageBuilder
  - Config keys: Credentials mapped from environment variables

- Microsoft Azure Blob Storage
  - SDK: object_store 0.12 with "azure" feature
  - Builder: MicrosoftAzureBuilder
  - Config keys: Credentials mapped from environment variables

**Schema Configuration:**
- Cloud provider schemes defined in `server/src/settings/schema.rs`
- Credentials stored per cloud account via `CloudAccountSummary` type
- Location: `server/src/routes/cloud_accounts.rs` - Cloud account management endpoints
- Database: `server/src/db/cloud_accounts.rs` - Credential persistence

**Usage:**
- File/data access via URLs (s3://, gs://, az:// schemes)
- Resolver: `server/src/cloud/resolver.rs` - URL resolution
- Reader: `server/src/cloud/reader.rs` - Stream-based file reading

## CI/CD & Deployment

**Hosting:**
- Docker containerization for both frontend and backend
- Docker Compose for local development
- Deployment: Container-based (Linux)

**Build Pipeline:**
- Frontend: Next.js build with standalone output (`output: "standalone"`)
- Backend: Multi-stage Rust Docker build with cache optimization
  - Builder stage: Rust 1.90 on Debian Bookworm
  - Runtime stage: Debian Bookworm Slim with curl for healthchecks

## Web Framework Configuration

**CORS:**
- Tower HTTP CorsLayer integration
- Origins configurable via `KEASY_CORS_ORIGINS` environment variable
- Location: `server/src/routes/mod.rs` - CORS configuration

**Middleware:**
- API Key authentication via middleware
- Request tracing via Tower HTTP TraceLayer
- CORS handling via Tower HTTP CorsLayer

## Webhooks & Callbacks

**Incoming Webhooks:**
- Not detected

**Outgoing Webhooks:**
- Not detected

---

*Integration audit: 2026-02-26*
