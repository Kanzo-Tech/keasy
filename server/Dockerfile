# Release image for keasy-server. Build CONTEXT is the parent dir holding BOTH
# the keasy repo (`keasy/`) and the sibling `rmlext/` checkout.
#
# keasy NO LONGER compiles the `fossil` binary here (that was ~3-5 min of bundled
# DuckDB): the `fossil` + `fossil-mcp` binaries come from the published producer
# image `ghcr.io/kanzo-tech/fossil` via `COPY --from=fossil`. The only fossil code
# keasy compiles is the tiny `fossil-run-status` wire contract, which resolves
# through the [patch] in server/Cargo.toml to the sibling rmlext workspace (still
# in the context — workspace inheritance needs the root manifest; NOT compiled to a
# binary). POST-publish this migrates to a sibling-free git-dep clone of the tag.
# See docker-compose.prod.yml: `context: ..`, plus the FOSSIL_IMAGE build-arg.

ARG FOSSIL_IMAGE=ghcr.io/kanzo-tech/fossil:0.3.0
FROM ${FOSSIL_IMAGE} AS fossil

FROM rust:1.90-bookworm AS builder
WORKDIR /src

# ── fossil source (NOT built) ─────────────────────────────────────────────
# Present only so the `fossil-run-status` [patch] resolves against the rmlext
# workspace. No `cargo build` of rmlext here — the binaries come from the image.
COPY rmlext /src/rmlext

# ── keasy-server ──────────────────────────────────────────────────────────
# Dep cache: build manifests with a dummy main, then swap in real source.
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
# The fossil subprocess keasy invokes for every run/catalog/providers call —
# from the published producer image, not compiled here.
COPY --from=fossil /usr/local/bin/fossil /usr/local/bin/fossil
COPY --from=fossil /usr/local/bin/fossil-mcp /usr/local/bin/fossil-mcp
ENV FOSSIL_BIN=/usr/local/bin/fossil
ENV FOSSIL_MCP_BIN=/usr/local/bin/fossil-mcp

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz/live || exit 1

ENTRYPOINT ["keasy-server"]
