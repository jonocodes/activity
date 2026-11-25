# activity

One static page with all your public GitHub activity: commits (including other people's repos), repos you created and forked, issues, pull requests, discussions, pinned projects, public orgs, and a per-project breakdown. Private repos are left out for now; showing them is a planned feature.

GitHub spreads this across the profile graph, the repositories tab, search and per-repo views, each with its own time window. Discussions only show up in search, and the activity feed forgets after 30 days. This puts it all on one page that you host yourself.

**Status: designed, not built yet.** See [docs/design.md](docs/design.md).

![Prototype: the Projects view, with real data](docs/img/variant-b-projects.png)

## How it will work

- A GitHub Actions workflow in your fork runs hourly. It fetches your public activity from the GitHub API, renders one static HTML page, and deploys it to GitHub Pages. Each run fetches everything again (a few minutes); keeping data between runs, for speed and for history GitHub forgets, is planned for later.
- Visitors get a plain static page. Nothing in the browser calls GitHub.
- The token can only read public data, so nothing private can end up on the page or in the public Actions logs.
- Settings are Actions variables in your fork's settings, not files in the repo, and all of them are optional. You never edit code, so "Sync fork" keeps working.

## Planned setup for a fork

1. Fork this repo and enable Actions in your fork's Actions tab.
2. Create a fine-grained token with **Public repositories (read-only)** access and no extra permissions (see [Token](docs/design.md#token)). Add it as the `GH_PAT` secret.
3. Optional: set any of the `ACTIVITY_*` variables (Settings → Secrets and variables → Actions → Variables). They're listed in [Settings](docs/design.md#settings) and [.env.example](.env.example).
4. Enable GitHub Pages with "GitHub Actions" as the source.

## Development (planned)

Uses flox and direnv: `.envrc` activates the flox environment and loads `.env`. Copy `.env.example` to `.env` and set `GH_PAT` to run against the live API; tests run offline from recorded fixtures. Common commands will be in the Justfile:

- `just collect` fetches your data once into `state.db` (a few minutes);
- `just render` builds `dist/index.html` from it in under a second, with no network;
- `just dev` re-renders on every save, so you can iterate on the page without fetching again;
- `just test` runs the offline tests.

## Docs

- [docs/design.md](docs/design.md): decisions, architecture, data sources, schema, settings, testing, build plan, open questions, and the deferred design for private repos.
- [docs/research.md](docs/research.md):
  - what GitHub shows natively;
  - API limits, with live measurements;
  - existing tools (github-readme-stats, lowlighter/metrics, archive-style projects) and why they fall short.
- The prototype of the three views is under the [`archive/prototype-views`](https://github.com/jonocodes/activity/tree/archive/prototype-views) tag.

## License

GPL-3.0. See [LICENSE](LICENSE).
