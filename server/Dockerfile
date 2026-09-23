# Release image for keasy-server. Build CONTEXT is `server/`.
#
# keasy is a PURE HOST: NO fossil binary in the image. All fossil compute runs in
# the browser (DuckDB-WASM + `@fossil-lang/*`: executor / refs / providers). The
# only fossil code keasy compiles is the tiny `fossil-run-status` wire contract,
# and it comes from the published git tag (see server/Cargo.toml) — no sibling
# rmlext checkout in the context. See docker-compose.prod.yml: `context: ./server`.

FROM rust:1.90-bookworm AS builder

# Dep cache: build the manifests with a dummy main, then swap in the real source.
WORKDIR /src/server
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── runtime ───────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# The catalog's DuckLake `azure` extension reads remote Parquet footers
# (`ducklake_add_data_files`) via the Azure SDK, whose default transport looks
# for the CA bundle at the RHEL path `/etc/pki/tls/certs/ca-bundle.crt` and
# IGNORES `azure_transport_option_type='curl'` (duckdb/ducklake#272). Debian puts
# the bundle elsewhere, so symlink it there or every Azure registration fails
# with "Problem with the SSL CA cert".
RUN mkdir -p /etc/pki/tls/certs \
    && ln -sf /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt

# Litestream — continuously replicate the authoritative SQLite store (keasy.db)
# to a keasy-operated bucket so a node loss / instance migration doesn't drop the
# workspace's metadata. (The DuckLake catalog.sqlite is NOT replicated — it is a
# derived projection the reconciler rebuilds from the jobs.) The binary ships
# always; it is only USED when LITESTREAM_REPLICA_URL is set (the control-plane
# sets it per tenant) — see entrypoint.sh, which otherwise runs the server directly.
ARG LITESTREAM_VERSION=0.3.13
RUN curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz" \
      | tar -xz -C /usr/local/bin litestream

RUN useradd -r -s /bin/false keasy \
    && mkdir -p /var/lib/keasy \
    && chown keasy: /var/lib/keasy
USER keasy

COPY --from=builder /src/server/target/release/keasy-server /usr/local/bin/keasy-server
COPY litestream.yml /etc/litestream.yml
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz/live || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
