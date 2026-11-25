# Design

A static page showing all of a person's GitHub activity: commits, repos created or forked, issues, PRs and discussions, including work in other people's repos, plus general profile facts. Private work is recorded too, and shown at a level of detail the owner picks per repo or org.

The first user is the author (`jonocodes`), so examples and measurements use that account. The tool itself must have no hard-coded user: a fork works with nothing but config and secrets.

Designed 2026-11-23 to 2026-11-24, before any code. Background (what GitHub shows natively, API limits, every existing tool considered and why each falls short): [research.md](research.md).

## Decisions

| Decision | Why |
|---|---|
| Build our own instead of adopting a tool | Nothing existing covers commits, forks, issues, PRs and discussions together with history past 30 days and visibility rules (see research) |
| Public repo, run hourly in GitHub Actions | Public repos get free Actions minutes. Every run shows in the Actions tab and can be started by hand (`workflow_dispatch`) |
| Host on GitHub Pages, deployed straight from the workflow | Code, schedule, logs and site in one place. Deploys need no commits |
| The page is pre-rendered HTML; it never queries a database | The views are simple filters and groupings over a few thousand public items. The renderer reads the data inside the Action and writes finished HTML: no data file to fetch, no sql.js |
| One page with the full history | Measured: every public item pre-rendered is about 0.7 MB raw but about 60 KB compressed, since repeated markup compresses roughly 10×. Allow up to about 1.5 MB / 150 KB as commits fill in. Older years sit in collapsed sections |
| No live fetch from GitHub in the browser | Events take 30 s to 6 h to appear, so it's barely fresher than hourly. It would also have to ship the hidden-repo list to the browser |
| Optional state store: a SQLite file in a private Cloudflare R2 bucket | See [What the state store adds](#what-the-state-store-adds). Without it, every run fetches everything. The author's instance turns it on |
| SQLite file in R2, not a hosted database | A run downloads one file of a few MB, queries locally, uploads it. Cloudflare D1 means an API round trip per query from Actions, and only fits once the code runs inside a Worker. Turso or Postgres add an account for no gain |
| Visibility rules per repo or org, stored as an Actions secret | Lets the owner hide or anonymise things. A file in a public repo would leak the hidden list |
| Collect private activity too (repo, commits, line counts) | Cheap with the same token. Stored; displayed only as the rules allow |
| A template others fork: everything personal lives in config and secrets | Nobody edits code. Upstream ships `config.example.toml`; a fork adds `config.toml`, which upstream never touches, so "Sync fork" never conflicts. The user defaults to the repo owner |
| Every stored item has a `source` (`github` first) | Hacker News is likely next, possibly custom (e.g. reading GoatCounter); Codeberg (Forgejo API) after that. Each source is a module writing to the same tables. A failing source keeps its last data and doesn't stop the run |
| Combine all three prototype views | A stats strip (variant C) above a shared heatmap, then Feed (A) and Projects (B) tabs. Clicking a project filters the feed. Screenshots: [img/](img/) |
| Pinned projects at the top of the Projects view | Defaults to GitHub's own pins (GraphQL `pinnedItems`, live each run). `pinned = [...]` in config overrides them and can include upstream projects or Codeberg repos |
| List org memberships, including ones private on GitHub | Memberships are private by default on GitHub, not usually by choice. A rule can hide a single org. Needs `read:org` |
| Archive the 30-day events feed from the first run (when state is on) | The only record of pushes to non-main branches and branch create/delete. History from before the first run can't be recovered |
| Achievements: a link only | No API exists. Link to `github.com/<user>?tab=achievements` |
| TypeScript | Runs on Node in Actions now, and in a Cloudflare Worker if it ever moves there |
| Not doing: RSS output, SVG README cards, a public sql.js query box | Not wanted for now. SVG cards matter only for embedding in a GitHub profile README (GitHub strips everything but images). A public `.db` plus sql.js could be added later at little cost |

## Architecture

```
GitHub Actions (hourly)
  ├─ [state on] download state.db from a private R2 bucket
  ├─ fetch from GitHub (all, or only what's new) ──► state.db ──► [state on] upload back to R2
  └─ render HTML from state.db, applying config + rules ──► dist/ ──► GitHub Pages
```

Visitors always get the last deployed static page, instantly. The run time only matters to the Action.

The first run starts from an empty `state.db` and fetches the full history; that is the backfill, with no separate code path. With state on, later runs only fetch what's new and never delete an item that disappeared from GitHub (they mark it gone). To see everything, including private data, download `state.db` and open it with Datasette or `sqlite3`.

### What the state store adds

Nearly everything on the page can be fetched again from GitHub on every run. State matters only for things GitHub forgets.

| Data | Re-fetchable any time? | What a stored copy adds | Value |
|---|---|---|---|
| Issues, PRs, comments, discussions | Yes, back to 2012 | Survives the repo being deleted, made private, or access lost | Small |
| Commits on main branches, with line counts | Yes, while the repo is readable | Same as above | Small for public repos |
| **Private work at a job you later leave** | **No.** After leaving, GitHub keeps only anonymous daily counts | Org, repos, commit and line counts survive the job change | **The main reason** |
| Pushes to non-main branches; branch create/delete | Only for 30 days (events). Walking the branches of your own repos covers branches that still exist, and PRs keep their commits after a branch is deleted | Branches deleted without a PR; repos you can't read | Small |
| Followers, stars received | Current values only (stars have dates, followers don't) | Growth over time | Vanity |
| Daily counts incl. private totals; pins; orgs; profile | Yes, live | Nothing | None |
| **Speed** | A full fetch: measured 99 s for issues, PRs, comments and discussions with sequential requests, plus at least a minute of commit search (30 searches a minute). Roughly 3–5 min, less with parallel requests | Incremental runs take seconds | Practical; matters more for bigger histories |

Other state stores a fork could use later, behind the same interface: S3, or `state.db` encrypted with a key from Actions secrets and committed to a separate branch (needs no account beyond GitHub).

### Data sources

Live numbers and the limits behind each are in [research.md](research.md).

| Data | Source | Notes |
|---|---|---|
| Profile: created, location, company, website, followers, orgs, gists, stars given, pins | GraphQL `viewer` | Author's account created 2012-01-06; 8 orgs, all private on the public profile |
| Repos owned, forks and their upstream, stars and forks received | GraphQL `viewer.repositories` | `isFork`, `parent`, `isPrivate`, language, topics |
| Issues, PRs, issue comments, commit comments, discussions, discussion replies | GraphQL `viewer.issues`, `pullRequests`, `issueComments`, `commitComments`, `repositoryDiscussions`, `repositoryDiscussionComments` | Full history, no time window. Newest first; with state, stop at the last item stored |
| Commits (sha, message, date) | REST commit search `author:<user>`, sliced by date | Main branches only; at most 1000 results per query, so slice by year or month |
| Commit line counts (incl. private) | GraphQL `history(author: {id})` on each repo's default branch: `additions`, `deletions` | Tested on a private org repo: 401 commits in a year, 1 point per 100 commits. Works with the `repo` scope |
| Daily counts, reviews, private totals | GraphQL `contributionsCollection`, at most one year per query | All years once (2009–2026 for the author: 18 calls), then the current year |
| Pushes to non-main branches, branch create/delete | REST `/users/<user>/events`, with ETags (a 304 is free) | GitHub keeps 30 days and 300 events; 300 covered about 10 days for the author, so hourly is plenty |
| Later: commits on every branch of your own repos | REST commits per branch, only for repos whose `pushed_at` changed | Idea from kibotu/git-history-timeline (see research) |

### SQLite schema (sketch)

Every row carries `source`.

- `profile`: one row per run (date, followers, stars received, …)
- `repos`: name_with_owner, owner, is_private, is_fork, parent, created_at, pushed_at, language, stars, description, gone_at
- `items`: node_id, kind (issue, pr, issue_comment, commit_comment, discussion, discussion_reply, review), repo, created_at, title, url, state, merged_at, gone_at
- `commits`: sha, repo, authored_at, first line of message, additions, deletions
- `events`: event id, type, repo, branch, created_at
- `orgs`: login, name, membership public or not
- `calendar`: date, total. `year_totals`: year, commits, issues, prs, reviews, restricted
- `runs`: started, finished, API calls used, error

Size: a few MB, mostly commits and line counts. Measured: 1568 public items made a 380 KB SQLite file.

### Generated site

- **`index.html`** holds:
  - the profile and stats strip;
  - the heatmap;
  - pinned projects;
  - Feed and Projects tabs;
  - older years in collapsed sections.

  It's pre-rendered, with a little JavaScript for the filter chips and tabs.
- **Theme:** follows the system light/dark setting. The author wants it to look like their blog (`jonocodes/blog`, Eleventy, `public/css/index.css`); a fork gets a neutral default.
- **URL:** `<user>.github.io/activity/` or a custom domain. For the author, `activity.dgt.is`: the blog is a separate Pages project on `www.dgt.is`, so the page can't sit at `www.dgt.is/activity/`. The blog menu links to it.
- **Feed rules carried over from the prototype:**
  - same-day commits to one repo collapse into "N commits";
  - bursts of issues should collapse the same way ("opened 12 issues in X");
  - issue comments are hidden by default.

## Workflow

```yaml
on:
  schedule: [{ cron: '23 * * * *' }]   # hourly; avoid :00, which GitHub delays at busy times
  workflow_dispatch: {}
concurrency: { group: activity, cancel-in-progress: false }   # one writer of state.db at a time
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx wrangler r2 object get activity-state/state.db --file state.db --remote || true   # state on only
      - run: node collect.js && node render.js        # GH_PAT and ACTIVITY_RULES come from secrets
      - run: npx wrangler r2 object put activity-state/state.db --file state.db --remote          # state on only
      # then actions/upload-pages-artifact + actions/deploy-pages with dist/
```

Gotchas:
- **Logs are public.** The job prints counts only, never names from private repos.
- **Disabled schedules:** GitHub turns off scheduled workflows in a public repo after 60 days without repo activity. Deploys don't commit, so add a keep-alive (e.g. a monthly commit).
- **Forks:** Actions stay off in a fork until its owner enables them in the Actions tab. That's a setup step to document.
- **Secrets:** the personal token, the rules and the Cloudflare token are Actions secrets. The built-in `GITHUB_TOKEN` only sees its own repo, so it can't be used.

## Config

`config.toml` is public and holds no secrets. See [config.example.toml](../config.example.toml).

## Visibility rules

Stored in the `ACTIVITY_RULES` secret (TOML). See [rules.example.toml](../rules.example.toml). Matching is `owner/*` or `owner/repo`; the most specific rule wins. Rules apply at render time, except `ignore`, which applies at collection time.

| Level | Page shows | Stored |
|---|---|---|
| `full` | Everything: repo name, titles, links | Yes |
| `org` | The org name with counts and line totals; no repo names or titles | Yes |
| `anonymous` | Counted in totals only ("private work") | Yes |
| `hidden` | Nothing | Yes |
| `ignore` | Nothing | Never collected |

Defaults: public repos `full`, private repos `org`.

### Past private work

GitHub keeps counting work in private repos you can no longer access, but won't say where it was. For the author, `contributionsCollection` reports restricted contributions of 52 in 2015, 74 in 2016, 109 in 2017 and 122 in 2018, with no repo, and the token sees no private repo created before 2020. `read:user` doesn't help; it only details repos you can still read.

Two ways to show the org anyway:
- **`[[period]]` rules from a CV:** restricted counts inside a date range are credited to a named org. The page marks this as the owner's claim, not GitHub's.
- **Old clones:** `git log --author=… --numstat` gives exact commits and line counts, imported as a manual source.

## Token

A dedicated token, stored as the `GH_PAT` Actions secret.
- **Simplest:** a classic PAT with `repo`, `read:user` and `read:org`. Downside: `repo` also grants write access.
- **Least privilege:** read-only fine-grained PATs, but each covers a single owner (the user, plus one per org), and org tokens may need admin approval. Orgs can also block classic PATs or require SSO approval.

## Testing

- **Recorded fixtures** of GraphQL and REST responses, so collect and render run without the network.
- **Render as a pure function of (database, config, rules),** checked against snapshot HTML.
- **Privacy tests:**
  - no name of a `hidden`, `anonymous` or `org`-level repo appears in `dist/`;
  - none appears in the job's log output.
- **A live smoke test,** run by hand or with `workflow_dispatch`.

## Prototype

The three views were prototyped as a throwaway page with real public data. The code is on the [`prototype/views`](https://github.com/jonocodes/activity/tree/prototype/views) branch, not `main`. It's a standalone `prototype/index.html`, switchable with `?variant=A|B|C` or the ← → keys.

The same branch has the probe scripts behind the measurements:
- `build_fixture.py`, with its GraphQL query in `q.graphql`;
- `size_probe.py`;
- `html_size.py`.

Verdict: the author liked all three, which led to the combined layout above.

## Build plan

Each step ends with tests passing and the README updated.

1. **Skeleton:**
   - TypeScript project;
   - Justfile (`just test`, `just collect`, `just render`, `just dev`);
   - test runner;
   - the SQLite adapter.
2. **GitHub collector into SQLite,** driven by recorded fixtures: profile, repos, the GraphQL connections, `contributionsCollection` by year, commit search slices, line counts.
3. **Config and rules loading;** a render model that applies them, plus the privacy tests.
4. **Renderer:** the combined page, built from the prototype views, as snapshot-tested HTML.
5. **Workflow:** scheduled Action deploying to Pages, stateless at first.
6. **State store:** R2 download and upload, incremental fetching, the events archive, `gone_at`.
7. **Later:**
   - branch walk;
   - `[[period]]` rules;
   - Hacker News source;
   - Codeberg source;
   - custom domain.

## Open questions

- **`[[period]]`:** which past employers, dates and org names, and do any old clones survive?
- **Runtime:** Node or Bun?
- **Test runner:** which one?
