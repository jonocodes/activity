# Common commands. `just` on its own lists them.

set dotenv-load := true

default:
    @just --list

# Run the tests (offline, against fixtures)
test:
    node --test 'test/**/*.test.ts'

# Type-check without building (Node runs the .ts files directly)
typecheck:
    npx tsc -p .

# Fetch your public GitHub data into state.db (needs GH_PAT and ACTIVITY_USER, e.g. in .env)
collect:
    node src/cli/collect.ts

# Render dist/index.html from state.db (build step 4)
render:
    @echo "Not built yet: build step 4 in docs/design.md" && exit 1

# Re-render on every save and serve dist/ (build step 4)
dev:
    @echo "Not built yet: build step 4 in docs/design.md" && exit 1

# Refresh the recorded API fixtures from the live API (needs a public-only GH_PAT; refuses to save anything private)
record-fixtures:
    node src/cli/collect.ts --record

# PROTOTYPE, throwaway: fetch your public data (if missing) and serve the page mockup on http://localhost:8137
prototype:
    test -f prototype/data.json || node prototype/fetch-data.mjs
    @echo "Open http://localhost:8137/  (?tz=Europe/London to try another time zone)"
    python3 -m http.server 8137 --bind 127.0.0.1 --directory prototype

# PROTOTYPE: refetch the prototype's data
prototype-data:
    node prototype/fetch-data.mjs
