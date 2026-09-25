# Release image for keasy-server. Build context: `server/`.

FROM rust:1-bookworm AS builder

# Dep cache: build the manifests with a dummy main, then swap in the real source.
WORKDIR /src/server
COPY rust-toolchain.toml ./
RUN rustup toolchain install
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
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -s /bin/false keasy \
    && mkdir -p /var/lib/keasy \
    && chown keasy: /var/lib/keasy
USER keasy

COPY --from=builder /src/server/target/release/keasy-server /usr/local/bin/keasy-server

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/keasy-server"]
