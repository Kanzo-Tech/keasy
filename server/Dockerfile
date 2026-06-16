# Release image for keasy-server. Build CONTEXT is the parent dir holding BOTH
# the keasy repo (`keasy/`) and the sibling `rmlext/` checkout.
#
# keasy is a PURE HOST: NO fossil binary in the image. All fossil compute runs in
# the browser (DuckDB-WASM + `@fossil-lang/*`: executor / refs / providers). The
# only fossil code keasy compiles is the tiny `fossil-run-status` wire contract,
# which resolves through the [patch] in server/Cargo.toml to the sibling rmlext
# workspace (still in the context — workspace inheritance needs the root manifest;
# NOT a binary). POST-publish this migrates to a sibling-free git-dep clone of the
# tag. See docker-compose.prod.yml: `context: ..`.

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

RUN useradd -r -s /bin/false keasy \
    && mkdir -p /var/lib/keasy \
    && chown keasy: /var/lib/keasy
USER keasy

COPY --from=builder /src/keasy/server/target/release/keasy-server /usr/local/bin/keasy-server

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz/live || exit 1

ENTRYPOINT ["keasy-server"]
