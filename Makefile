COMPOSE_DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help setup dev down prod build logs restart clean seed ps

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: ## First-time setup: create .env, build images, start dev
	@cp -n .env.example .env 2>/dev/null || true
	@cp -n web/.env.local.example web/.env.local 2>/dev/null || true
	$(COMPOSE_DEV) up --build -d

dev: ## Start dev environment (hot reload + demo data)
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

seed: ## Re-seed: wipe app data, restart server
	$(COMPOSE_DEV) rm -sf server
	@docker volume rm keasy_keasy-data 2>/dev/null || true
	$(COMPOSE_DEV) up --build -d server

shell-%: ## Open shell in container (e.g., make shell-server)
	$(COMPOSE_DEV) exec $* sh

ps: ## Show running services
	$(COMPOSE_DEV) ps
