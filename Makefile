COMPOSE_DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_DEMO = docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.demo.yml
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help dev demo down prod build logs restart clean ps

help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

dev: ## Start dev environment (creates .env files on first run)
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
