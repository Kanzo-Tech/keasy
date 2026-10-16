# keasy is one set of compose files (compose.yaml, the system): `make dev` runs it with
# compose.override.yaml. Anything else is plain `docker compose` — `docker compose logs -f web`,
# `docker compose restart acme-server` — which reads the development files on its own.
#
# The dev image is deps-only: `server/src` and `web/src` are mounted and hot-reloaded (cargo-watch,
# Next HMR), so editing code needs nothing. `make dev` again after changing dependencies or a
# Dockerfile; crates compile into persistent volumes, so only the first `up` after `make clean` pays
# a cold compile.

SHELL := bash
.PHONY: help dev seed clean api e2e demo

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── Development ────────────────────────────────────────────────────────────
dev: ## Start or rebuild the dev stack, and wait until the web answers behind the edge
	docker compose up -d --build --wait --wait-timeout 1800
	@echo "keasy: http://acme.localhost:3000"

seed: ## Fetch every dev example's data (infra/dev/examples/*/fetch.sh, checksummed) for the next `make dev` to upload
	sh infra/dev/seed.sh

clean: ## Nuclear reset: remove containers, volumes, images
	docker compose --profile faults down -v --rmi local --remove-orphans

# ── The API contract ───────────────────────────────────────────────────────
# The server's routes publish the spec; `api/` (@keasy/api) holds it and the
# types generated from it. The codes they refuse with are server/problems.bnf's,
# generated into server/src/problems.rs first. CI fails when a committed copy is stale.
api: ## Regenerate server/src/problems.rs, api/openapi.json and api/src/schema.d.ts
	cd server && cargo xtask problems
	UPDATE_EXPECT=1 cargo test --quiet --manifest-path server/Cargo.toml --test api openapi
	pnpm --filter @keasy/api generate

# ── The end-to-end suite ───────────────────────────────────────────────────
# Brings the dev stack up, then runs every failure scenario against it on :3000 — the only origin Keycloak
# admits, so it runs from the main checkout, not a worktree. Scenarios stop and start services
# themselves, and leave them running.
e2e: seed ## Run the e2e suite against the compose stack (main checkout only: Keycloak admits :3000)
	docker compose up -d --wait --wait-timeout 1800 auth-proxy
	pnpm --filter @keasy/e2e exec playwright install chromium
	pnpm --filter @keasy/e2e test

# ── Product demos ──────────────────────────────────────────────────────────
# Recorded, not asserted (e2e/demos/): a Playwright script per demo against the stack `make dev`
# and `make seed` bring up, on :3000 (main checkout only, as for e2e). Each demo is written to
# e2e/demos/out/<demo>-<theme>.mp4 and .png; the MP4 needs ffmpeg on PATH.
#   make demo                       list the demos
#   make demo DEMO=snb-explore      record one, light and dark
#   make demo DEMO=all THEME=dark   record every demo, one side
# A demo that asks the model asks everyone's, in the recording's browser, on its GPU: no container
# changes for it. The dev server's own furniture is hidden in that browser (e2e/demos/record/recorder.ts).

demo: ## List the product demos; DEMO=<name>|all records them (THEME=light|dark for one side)
ifeq ($(DEMO),)
	@pnpm --silent --filter @keasy/e2e exec playwright test --project=demos --no-deps --list \
	  | sed -n 's/.*› \([a-z0-9-]*\): \(.*\)$$/  \1	\2/p'
	@echo "make demo DEMO=<name>|all [THEME=light|dark]"
else
	@command -v ffmpeg >/dev/null || { echo "make demo: needs ffmpeg on PATH (macOS: brew install ffmpeg)" >&2; exit 1; }
	pnpm --filter @keasy/e2e exec playwright install chromium
	DEMO_THEME=$(THEME) pnpm --filter @keasy/e2e demo $(if $(filter all,$(DEMO)),,--grep " $(DEMO): ")
endif
