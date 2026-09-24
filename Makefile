COMPOSE_DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

# ── Dev loop: when do I rebuild? ───────────────────────────────────────────
# The dev image is DEPS-ONLY; `server/src` + `web/src` are bind-mounted and
# hot-reloaded inside the running container (cargo-watch / Next HMR). So:
#
#   • Edited keasy server/web code .......... NOTHING. cargo-watch/HMR picks it
#                                             up live. (`make logs-server` to watch.)
#   • Container wedged / env changed ........ `make restart` (no rebuild).
#   • Changed server deps (Cargo.toml/lock)
#     or the Dockerfile .................... `make dev` (rebuilds the image).
#
# The image is deps-only and carries no fossil source: `fossil-run-status` is a git
# dep and fossil compute runs in the browser. Crates compile at runtime into the
# persistent `server-target` + `cargo-registry` volumes, so only the first `up`
# (or one after `make clean`) pays a cold compile.

.PHONY: help dev down prod build logs restart clean ps deploy-platform deploy-realm

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

dev: ## Start/rebuild dev env (only needed for dep/Dockerfile changes — code hot-reloads)
	@cp -n .env.example .env 2>/dev/null || true
	$(COMPOSE_DEV) up --build -d

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
