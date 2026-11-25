# Common commands. More arrive with build step 1 (test, collect, render, dev, record-fixtures).

# PROTOTYPE, throwaway: fetch your public data (if missing) and serve the page mockup on http://localhost:8137
prototype:
    test -f prototype/data.json || node prototype/fetch-data.mjs
    @echo "Open http://localhost:8137/?variant=A  (← → to switch variants; ?tz=Europe/London to try another time zone)"
    python3 -m http.server 8137 --directory prototype

# PROTOTYPE: refetch the prototype's data
prototype-data:
    node prototype/fetch-data.mjs
