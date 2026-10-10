# keasy is one set of compose files (compose.yaml, the system): `make dev` runs it with
# compose.override.yaml, `make deploy` with compose.prod.yaml and infra/prod/. Anything else is plain
# `docker compose` — `docker compose logs -f web`, `docker compose restart acme-server` — which reads
# the development files on its own.
#
# The dev image is deps-only: `server/src` and `web/src` are mounted and hot-reloaded (cargo-watch,
# Next HMR), so editing code needs nothing. `make dev` again after changing dependencies or a
# Dockerfile; crates compile into persistent volumes, so only the first `up` after `make clean` pays
# a cold compile.

SHELL := bash
.PHONY: help dev seed clean api e2e demo deploy secrets secret key

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── Development ────────────────────────────────────────────────────────────
# .env (optional, .env.example) is read by compose; here only to know whether an AI alias runs on
# the local models — unset, or `local/…` — which are then pulled and served by Docker Model Runner.
-include .env
LOCAL_ALIASES := $(filter local/%,$(or $(AI_CHAT),local/) $(or $(AI_COMPLETE),local/))

dev: ## Start or rebuild the dev stack, and wait until the web answers
	docker compose $(if $(LOCAL_ALIASES),--profile local-models) up -d --build --wait --wait-timeout 1800
	@echo "keasy: http://acme.localhost:3000"

seed: ## Fetch the dev graphs (LDBC SNB SF0.1, ~17 MB; OpenFlights, ~3.5 MB; Nobel laureates, ~4 MB; checksummed) for the next `make dev` to upload
	sh infra/dev/seed.sh

clean: ## Nuclear reset: remove containers, volumes, images
	docker compose --profile local-models --profile faults down -v --rmi local --remove-orphans

# ── The API contract ───────────────────────────────────────────────────────
# The server's routes publish the spec; `api/` (@keasy/api) holds it and the
# types generated from it. CI fails when a committed copy is stale.
api: ## Regenerate api/openapi.json and api/src/schema.d.ts from the server's routes
	UPDATE_EXPECT=1 cargo test --quiet --manifest-path server/Cargo.toml --test api openapi
	pnpm --filter @keasy/api generate

# ── The end-to-end suite ───────────────────────────────────────────────────
# Brings the dev stack up without the local models (no scenario needs one, and CI's runners have
# no Model Runner), then runs every failure scenario against it on :3000 — the only origin Keycloak
# admits, so it runs from the main checkout, not a worktree. Scenarios stop and start services
# themselves, and leave them running.
e2e: seed ## Run the e2e suite against the compose stack (main checkout only: Keycloak admits :3000)
	docker compose up -d --wait --wait-timeout 1800 web
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
# they have changed, and the graph demos call none. Its model's window, AI_CHAT_CONTEXT, is declared
# here once: Model Runner starts Qwen3 with it, and the web is recreated with it too, so Ask fits its
# prompts into that window; both are put back after. They touch no container at all: the dev server's
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
	$(if $(DEMO_AI),AI_CHAT=local/ai/qwen3 AI_CHAT_CONTEXT=16384 docker compose -f compose.yaml -f compose.override.yaml -f e2e/demos/models.yml --profile local-models up -d --wait ai-models ai-gateway web)
	pnpm --filter @keasy/e2e exec playwright install chromium
	DEMO_THEME=$(THEME) pnpm --filter @keasy/e2e demo $(if $(filter all,$(DEMO)),,--grep " $(DEMO): "); \
	  status=$$?; $(if $(DEMO_AI),docker compose up -d --wait ai-gateway web;) exit $$status
endif

# ── A deployment (infra/prod/README.md) ────────────────────────────────────
# Run on the server, from a checkout. The secrets are decrypted into the environment of the one
# command that needs them — never onto the disk — with the age key in SOPS_AGE_KEY_FILE.
export SOPS_AGE_KEY_FILE ?= $(HOME)/.config/sops/age/keys.txt
SOPS := infra/prod/sops
PROD := -f compose.yaml -f compose.prod.yaml $(addprefix -f ,$(wildcard infra/prod/orgs/*.yaml)) --env-file infra/prod/prod.env
# A decryption that fails stops the deploy, and so does a missing password: the platform's compose
# files fall back to development's passwords, which a deployment must never start with.
SECRETS := secrets=$$($(SOPS) -d --input-type dotenv --output-type dotenv /dev/stdin < infra/prod/secrets.sops.env) || exit 1; \
	while IFS= read -r line; do [ -n "$$line" ] && export "$$line"; done <<<"$$secrets"; \
	: "$${KC_ADMIN_PASSWORD:?}" "$${KC_DB_PASSWORD:?}" "$${AI_DB_PASSWORD:?}";

# With the docker-rollout plugin, the web is replaced first with no gap — the new one beside the old
# behind Traefik until it is healthy — and `up` then finds it current. Without it, `up` restarts it.
# A server is always stopped before its replacement starts: SQLite takes one writer.
deploy: secrets ## Bring the deployment to what infra/prod/ says: models, organizations, version
	@$(SECRETS) \
	if docker rollout --help >/dev/null 2>&1 && [ -n "$$(docker compose $(PROD) ps -q web)" ]; then docker rollout $(PROD) web; fi; \
	docker compose $(PROD) up -d --wait --remove-orphans

secrets: ## Generate the deployment's secrets that do not exist yet (a new organization's key among them)
	infra/prod/secrets.sh

secret: ## Set one of the deployment's secrets, e.g. `make secret NAME=ANTHROPIC_API_KEY` (asks for its value)
	@infra/prod/secrets.sh set $(NAME)

key: ## Create your age key, if you have none, and print the public half to add to infra/prod/.sops.yaml
	@if [ ! -f "$(SOPS_AGE_KEY_FILE)" ]; then \
	  mkdir -p "$$(dirname "$(SOPS_AGE_KEY_FILE)")"; \
	  docker run --rm alpine:3.22 sh -c 'apk add -q age >/dev/null && age-keygen 2>/dev/null' > "$(SOPS_AGE_KEY_FILE)"; \
	  chmod 600 "$(SOPS_AGE_KEY_FILE)"; \
	fi
	@sed -n 's/^# public key: //p' "$(SOPS_AGE_KEY_FILE)"
