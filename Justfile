# Common commands. `just` on its own lists them.

set dotenv-load := true

default:
    @just --list

# Run the tests (offline, against fixtures)
test:
    node --test 'test/**/*.test.ts'

# Accept intended changes to the rendered page's snapshot
update-snapshots:
    node --test --test-update-snapshots 'test/**/*.test.ts'

# Type-check without building (Node runs the .ts files directly)
typecheck:
    npx tsc -p .

# Fetch your public GitHub data into state.db (needs GH_PAT and ACTIVITY_USER, e.g. in .env)
collect:
    node src/cli/collect.ts

# Render dist/ from state.db (add --from-recording to use the recorded fixture, no token needed)
render *args:
    node src/cli/render.ts {{args}}

# Serve dist/ on http://localhost:8139 and re-render when src/ changes (add --tailnet to reach it from your phone)
dev *args:
    node --watch-path=src --watch-preserve-output src/cli/dev.ts {{args}}

# Refresh the recorded API fixtures from the live API (needs a public-only GH_PAT; refuses to save anything private)
record-fixtures:
    node src/cli/collect.ts --record

# PROTOTYPE, throwaway: fetch your public data (if missing) and serve the page mockup on http://localhost:8137
prototype:
    test -f prototype/data.json || node prototype/fetch-data.mjs
    test -f prototype/data-main.json || node prototype/split-data.mjs
    @echo "Open http://localhost:8137/  (?tz=Europe/London to try another time zone)"
    python3 -m http.server 8137 --bind 127.0.0.1 --directory prototype

# PROTOTYPE: refetch the prototype's data
prototype-data:
    node prototype/fetch-data.mjs
    node prototype/split-data.mjs
