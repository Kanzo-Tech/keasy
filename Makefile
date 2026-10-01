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
# Crates compile at runtime into the persistent `server-target` + `cargo-registry`
# volumes, so only the first `up` (or one after `make clean`) pays a cold compile.

.PHONY: help dev down logs restart clean ps api e2e deploy-platform deploy-realm

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

dev: ## Start/rebuild dev env (only needed for dep/Dockerfile changes — code hot-reloads)
	docker compose up --build -d

down: ## Stop all services
	docker compose down

logs: ## Tail all service logs
	docker compose logs -f

logs-%: ## Tail logs for one service (e.g., make logs-server)
	docker compose logs -f $*

restart: ## Restart all services
	docker compose restart

restart-%: ## Restart one service (e.g., make restart-web)
	docker compose restart $*

clean: ## Nuclear reset: remove containers, volumes, images
	docker compose down -v --rmi local

shell-%: ## Open shell in container (e.g., make shell-server)
	docker compose exec $* sh

ps: ## Show running services
	docker compose ps

# ── The API contract ───────────────────────────────────────────────────────
# The server's routes publish the spec; `api/` (@keasy/api) holds it and the
# types generated from it. CI fails when a committed copy is stale.
api: ## Regenerate api/openapi.json and api/src/schema.d.ts from the server's routes
	UPDATE_EXPECT=1 cargo test --quiet --manifest-path server/Cargo.toml --test api openapi
	pnpm --filter @keasy/api generate

# ── The end-to-end suite ───────────────────────────────────────────────────
# Brings the stack up (and fake-llm, from the `faults` profile), then runs every
# failure scenario against it on :3000 — the only origin Keycloak admits, so it
# runs from the main checkout, not a worktree. Scenarios stop and start services
# themselves, and leave them running.
e2e: ## Run the e2e suite against the compose stack (main checkout only: Keycloak admits :3000)
	docker compose --profile faults up -d --wait --wait-timeout 1800 web fake-llm
	pnpm --filter @keasy/e2e exec playwright install chromium
	pnpm --filter @keasy/e2e test

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
