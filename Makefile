COMPOSE_DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_DEMO = docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.demo.yml
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE_MINIO = docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.minio.yml

# ── Dev loop: when do I rebuild? ───────────────────────────────────────────
# The dev image is DEPS-ONLY; `server/src` + `web/src` are bind-mounted and
# hot-reloaded inside the running container (cargo-watch / Next HMR). So:
#
#   • Edited keasy server/web code .......... NOTHING. cargo-watch/HMR picks it
#                                             up live. (`make logs-server` to watch.)
#   • Container wedged / env changed ........ `make restart` (no rebuild).
#   • Changed server deps (Cargo.toml/lock),
#     the Dockerfile, OR rmlext/fossil ...... `make dev` (rebuilds the image).
#
# `make dev` (--build) is the slow path: it recompiles the `fossil` binary from
# rmlext. That build is now DEBUG + BuildKit-cached (see server/Dockerfile.dev),
# so a re-run after a small rmlext change is incremental (seconds), not a full
# DuckDB rebuild. Only `make clean` wipes those caches.

.PHONY: help setup-minio dev dev-minio demo down prod build logs logs-minio restart clean ps minio-bucket test-minio deploy-platform deploy-realm

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup-minio: dev-minio ## First-time local setup with managed MinIO and bucket

dev: ## Start/rebuild dev env (only needed for dep/Dockerfile/rmlext changes — code hot-reloads)
	@cp -n .env.development .env 2>/dev/null || true
	$(COMPOSE_DEV) up --build -d

dev-minio: ## Start/rebuild dev env plus managed MinIO
	@cp -n .env.development .env 2>/dev/null || true
	$(COMPOSE_MINIO) up --build -d

demo: ## Start demo environment (release build, no hot-reload)
	@cp -n .env.development .env 2>/dev/null || true
	$(COMPOSE_DEMO) up --build -d

down: ## Stop all services
	$(COMPOSE_MINIO) down
	@$(COMPOSE_PROD) down 2>/dev/null || true

prod: ## Start with production builds (local test)
	$(COMPOSE_PROD) up --build -d

build: ## Build production images without starting
	$(COMPOSE_PROD) build

logs: ## Tail all service logs
	$(COMPOSE_DEV) logs -f

logs-minio: ## Tail managed MinIO and bucket-initializer logs
	$(COMPOSE_MINIO) logs -f minio minio-init

logs-%: ## Tail logs for one service (e.g., make logs-server)
	$(COMPOSE_DEV) logs -f $*

restart: ## Restart all services
	$(COMPOSE_DEV) restart

restart-%: ## Restart one service (e.g., make restart-web)
	$(COMPOSE_DEV) restart $*

clean: ## Nuclear reset: remove containers, volumes, images
	$(COMPOSE_MINIO) down -v --rmi local
	@$(COMPOSE_PROD) down -v --rmi local 2>/dev/null || true

shell-%: ## Open shell in container (e.g., make shell-server)
	$(COMPOSE_DEV) exec $* sh

ps: ## Show running services
	$(COMPOSE_MINIO) ps

minio-bucket: ## Re-run the managed MinIO bucket initializer
	$(COMPOSE_MINIO) run --rm minio-init

# Test profile values (endpoint, creds, bucket) come from .env.test.
# Strip \r before loading .env.test. Git Bash already ignores CRLF line endings,
# but other shells (WSL, Linux, macOS) keep a trailing \r on every value;
# stripping it here makes `test-minio` behave the same everywhere.
test-minio: ## Run the MinIO connectivity test (needs `make dev-minio` running)
	eval "$$(tr -d '\r' < .env.test)"; \
	$(COMPOSE_MINIO) exec -T \
	  -e AWS_ACCESS_KEY_ID="$$AWS_ACCESS_KEY_ID" \
	  -e AWS_SECRET_ACCESS_KEY="$$AWS_SECRET_ACCESS_KEY" \
	  -e AWS_DEFAULT_REGION="$$AWS_DEFAULT_REGION" \
	  -e AWS_ENDPOINT_URL="$$AWS_ENDPOINT_URL" \
	  -e KEASY_MINIO_TEST_URL="$$KEASY_MINIO_TEST_URL" \
	  server cargo test -j 4 --lib cloud::reader::tests -- --ignored --nocapture

# ── Prod / Swarm deploy — Terraform owns everything (see infra/terraform/README.md) ──
# Two phases: platform (Traefik+Keycloak+Postgres) then realm (SSO + tenants). Adding a
# tenant = edit infra/terraform/realm/terraform.tfvars + `make deploy-realm`. No shell, no CLI.
deploy-platform: ## Phase 1 — apply the platform (needs -var kc_hostname=… acme_email=…)
	terraform -chdir=infra/terraform/platform init -input=false
	terraform -chdir=infra/terraform/platform apply

deploy-realm: ## Phase 2 — apply the realm + tenants (reads realm/terraform.tfvars; feeds the platform admin pw)
	terraform -chdir=infra/terraform/realm init -input=false
	terraform -chdir=infra/terraform/realm apply \
	  -var kc_admin_password="$$(terraform -chdir=infra/terraform/platform output -raw kc_admin_password)"
