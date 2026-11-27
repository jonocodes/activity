# activity

One static page with all your public GitHub activity: commits (including other people's repos), repos you created and forked, issues, pull requests, discussions, pinned projects, public orgs, and a per-project breakdown. Private repos are left out for now; showing them is a planned feature.

GitHub spreads this across the profile graph, the repositories tab, search and per-repo views, each with its own time window. Discussions only show up in search, and the activity feed forgets after 30 days. This puts it all on one page that you host yourself.

**Status: designed, not built yet.** See [docs/design.md](docs/design.md).

![Prototype: the Projects view, with real data](docs/img/variant-b-projects.png)

## How it will work

- A GitHub Actions workflow in your fork runs hourly. It fetches your public activity from the GitHub API, renders one static HTML page, and deploys it to GitHub Pages. Each run fetches everything again (a few minutes); keeping data between runs, for speed and for history GitHub forgets, is planned for later.
- Visitors get a plain static page. Nothing in the browser calls GitHub. The main page holds the last 12 months; each older year is its own small page, loaded only when you open that year, so the first load stays small on a phone.
- The token can only read public data, so nothing private can end up on the page or in the public Actions logs.
- Settings are Actions variables in your fork's settings, not files in the repo, and all of them are optional. You never edit code, so "Sync fork" keeps working.

## Planned setup for a fork

1. Fork this repo and enable Actions in your fork's Actions tab.
2. Create a fine-grained token with **Public repositories (read-only)** access, no extra permissions, and an expiry of one year or less (see [Token](docs/design.md#token)). Add it as the `GH_PAT` secret.
3. Optional: set any of the `ACTIVITY_*` variables (Settings → Secrets and variables → Actions → Variables). They're listed in [Settings](docs/design.md#settings) and [.env.example](.env.example).
4. Enable GitHub Pages with "GitHub Actions" as the source.

## Methodology

How the page decides what to show. The reasons behind each rule are in the Decisions table of [docs/design.md](docs/design.md). The collection rules and the display rules are built (`src/github/`, `src/model.ts`); the page itself arrives with the renderer (build step 4).

**What's collected**
- Public activity only. The token can only read public data, and anything marked private is dropped on arrival anyway, in case a token can see more. The log reports how many items were dropped, never their names.
- Items: commits, pull requests, issues, issue and commit comments, discussions, discussion replies, reviews, and repos you created or forked. Your public org memberships and GitHub's daily contribution counts are collected too.
- Every timestamp is stored in UTC.

**Commits**
- Commits in your own repos, forks included, come from each repo's default branch. Commits in other people's repos come from GitHub's commit search, which only covers default branches.
- A fork is read only from the day you forked it; older commits belong to the upstream.
- Each commit is counted once. When the same commit is found in several repos, it's credited to the one that isn't a fork; if all are forks, to your own fork. A commit that exists only in your fork stays with your fork.

**Repos and forks**
- **Projects** shows your favorites (if set) and then your own repos. **Contributing to** shows other people's repos you've worked in.
- A fork you made to contribute upstream isn't listed on its own: your commits in it (and the odd pull request or issue opened inside it) are counted on the upstream's row in Contributing to, with a link to the fork.
- A fork you've **adopted**, meaning you've opened 3 or more pull requests or issues inside it, is your own project: it's listed under Projects as "fork of …" and keeps its own commits. Pull requests you send upstream still count on the upstream's row, so a fork can show in both places without anything counted twice. The fork's name isn't used to decide this, since upstream repos get renamed too.
- A fork whose upstream was deleted is listed under Projects, marked as such. Forks with no work of yours aren't listed, though "forked X" still appears in the feed.
- Favorites (`ACTIVITY_FAVORITES`) are shown in your order and aren't repeated in the list below them. A favorite that isn't a public repo GitHub knows about is left out; the run's log says how many, without names.

**Feed and dates**
- Which day an item falls on is decided by your time zone (`ACTIVITY_TIMEZONE`). Items of the same kind, in the same repo, on the same day become one expandable row: commits from 2, everything else from 3.
- The page never says "today" or "yesterday". Dates are plain; items under a week old show their age ("5 h ago"), worked out in the visitor's browser.
- Issue and commit comments are collected but hidden unless `ACTIVITY_FEED_COMMENTS` is on.

**When something goes wrong**
- A run fails, and doesn't deploy, on an API error that persists after retries, a GraphQL error, or a commit search reporting incomplete results. A deleted repo is simply skipped.
- A rate-limit wait of up to 90 seconds is waited out; a longer one fails the run.
- The live page stays as it was until a run succeeds. A run also refuses to deploy if the number of items fell by more than 10% (build step 5).

## Development

Needs Node 24 or later and [just](https://github.com/casey/just); bring them however you like (your own dev environment files, such as `.envrc` or `.flox/`, are gitignored). Then `npm install`, which only adds the type-checker.

Copy `.env.example` to `.env` and set `GH_PAT` and `ACTIVITY_USER` to run against the live API (the Justfile loads `.env`); tests run offline from fixtures. For `GH_PAT`, create a fine-grained token (GitHub → Settings → Developer settings → Fine-grained tokens) with repository access **Public repositories (read-only)**, no other permissions, and an **expiry of one year or less**: some organizations (NixOS, for one) refuse fine-grained tokens that live longer, even for public data, and a run then fails. Renew it before it expires; GitHub emails you a few days ahead, and an expired token makes every run fail.

- `just test` runs the offline tests (`node:test`, TypeScript run directly, no build step);
- `just typecheck` type-checks;
- `just collect` fetches your public data into `state.db` (a few minutes; mostly commit search, which allows 30 requests a minute). It prints counts only, never titles, and drops anything private;
- `just render` builds `dist/index.html` from it in under a second, with no network (build step 4);
- `just dev` re-renders on every save, so you can iterate on the page without fetching again (build step 4);
- `just record-fixtures` does the same and saves every API exchange to `test/fixtures/recorded/github.json.gz`, which the tests replay. It refuses to save if any response holds private data, so use the public-only token.

**Status:** build steps 1–3 are done: the skeleton, the GitHub collector (`src/github/`, tested against a fake GitHub and a recording of a real account), and settings plus the render model (`src/settings.ts`, `src/model.ts`), which holds every display rule. Next is the renderer (build step 4).

## Docs

- [docs/design.md](docs/design.md): decisions, architecture, data sources, schema, settings, testing, build plan, open questions, and the deferred design for private repos.
- [docs/research.md](docs/research.md):
  - what GitHub shows natively;
  - API limits, with live measurements;
  - existing tools (github-readme-stats, lowlighter/metrics, archive-style projects) and why they fall short.
- A throwaway prototype of the v1 page on your real public data: `just prototype` fetches it (with your local `gh` login, dropping anything private) and serves the page on http://localhost:8137. The data file is gitignored.
- The earlier prototype of the three views is under the [`archive/prototype-views`](https://github.com/jonocodes/activity/tree/archive/prototype-views) tag.

## License

GPL-3.0. See [LICENSE](LICENSE).
