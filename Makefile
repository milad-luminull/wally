COMPOSE := docker compose

.PHONY: up down logs test lint typecheck migrate migrate-dev seed e2e

## Build and start the whole stack (db, api, web).
up:
	$(COMPOSE) up --build -d
	@echo ""
	@echo "Web:  http://localhost:5174"
	@echo "API:  http://localhost:4000"
	@echo "Run 'make logs' to follow output, 'make migrate' + 'make seed' on first run."

## Stop and remove containers.
down:
	$(COMPOSE) down

## Follow logs of all services.
logs:
	$(COMPOSE) logs -f

## Run all tests (backend + frontend Vitest suites) inside Docker.
test:
	$(COMPOSE) run --rm api pnpm turbo run test

## Run lint + type checks across the whole workspace inside Docker.
lint:
	$(COMPOSE) run --rm api pnpm turbo run lint

typecheck:
	$(COMPOSE) run --rm api pnpm turbo run typecheck

## Apply already-committed database migrations (safe to re-run).
migrate:
	$(COMPOSE) run --rm api pnpm --filter @wally/api migrate

## Create a new migration from schema changes during development.
migrate-dev:
	$(COMPOSE) run --rm api pnpm --filter @wally/api migrate:dev

## Load development seed data (idempotent).
seed:
	$(COMPOSE) run --rm api pnpm --filter @wally/api seed

## Run the Playwright end-to-end suite against the running stack (run `make up` first).
e2e:
	$(COMPOSE) exec web pnpm --filter @wally/web test:e2e
