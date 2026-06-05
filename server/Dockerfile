# Release image for keasy-server. Build CONTEXT is the parent dir holding BOTH
# the keasy repo (`keasy/`) and the sibling `rmlext/` checkout, because:
#   1. keasy-server depends on `rmlext/crates/fossil-run-status` via a path dep
#      (`../../rmlext/...`), so rmlext must be in the build context.
#   2. keasy runs every job/catalog/providers call as a `fossil` subprocess — we
#      build that binary from rmlext here and ship it alongside the server.
# See docker-compose.prod.yml: `context: ..`, `dockerfile: keasy/server/Dockerfile`.

FROM rust:1.90-bookworm AS builder

# clang/libclang: DuckDB (bundled into the `fossil` binary) needs them to build.
RUN apt-get update && apt-get install -y --no-install-recommends \
    clang libclang-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# ── fossil binary (rmlext) ────────────────────────────────────────────────
# Heavy (bundled DuckDB, ~3-5 min cold). Built first so it caches across
# keasy-server source edits (rmlext changes far less often).
COPY rmlext /src/rmlext
RUN cargo build --release --manifest-path /src/rmlext/Cargo.toml -p fossil-cli -p fossil-mcp

# ── keasy-server ──────────────────────────────────────────────────────────
# Dep cache: build manifests with a dummy main, then swap in real source. The
# `fossil-run-status` path dep resolves to /src/rmlext (../../rmlext from
# /src/keasy/server) — rmlext is already present above.
# keasy-keycloak is a path dep at ../keycloak — copy it before the dep cache.
COPY keasy/keycloak /src/keasy/keycloak
WORKDIR /src/keasy/server
COPY keasy/server/Cargo.toml keasy/server/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY keasy/server/src ./src
RUN touch src/main.rs && cargo build --release

# ── runtime ───────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# DuckDB (inside `fossil`) looks for CA certs at the CentOS/RHEL path when
# fetching httpfs/azure extensions + reading cloud sources; symlink it.
RUN mkdir -p /etc/pki/tls/certs \
    && ln -s /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt

RUN useradd -r -s /bin/false keasy \
    && mkdir -p /var/lib/keasy \
    && chown keasy: /var/lib/keasy
USER keasy

COPY --from=builder /src/keasy/server/target/release/keasy-server /usr/local/bin/keasy-server
# The fossil subprocess keasy invokes for every run/catalog/providers call.
COPY --from=builder /src/rmlext/target/release/fossil /usr/local/bin/fossil
COPY --from=builder /src/rmlext/target/release/fossil-mcp /usr/local/bin/fossil-mcp
ENV FOSSIL_BIN=/usr/local/bin/fossil
ENV FOSSIL_MCP_BIN=/usr/local/bin/fossil-mcp

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz/live || exit 1

ENTRYPOINT ["keasy-server"]
