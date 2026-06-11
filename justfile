# ClaimWatch task runner — single source of truth for all commands.
# Run `just` to list recipes. Full documentation in TOOLS.md.

set shell := ["sh", "-cu"]

# list available recipes
default:
    @just --list

# (internal) fail with guidance when the pnpm workspace is not bootstrapped yet
_bootstrapped:
    @if [ ! -f package.json ]; then \
      echo "error: package.json not found — ClaimWatch is not bootstrapped yet."; \
      echo "This repo is currently a docs + harness scaffold (AGENTS.md / DESIGN.md / TOOLS.md)."; \
      echo "Follow DESIGN.md milestone M0 to create the pnpm workspace, then re-run."; \
      exit 1; \
    fi

# (internal) fail with guidance when docker-compose.yml does not exist yet
_compose:
    @if [ ! -f docker-compose.yml ]; then \
      echo "error: docker-compose.yml not found — local services not bootstrapped yet."; \
      echo "DESIGN.md milestone M0 adds a compose file with a pgvector/pgvector:pg16 'postgres' service."; \
      exit 1; \
    fi

# enable corepack and install all workspace dependencies
setup: _bootstrapped
    corepack enable
    pnpm install

# start the dev servers (Next.js app + Inngest dev server, via root `pnpm dev`)
dev: _bootstrapped
    pnpm dev

# start local Postgres 16 + pgvector in the background
db-up: _compose
    docker compose up -d postgres

# stop local services
db-down: _compose
    docker compose down

# apply Drizzle migrations to $DATABASE_URL
migrate: _bootstrapped
    pnpm --filter @claimwatch/db migrate

# run unit tests across all packages (vitest; DB suites skip without DATABASE_URL)
test: _bootstrapped
    pnpm test

# run DB-backed integration tests against live Postgres (`just db-up` first)
test-db: _bootstrapped
    DATABASE_URL="${DATABASE_URL:-postgres://claimwatch:claimwatch@localhost:5433/claimwatch}" pnpm test:db

# run Playwright end-to-end tests (builds apps/web, serves it, tests, stops it)
e2e: _bootstrapped
    pnpm e2e

# lint all packages (eslint)
lint: _bootstrapped
    pnpm lint

# format the repo (prettier --write)
format: _bootstrapped
    pnpm format

# type-check all packages (tsc --noEmit, strict)
typecheck: _bootstrapped
    pnpm typecheck

# build all packages and the web app
build: _bootstrapped
    pnpm build

# full CI gate: lint + typecheck + test + build (what .github/workflows/ci.yml runs)
ci: lint typecheck test build
