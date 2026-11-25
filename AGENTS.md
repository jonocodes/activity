# Agent notes

A forkable tool that builds one static page of a person's GitHub activity, hourly, in GitHub Actions. Nothing is built yet: the repo holds the design only.

Read [docs/design.md](docs/design.md) before any change. It is the source of truth for decisions, data sources, schema, rules and the **build plan** (work through it in order). [docs/research.md](docs/research.md) holds the API facts and limits behind each decision; check it before assuming how a GitHub API behaves.

## Guardrails

- **Privacy is the hard requirement.** The repo, its Actions logs and the deployed page are all public. v1 handles public data only: the token is public read-only, and the collector drops anything marked private even if the token could see it. Private repos are a deferred feature (design.md, "Future: private repos"); don't add private handling without a design decision. Every change touching collection, rendering or logging keeps the privacy test green.
- **No hard-coded user.** The user comes from `ACTIVITY_USER`, defaulting to the repo owner. Settings are env vars (Actions variables), never a committed config file. `jonocodes` appears only in docs, as the first user.
- **Tests first, offline.** Collect and render run against recorded API fixtures. A live API call belongs in the manual smoke test only.
- **Keep the README current** whenever setup, config or behaviour changes; the owner treats it as the source of truth. Common commands go in the Justfile.
- **Design changes update `docs/design.md` in the same change:** a row in Decisions, with the reason.

## Owner preferences

- Uses flox and direnv for dev environments, fish shell, and a Justfile for common commands.
- Markdown uses natural wrap, never hard-wrapped at 80 columns.
- Bold ideas are welcome when they clearly help.
- Early days: work directly on `main`, prototypes included; no feature branches needed. Archive old work with an `archive/...` tag and a pointer in the docs.
