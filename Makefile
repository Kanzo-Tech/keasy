COMPOSE_DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_DEMO = docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.demo.yml

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

.PHONY: help dev demo down logs restart clean ps deploy-platform deploy-realm

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

shell-%: ## Open shell in container (e.g., make shell-server)
	$(COMPOSE_DEV) exec $* sh

ps: ## Show running services
	$(COMPOSE_DEV) ps

# ── Prod deploy — k8s + GitOps (see infra/k8s/bootstrap/README.md) ──────────────────
# The cluster (k3s), Argo CD, cert-manager and the platform are operator-run / Argo-pulled;
# Terraform still owns Keycloak's realm + tenants and writes each tenant's k8s Secret.
# Adding a tenant = commit infra/k8s/tenants/<slug>.yaml + add it to realm/terraform.tfvars
# + `make deploy-realm`.
deploy-platform: ## Platform is GitOps — bootstrap the cluster + Argo per the README
	@echo "Platform deploy is GitOps. Follow infra/k8s/bootstrap/README.md:"
	@echo "  k3s → Argo CD → operator secrets → kubectl apply -f infra/k8s/bootstrap/root-app.yaml"

deploy-realm: ## Apply the realm + tenants (reads realm/terraform.tfvars; admin pw from the cluster Secret)
	terraform -chdir=infra/terraform/realm init -input=false
	terraform -chdir=infra/terraform/realm apply \
	  -var kc_admin_password="$$(kubectl -n keycloak get secret keycloak-admin -o jsonpath='{.data.password}' | base64 -d)"
