COMPOSE := docker compose

.PHONY: up down logs test lint typecheck format seed status

## Build and start the whole stack (PostgreSQL, api, web).
up:
	$(COMPOSE) up --build -d
	@echo ""
	@echo "Web:            http://localhost:5174"
	@echo "API:            http://localhost:4000"
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

## Where every change stands: PRs, approvals, Terraform, release. Read-only (docs/DEPLOY.md).
status:
	@scripts/status.sh
