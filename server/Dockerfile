# Release image for keasy-server. Build context: `server/`.

FROM rust:1.90-bookworm AS builder

# Dep cache: build the manifests with a dummy main, then swap in the real source.
WORKDIR /src/server
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
# After the dep cache so a new SHA does not rebuild the dependencies.
ARG KEASY_GIT_SHA
ARG KEASY_BUILT_AT
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
# DuckDB's `azure`/`httpfs` extensions verify TLS through libcurl/OpenSSL, which
# do not find the Debian bundle on their own.
ENV CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

RUN useradd -r -s /bin/false keasy \
    && mkdir -p /var/lib/keasy \
    && chown keasy: /var/lib/keasy
USER keasy

COPY --from=builder /src/server/target/release/keasy-server /usr/local/bin/keasy-server

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz/live || exit 1

ENTRYPOINT ["/usr/local/bin/keasy-server"]
