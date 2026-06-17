# Release image for the keasy control-plane (per-tenant provisioner). It shells
# out to `docker stack deploy` / `docker secret` against the manager's Engine, so
# the runtime ships the docker CLI (talks to the mounted socket — no daemon here).
# Build CONTEXT is the parent holding `keasy/` (control-plane/ + its keycloak/
# path dep), matching the other images. Standalone Rust crate — NO rmlext/fossil.
#
#   docker build -f keasy/control-plane/Dockerfile -t keasy-control-plane .

FROM rust:1.90-bookworm AS builder
WORKDIR /src
COPY keasy/keycloak /src/keycloak
COPY keasy/control-plane /src/control-plane
WORKDIR /src/control-plane
RUN cargo build --release

# ── runtime ───────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Just the docker CLI (static binary) — it drives the manager's Engine over the
# bind-mounted socket; no Docker daemon runs in this container.
ARG DOCKER_CLI_VERSION=27.3.1
RUN curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" \
      | tar -xz -C /usr/local/bin --strip-components=1 docker/docker

RUN mkdir -p /var/lib/keasy
COPY --from=builder /src/control-plane/target/release/control-plane /usr/local/bin/control-plane

EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:9000/healthz || exit 1

ENTRYPOINT ["control-plane"]
