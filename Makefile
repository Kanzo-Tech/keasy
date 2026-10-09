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

.PHONY: help dev seed down logs restart clean ps api e2e demo deps deploy-platform deploy-auth deploy-instances

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# The platform's services (identity, the AI gateway) come from kanzo-ui, at the
# release keasy is built against: the same tag its @kanzo-tech/* packages pin.
KANZO_UI_REF ?= v0.33.0

deps: ## Check out kanzo-ui's services at $(KANZO_UI_REF) into .deps/kanzo-ui
	@if [ -d .deps/kanzo-ui/.git ]; then \
	  git -C .deps/kanzo-ui fetch --quiet --depth 1 origin tag $(KANZO_UI_REF) && git -C .deps/kanzo-ui checkout --quiet $(KANZO_UI_REF); \
	else \
	  git -c advice.detachedHead=false clone --quiet --depth 1 --branch $(KANZO_UI_REF) https://github.com/Kanzo-Tech/ui.git .deps/kanzo-ui; \
	fi

dev: deps ## Start/rebuild dev env (only needed for dep/Dockerfile changes — code hot-reloads)
	docker compose up --build -d

seed: ## Fetch the dev graphs (LDBC SNB SF0.1, ~17 MB; OpenFlights, ~3.5 MB; checksummed) for the next `make dev` to upload
	sh infra/dev/seed.sh

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
	docker compose down -v --rmi local --remove-orphans

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
# Brings the stack up without models (e2e/compose.yml, as CI does), then runs every
# failure scenario against it on :3000 — the only origin Keycloak admits, so it
# runs from the main checkout, not a worktree. Scenarios stop and start services
# themselves, and leave them running.
e2e: deps seed ## Run the e2e suite against the compose stack (main checkout only: Keycloak admits :3000)
	docker compose -f docker-compose.yml -f e2e/compose.yml up -d --wait --wait-timeout 1800 web
	pnpm --filter @keasy/e2e exec playwright install chromium
	pnpm --filter @keasy/e2e test

# ── Product demos ──────────────────────────────────────────────────────────
# Recorded, not asserted (e2e/demos/): a Playwright script per demo against the stack `make dev`
# and `make seed` bring up, on :3000 (main checkout only, as for e2e). The web is restarted with
# NEXT_PUBLIC_KEASY_DEMO, which turns off the dev server's own furniture, and put back after. Each
# demo is written to e2e/demos/out/<demo>-<theme>.mp4 and .png; the MP4 needs ffmpeg on PATH.
#   make demo                       list the demos
#   make demo DEMO=snb-explore      record one, light and dark
#   make demo DEMO=all THEME=dark   record every demo, one side
# `docker compose build web` first: the web image carries next.config.ts, which reads the switch.
# Only a demo that asks the model swaps the gateway onto e2e/demos/models.yml, and puts it back after:
# every `compose up` configures the project's models, which takes Model Runner a minute or more once
# they have changed, and the graph demos call none. They touch no container at all: the dev server's
# own furniture is hidden in the recording's browser (e2e/demos/record.ts) rather than by restarting
# the web with NEXT_PUBLIC_KEASY_DEMO.
DEMO_AI = $(filter all %-ask,$(DEMO))

demo: ## List the product demos; DEMO=<name>|all records them (THEME=light|dark for one side)
ifeq ($(DEMO),)
	@pnpm --silent --filter @keasy/e2e exec playwright test --project=demos --no-deps --list \
	  | sed -n 's/.*› \([a-z0-9-]*\): \(.*\)$$/  \1	\2/p'
	@echo "make demo DEMO=<name>|all [THEME=light|dark]"
else
	@command -v ffmpeg >/dev/null || { echo "make demo: needs ffmpeg on PATH (macOS: brew install ffmpeg)" >&2; exit 1; }
	$(if $(DEMO_AI),docker compose -f docker-compose.yml -f e2e/demos/models.yml up -d --wait ai-gateway)
	pnpm --filter @keasy/e2e exec playwright install chromium
	DEMO_THEME=$(THEME) pnpm --filter @keasy/e2e demo $(if $(filter all,$(DEMO)),,--grep " $(DEMO): "); \
	  status=$$?; $(if $(DEMO_AI),docker compose up -d --wait ai-gateway;) exit $$status
endif

# ── Prod / Swarm deploy — Terraform owns everything (see infra/terraform/README.md) ──
# platform (Traefik + Keycloak + Postgres + AI gateway) → auth (the kanzo realm + keasy's
# client) → instances (keasy per organization).
# Adding a tenant = its organization in realm.tfvars, an entry in instances/terraform.tfvars,
# then deploy-auth, deploy-instances.
#
# The tfvars and the state of the realm and auth roots are operator-local, in $(DEPLOY_DIR)
# (gitignored): realm.tfvars (organizations, and apis = { ai-gateway = "…" }), auth.tfvars
# (redirect_uris — each organization's origin — and backchannel_logout_url =
# "http://keasy-web:3000/api/auth/backchannel-logout"). platform and instances keep theirs
# beside them (terraform.tfvars, gitignored).
DEPLOY_DIR ?= $(CURDIR)/infra/terraform/.operator
TF_PLATFORM = terraform -chdir=infra/terraform/platform
KC_ADMIN_PASSWORD = $$($(TF_PLATFORM) output -raw kc_admin_password)

# $(call tf-apply,<root>,<name>,<extra args>): init with its state in $(DEPLOY_DIR), apply.
define tf-apply
	TF_DATA_DIR=$(DEPLOY_DIR)/$(2).terraform terraform -chdir=$(1) init -input=false -reconfigure -backend-config=path=$(DEPLOY_DIR)/$(2).tfstate
	TF_DATA_DIR=$(DEPLOY_DIR)/$(2).terraform terraform -chdir=$(1) apply -var-file=$(DEPLOY_DIR)/$(2).tfvars $(3)
endef

deploy-platform: ## Phase 1 — apply the platform (reads platform/terraform.tfvars: kc_hostname, acme_email, ai_*)
	$(TF_PLATFORM) init -input=false
	$(TF_PLATFORM) apply

deploy-auth: deps ## Phase 2 — apply kanzo-ui's realm (organizations), then keasy's client (infra/auth)
	$(call tf-apply,.deps/kanzo-ui/services/auth/realm,realm,-var kc_admin_password="$(KC_ADMIN_PASSWORD)")
	$(call tf-apply,infra/auth,auth,-var kc_admin_password="$(KC_ADMIN_PASSWORD)")

deploy-instances: ## Phase 3 — apply keasy per organization (instances/terraform.tfvars + the auth secret)
	terraform -chdir=infra/terraform/instances init -input=false
	terraform -chdir=infra/terraform/instances apply \
	  -var oidc_client_secret="$$(TF_DATA_DIR=$(DEPLOY_DIR)/auth.terraform terraform -chdir=infra/auth output -raw client_secret)"
