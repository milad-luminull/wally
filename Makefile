COMPOSE := docker compose

.PHONY: up down logs test lint typecheck format seed e2e

## Build and start the whole stack (firestore emulator, api, web).
up:
	$(COMPOSE) up --build -d
	@echo ""
	@echo "Web:            http://localhost:5174"
	@echo "API:            http://localhost:4000"
	@echo "Firestore UI:   http://localhost:4001"
	@echo "Run 'make logs' to follow output, 'make seed' on first run."

## Stop and remove containers.
down:
	$(COMPOSE) down

## Follow logs of all services.
logs:
	$(COMPOSE) logs -f

## Run all tests (backend + frontend Vitest suites) inside Docker.
test:
	$(COMPOSE) run --rm api pnpm turbo run test

## Run lint across the whole workspace inside Docker (type checks: `make typecheck`).
lint:
	$(COMPOSE) run --rm api pnpm turbo run lint

## Type-check the whole workspace inside Docker.
typecheck:
	$(COMPOSE) run --rm api pnpm turbo run typecheck

## Format the whole workspace with Prettier (CI checks this; see .prettierignore).
format:
	pnpm run format

## Load development seed data (idempotent).
seed:
	$(COMPOSE) run --rm api pnpm --filter @wally/api seed

## Run the Playwright suite from the host against the running stack, as CI does. Needs
## `make up && make seed`, the browsers (`pnpm --filter @wally/web exec playwright install
## chromium webkit`) and E2E_USER_EMAIL / E2E_USER_PASSWORD exported; see apps/web/e2e/README.md.
PLAYWRIGHT_BASE_URL ?= http://localhost:5174
e2e:
	PLAYWRIGHT_BASE_URL=$(PLAYWRIGHT_BASE_URL) pnpm --filter @wally/web exec playwright test
