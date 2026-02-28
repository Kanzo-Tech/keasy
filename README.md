# Keasy

Gaia-X dataspace management platform — connect data, build catalogs, verify compliance.

Built with Rust, Next.js, Keycloak, and Docker.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
- 8 GB RAM recommended (Keycloak + Rust compilation)

## Quick Start

```bash
git clone <repo-url> && cd keasy
make setup        # creates .env, builds images, starts everything
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to Keycloak login.

## Demo Credentials

| Email | Password | Role | Organization | Access |
|-------|----------|------|-------------|--------|
| `admin@keasy.dev` | `admin` | Promotor admin | Keasy | Connections, jobs, catalog, cloud accounts |
| `user@keasy.dev` | `user` | Participant admin | ACME Corp | Connections, jobs, cloud accounts |

## Architecture

```
Browser :3000
  └─ Caddy (reverse proxy)
       ├─ /v1/*   → Server :8080 (Rust/Axum API)
       ├─ /auth/* → Keycloak :8080 (OIDC identity)
       └─ /*      → Web :3000 (Next.js frontend)

Server → SQLite (app data)
       → Keycloak Admin API (user management)
       → WaltID Verifier :7003 (credential verification)

Keycloak → PostgreSQL (identity data)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js, React, shadcn/ui, TailwindCSS |
| Backend | Rust, Axum, SQLite |
| Identity | Keycloak (OIDC) |
| Reverse Proxy | Caddy |
| Credentials | WaltID Verifier |

## Development

```bash
make dev              # start dev environment with hot reload
make logs-server      # tail server logs
make logs-web         # tail web logs
make seed             # reset database with fresh demo data
make shell-server     # interactive shell in server container
make shell-web        # interactive shell in web container
```

- Editing `web/src/` triggers instant HMR in the browser
- Editing `server/src/` triggers cargo-watch recompilation and server restart

## Make Targets

| Target | Description |
|--------|-------------|
| `make help` | Show all available targets |
| `make setup` | First-time setup: create .env, build, start |
| `make dev` | Start dev environment (hot reload + demo data) |
| `make down` | Stop all services |
| `make prod` | Start with production builds (local test) |
| `make build` | Build production images without starting |
| `make logs` | Tail all service logs |
| `make logs-<svc>` | Tail logs for one service |
| `make restart` | Restart all services |
| `make restart-<svc>` | Restart one service |
| `make clean` | Nuclear reset: remove containers, volumes, images |
| `make seed` | Re-seed: wipe app data, restart server |
| `make shell-<svc>` | Open shell in container |
| `make ps` | Show running services |

## Project Structure

```
keasy/
├── infra/                          # Infrastructure configs
│   ├── caddy/Caddyfile             #   reverse proxy routing
│   ├── keycloak/realm-import/      #   OIDC realm + demo users
│   └── waltid/config/              #   credential verifier
├── server/                         # Rust API server
│   ├── Dockerfile                  #   production (multi-stage, slim)
│   ├── Dockerfile.dev              #   development (cargo-watch)
│   └── src/
├── web/                            # Next.js frontend
│   ├── Dockerfile                  #   production (standalone)
│   ├── Dockerfile.dev              #   development (HMR)
│   └── src/
├── docker-compose.yml              # Base: all services, shared config
├── docker-compose.dev.yml          # Dev overlay: hot reload, seed
├── docker-compose.prod.yml         # Prod overlay: optimized builds
├── Makefile                        # Task runner
└── .env.example                    # Environment template
```

## Docker Compose Layering

The compose setup uses a base + overlay pattern:

- **`docker-compose.yml`** — defines all services, networks, volumes, and shared environment. Never used alone.
- **`docker-compose.dev.yml`** — adds hot reload (cargo-watch, Next.js HMR), dev seed data, relaxed healthchecks, and volume mounts for source code.
- **`docker-compose.prod.yml`** — uses optimized multi-stage builds, no seed data, and strict healthchecks.

```bash
# Dev (via Makefile)
make dev

# Production (via Makefile)
make prod

# Manual
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KEASY_SECRET_KEY` | Encryption key for stored secrets | `change-me-in-production` |
| `KC_DB_PASSWORD` | Keycloak PostgreSQL password | `changeme` |
| `KC_ADMIN_PASSWORD` | Keycloak admin console password | `changeme` |
| `KEASY_OIDC_CLIENT_SECRET` | OIDC client secret (shared with Keycloak) | `keasy-dev-secret` |

## Production

Test production builds locally:

```bash
make prod         # build and run production images
make build        # build images without starting
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Keycloak slow to start | Wait for healthcheck (up to 60s on first start) |
| Server compilation slow | First Rust build caches deps (~2-5 min), subsequent builds are fast |
| Hot reload not working | Check volume mounts; try `make restart-web` or `make restart-server` |
| Port 3000 in use | Run `make down` first, or change port in docker-compose.yml |
| Database issues | Run `make seed` to wipe and re-create demo data |
