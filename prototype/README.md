# Prototype (throwaway)

Captured from the design session of 2026-11-23/24. This branch is reference material, never merged into `main`.

- `index.html`: the three candidate views (A Feed, B Projects, C Stat cards). Open it directly in a browser and switch with `?variant=A|B|C` or the ← → keys. It embeds a public-only sample of real `jonocodes` activity. Verdict: all three were liked, which gave the combined layout in `docs/design.md`.
- `q.graphql` + `build_fixture.py`: the GraphQL query and script that produced `fixture.json` (run `gh api graphql -f query="$(cat q.graphql)" > gql.json`, plus a commit search into `commits.json`, then `python3 -I build_fixture.py gql.json commits.json`). It drops private repos.
- `size_probe.py`: pulls the full issue/PR/comment/discussion history into SQLite and compares SQLite and JSON sizes (1568 items: 380 KB SQLite, 395 KB JSON).
- `html_size.py`: estimates the size of the fully pre-rendered page (about 0.7 MB raw, 60 KB gzipped).
