COMPOSE_DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_DEMO = docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.demo.yml
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

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

.PHONY: help dev demo down prod build logs restart clean ps

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

dev: ## Start/rebuild dev env (only needed for dep/Dockerfile/rmlext changes — code hot-reloads)
	@cp -n .env.example .env 2>/dev/null || true
	$(COMPOSE_DEV) up --build -d

demo: ## Start demo environment (release build, no hot-reload)
	@cp -n .env.example .env 2>/dev/null || true
	$(COMPOSE_DEMO) up --build -d

down: ## Stop all services
	$(COMPOSE_DEV) down
	@$(COMPOSE_PROD) down 2>/dev/null || true

prod: ## Start with production builds (local test)
	$(COMPOSE_PROD) up --build -d

build: ## Build production images without starting
	$(COMPOSE_PROD) build

logs: ## Tail all service logs
	$(COMPOSE_DEV) logs -f

logs-%: ## Tail logs for one service (e.g., make logs-server)
	$(COMPOSE_DEV) logs -f $*

restart: ## Restart all services
	$(COMPOSE_DEV) restart

restart-%: ## Restart one service (e.g., make restart-web)
	$(COMPOSE_DEV) restart $*

clean: ## Nuclear reset: remove containers, volumes, images
	$(COMPOSE_DEV) down -v --rmi local
	@$(COMPOSE_PROD) down -v --rmi local 2>/dev/null || true

shell-%: ## Open shell in container (e.g., make shell-server)
	$(COMPOSE_DEV) exec $* sh

ps: ## Show running services
	$(COMPOSE_DEV) ps

# ── Prod / Swarm deploy ────────────────────────────────────────────────────
deploy-base: ## Bootstrap the Swarm base stack (idempotent) — reads deploy/environments/prod/.env
	infra/stack/bootstrap.sh

tenant: ## Provision a tenant: make tenant slug=acme name="Acme Corp" owner=<keycloak-sub>
	@test -n "$(slug)" && test -n "$(name)" && test -n "$(owner)" \
	  || { echo "usage: make tenant slug=<slug> name=<name> owner=<keycloak-sub>"; exit 1; }
	@printf 'name: %s\nowner_keycloak_sub: %s\n' "$(name)" "$(owner)" \
	  > deploy/environments/prod/tenants/$(slug).yaml
	@echo "✓ wrote deploy/environments/prod/tenants/$(slug).yaml"
	@echo "  commit it; the control-plane reconciles every CP_RECONCILE_INTERVAL_SECS"
	@echo "  (or force now from the manager: curl -fsS -X POST http://localhost:9000/reconcile)"
