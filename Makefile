COMPOSE ?= docker compose
# One-off containers. HOME=/tmp keeps tool caches out of the bind-mounted source.
RUN = $(COMPOSE) run --rm --no-deps -e HOME=/tmp api
# Same, but files written by the tool stay owned by you (used by `make format`).
RUN_AS_ME = $(COMPOSE) run --rm --no-deps -u $(shell id -u):$(shell id -g) -e HOME=/tmp api

.PHONY: dev down logs test lint format doctor clean

## Start the API (:3000) and the web app (:5173) with live reload
dev:
	$(COMPOSE) up --build

## Stop the containers
down:
	$(COMPOSE) down

## Follow the logs of both services
logs:
	$(COMPOSE) logs -f

## Run all tests (shared, api, web) in a throwaway container.
## Note `bun run test`: plain `bun test` would start Bun's own test runner instead of Vitest.
test:
	$(COMPOSE) run --rm --no-deps --build api bun run test

## Biome (lint + format check) and TypeScript
lint:
	$(RUN) sh -c "bun run lint && bun run typecheck"

## Apply Biome formatting and safe fixes
format:
	$(RUN_AS_ME) bun run format

## React Doctor score for the web app
doctor:
	$(RUN) bun run doctor

## Remove containers and volumes (database, installed dependencies); use after changing dependencies
clean:
	$(COMPOSE) down -v
