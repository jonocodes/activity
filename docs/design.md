# Design

A static page showing all of a person's public GitHub activity: commits, repos created or forked, issues, PRs and discussions, including work in other people's repos, plus general profile facts. Private repos are left out of v1 and planned as a later feature (see [Future: private repos](#future-private-repos)).

The first user is the author (`jonocodes`), so examples and measurements use that account. The tool itself must have no hard-coded user: a fork works with nothing but Actions variables and secrets.

Designed 2026-11-23 to 2026-11-24, before any code, and revised on 2026-11-24 after a review. Background (what GitHub shows natively, API limits, every existing tool considered and why each falls short): [research.md](research.md).

## Decisions

| Decision | Why |
|---|---|
| Build our own instead of adopting a tool | Nothing existing covers commits, forks, issues, PRs and discussions together with history past 30 days (see research) |
| Public repo, run hourly in GitHub Actions | Public repos get free Actions minutes. Every run shows in the Actions tab and can be started by hand (`workflow_dispatch`) |
| Host on GitHub Pages, deployed straight from the workflow | Code, schedule, logs and site in one place. Deploys need no commits |
| The page is pre-rendered HTML; it never queries a database | The views are simple filters and groupings over a few thousand public items. The renderer reads the data inside the Action and writes finished HTML: no data file to fetch, no sql.js |
| **The main page holds the last 12 months; each older year is its own static page, fetched when opened** (2026-11-26, revised after measuring) | Measured on the author's data: the full history pre-rendered is about 2 MB raw, 247 KB compressed, 1,500 feed rows, which is about 5 s on a slow mobile connection, and it grows every year. The last 12 months alone is 128 KB compressed and 700 rows. Every count and chart is worked out at build time, so the main page doesn't need older items' details. Opening an older year's section fetches its pre-built fragment; without JavaScript the section links to the year's own page (`/2017/`), which is also shareable. Still plain files on Pages: no server, no API. If the last 12 months gets too long for phones, the same split can apply again (for example the latest 3 months plus the rest of the year) |
| No live fetch from GitHub in the browser | Events take 30 s to 6 h to appear, so it's barely fresher than hourly |
| **v1 collects public data only; private repos are a later feature** (2026-11-24) | Privacy is the hard requirement, and the rules for showing private work had many unresolved edge cases. With a token that can only read public data, the build never sees anything private, so nothing private can leak: the token enforces it, not the code. Cost: the author's current private work isn't recorded until the feature exists. See [Future: private repos](#future-private-repos) |
| The collector also drops anything marked private, whatever the token can see | Defence in depth: someone forking may paste a token with the `repo` scope. Dropped items are counted in the log, never named |
| **No state store in v1; add it later** (2026-11-24) | Its main reason was private work, now deferred. Without it each hourly run fetches everything (about 3–5 min, free) and the data is thrown away afterwards; the page is the same. Design iteration doesn't suffer: locally, `just collect` fetches once and `just render` re-renders from that file as often as you like (see [Working on the page locally](#working-on-the-page-locally)). Cost: public pushes to non-main branches older than 30 days are lost until the store exists. When it comes, the leading option is text files on a `data` branch of this repo (2026-11-25). See [Later: the state store](#later-the-state-store) |
| Each run still writes a SQLite file (`state.db`), even without the store | Same format locally, in the Action, and for the store when it comes, so adding the store means persisting a file that already exists rather than changing the code path |
| **Settings are Actions variables (env vars), not a committed file** (2026-11-24) | The author's own instance is the upstream repo, so a committed `config.toml` would reach every fork on "Sync fork". Actions variables live in each repo's settings and forks don't inherit them. Nothing in the settings is secret now. Every setting has a default, so a new fork needs none. Locally the same names come from `.env` through direnv. See [Settings](#settings) |
| A template others fork; nobody edits code | Upstream never holds anyone's settings, so "Sync fork" never conflicts. The user defaults to the repo owner |
| **Each commit is counted once, even when search finds it in several repos** (2026-11-24) | Commit search returns the same sha in a repo and again in every fork that contains it, which would count one commit several times. Keep one row per sha, credited to the repo that isn't a fork; if every hit is a fork, prefer the user's own fork. A commit that exists only in a fork stays credited to that fork, since it may never have been merged upstream |
| Every stored item has a `source` (`github` first) | Hacker News is likely next, possibly custom (e.g. reading GoatCounter); Codeberg (Forgejo API) after that. Each source is a module writing to the same tables. A failing source keeps its last data and doesn't stop the run |
| Combine all three prototype views | A stats strip (variant C) above a shared heatmap, then Feed (A) and Projects (B) tabs. Clicking a project filters the feed. Screenshots: `docs/img/` in the [`archive/prototype-views`](https://github.com/jonocodes/activity/tree/archive/prototype-views/docs/img) tag |
| **Favorites, not GitHub pins** (2026-11-25) | The owner picks which repos to highlight, and in what order, with `ACTIVITY_FAVORITES`, independent of their GitHub pins. Unset means no Favorites section. Any repo can be a favorite, own or external. A favorite appears once: it's left out of the My projects list below it. Only a known public repo is shown (the collector fetches favorites' details too); anything else is skipped, since a row would link to a page visitors can't open, and the log counts it without a name, because logs are public and the name might be private |
| **Three tabs: Feed, Projects, Contributing to** (2026-11-25) | The owner's own work and their work in other people's repos are different stories, so "Contributing to" gets its own tab instead of being a group inside Projects. Named "Contributing to", not "Contributions", because a contribution is GitHub's daily counted unit (see `GLOSSARY.md`), which includes own repos |
| List public org memberships only (2026-11-24) | Memberships are private by default on GitHub; publishing them is a private-data choice, deferred with private repos. REST `/users/<user>/orgs` lists only public memberships whatever the token, and needs no scope |
| Archive the 30-day events feed once the state store exists | The only record of pushes to non-main branches and branch create/delete. History from before the first run can't be recovered |
| **Neutral theme only, with a visitor's color-mode toggle** (2026-11-25, toggle added 2026-11-27) | The page doesn't need to match the author's blog, so there's no theme setting for the owner. It follows the system light/dark setting, with dark colors chosen for the dark background rather than inverted. Visitors can override it with a button in the top corner, Auto → Light → Dark, remembered in their browser (`localStorage`). A one-line script in `<head>` applies a saved choice before the page draws, so there's no flash of the wrong theme; the palette is one set of `light-dark()` colors switched by `color-scheme`, so light and dark can't drift apart. Without JavaScript there's no button and the system setting applies. On phones the button shows only its icon |
| **A custom title is a headline** (2026-11-27) | The author wanted their page to say "A LOT GOING ON AT THE MOMENT", after Taylor Swift's shirt, with "A LOT" in red. It's the owner's setting (`ACTIVITY_TITLE`), not the tool's name or a default, so forks don't inherit the reference; the repo stays `activity`, which says what it does and keeps the Pages URL. A custom title renders big and heavy, with two bits of markup: `*words*` in red and `\|` for a deliberate line break (on a phone, a long title otherwise wraps wherever it runs out of room). The page still says whose it is: the profile line starts with "<user> on GitHub". Considered and dropped: a heading that switches to "NOT A LOT GOING ON" when the owner is quiet (the original shirt), and a logo styled like the shirt |
| **A failed run doesn't deploy** (2026-11-25) | With no state store, a half-failed fetch would publish a thinner page. Pages keeps serving the last good page instead. See [When a run fails](#when-a-run-fails) |
| **No Events API in v1** (2026-11-25) | Without a state store, pushes to non-main branches would show for 30 days and then vanish. Events come back with the state store, and v1 loses a whole collector |
| **Tests use recorded fixtures plus small hand-written ones** (2026-11-25) | Recordings of the author's real (public) API responses keep the fixtures true to the API; hand-written fixtures cover edge cases a real account may not have. The no-hard-coded-user rule applies to code and tests, which read the login from settings or the fixture, not to recorded data |
| **Forks fold into their upstream; no Forks group** (2026-11-25) | A fork is usually just how the owner made pull requests upstream, so a separate group repeated "Contributing to". Commits in a fork count on the upstream's row, with a link to the fork. Forks without items aren't listed (the "forked X" item stays in the feed). A fork whose upstream was deleted shows under "My projects", marked as such |
| **Adopted forks are the owner's projects** (2026-11-25) | Some forks aren't for contributing but for running the owner's own version (the author's `tunnel-toggle`: 14 PRs opened inside the fork). A fork is adopted when the owner has opened 3 or more pull requests or issues inside it (the same threshold as groups); a single PR inside a fork is usually an accident or a test, and the author has three of those. An adopted fork is listed under My projects, marked "fork of …", and commits that exist only in it stay on its row. Work sent upstream still counts on the upstream's row, and each commit is counted once, where it landed, so a fork can appear in both places with no double counting. The name isn't used as a signal: upstreams rename too (the author's `swagger-js` fork's upstream is now `swagger-client`). An explicit override belongs with the planned allow/deny lists |
| **Commits in own repos come from walking their default branches; search covers the rest** (2026-11-25) | Found with the prototype: commit search returned no commits at all in the author's own forks, because GitHub search leaves most forks out. The collector already walks each own repo's default branch (`history(author:)`) for line counts, so that walk is also the commit source for own repos, forks included. Commit search stays the source for other people's repos |
| **An overview of licenses and languages as ranked bars** (2026-11-25, revised after the prototype) | Seen on real data, one-color horizontal bars (largest first, figure at the end) read at a glance; a pie can't compare small slices. Licenses count own repos that aren't forks; languages are weighted by the owner's commits (each repo's main language), top 6 plus Other. One color, not GitHub's language colors. Commits still lead the stats strip |
| **Licenses: the overview bars plus a badge per own repo** (2026-11-25) | Cheap (one field per repo) and says something about the owner's work. Only licenses in use are counted; unlicensed repos get no badge and no count (27 of the author's 55 have none) |
| **A short profile summary** (2026-11-25, revised 2026-11-27) | Just "N years of open source" and an achievements link (the author cut it down from bio, location, company and orgs). The years count from the owner's earliest dated work, not the account date: the author's account dates from 2012, but imported history goes back to 2009, and the longer span matters more. Counting years reads better than a start year, and doesn't need the word GitHub. Bio, location and company are still collected, in case they come back |
| **Active days instead of streaks** (2026-11-27) | A streak mostly measures whether the owner happened to touch GitHub yesterday. Days with any contribution in the last 12 months (297 of 365 for the author) say how consistently they work, without one quiet day resetting it |
| **No private count and no "first contribution" box** (2026-11-27) | GitHub's anonymous count of private contributions (`restrictedContributionsCount`) was shown as "private, last 12 months". It holds no private details, but unexplained it read as private data on a public-only page, so it's gone; the collector still records it. GitHub's calendar may already include private contributions as anonymous daily counts (as on the owner's own profile), with no way to separate them per day; the page doesn't label them. The "first contribution" year on Contributing to was dropped as irrelevant; the per-year chart already shows when it starts |
| **The heatmap is labeled, like GitHub's** (2026-11-27) | Unlabeled, it was unreadable to anyone who doesn't already know GitHub's graph (the owner included). It now has a heading, month names along the top, Mon/Wed/Fri down the side, a less-to-more key, and tooltips ("Fri, Nov 20, 2026: 2 contributions") that appear on hover with a mouse and on tap on a phone. On narrow screens it keeps readable squares and scrolls sideways, opening on the newest weeks. Replacing it with monthly columns, or dropping it, were the alternatives; it stayed because it's the one chart that shows working rhythm (busy stretches, quiet months, weekends) |
| **The footer says how old the data is and links the source repo** (2026-11-27) | The page is only as fresh as its last successful run, and a failed run leaves the old page up; "Updated 3 h ago" makes that visible to the owner and visitors. The time is when the data was fetched, not when it was rendered, so a local render of a day-old `state.db` honestly says "1 d ago". The link ("Made with owner/repo: fork it to make a page of your own") is how a visitor finds the tool. It's the repo the page was built from (`GITHUB_REPOSITORY` in Actions, the git remote locally), so a fork links to itself rather than to upstream, and nothing hard-codes the author; GitHub shows where a fork came from |
| **"Repos contributed to" is a stat; Contributing to has no headline numbers** (2026-11-27) | The panel opened with "137 repos · 119 owners and orgs". The owner count said little (most external repos have their own owner), and the repo count reads better next to "repos created" in the all-time stats. The stats strip now has two labeled groups, All time and Last 12 months, which also keeps it on one line on a desktop. In the panel, the per-year chart's year labels sat right above the rows' timeline axis, so the axis read as part of the chart: the chart is now closed off by a line, and the axis sits directly on the rows it labels, under the sort toggle |
| **Older years open with a summary** (2026-11-25) | The calendar is fetched a year at a time anyway. The top heatmap shows the last 12 months; each collapsed older year opens with that year's totals (contributions, commits, PRs, issues, discussions, new repos), its heatmap and its most active repos, then its items. Taken from the prototype's year-by-year variant, which was otherwise dropped; expect to iterate on it |
| **Depth on Projects, breadth on Contributing to** (2026-11-25, from the prototype) | Sparklines undersold sparse work: one PR drew a flat line with a blip. Projects rows show commits per month over the last 24 months as columns (a quiet month draws only the baseline). Contributing to leads with the breadth: repos, owners and orgs, first year, and a chart of external repos worked in per year; each row has a dot per item on a shared timeline. A dot's hover text is only the kind and date: titles stay on the year pages, which keeps hundreds of old titles off the main page |
| **Repo lists ordered by "Top" (frecency), with a toggle** (2026-11-27) | Ordering by last activity put one-off drive-bys (1 item) at the top of Contributing to and the author's busiest project (savr, 506 items) seventh in Projects; ordering by all-time work let an old job dominate. "Top" scores each commit, pull request, issue and discussion as 1, halving in weight every year of age (a 1-year half-life: last month about 1, a year ago 0.5, five years ago 0.03), so a repo needs both a lot of work and recent work. A 6-month half-life was also compared and leaned too hard on the last few months. The page is pre-rendered in this order; a small toggle ("Top · Recent · Most work") re-sorts in the browser from numbers on each row. No setting for now; one can follow if a fork owner wants another default. Favorites keep the owner's order |
| **Details for external repos** (2026-11-25) | Description, stars, license and main language for every external repo on the page, batched about 25 to a GraphQL query (about 6 calls for the author's 138). The languages bars need them too |
| Achievements: a link only | No API exists. Link to `github.com/<user>?tab=achievements` |
| **Dates: stored in UTC, grouped in the owner's time zone, ages shown by the browser** (2026-11-24) | A page rendered hourly in UTC can't say "today": it goes stale when a run fails and is wrong for most visitors. The prototype already put "yesterday" items under the previous week. See [Dates and time zones](#dates-and-time-zones) |
| **TypeScript on Node 24** (2026-11-24) | Node 24 runs `.ts` files directly (type stripping) and has `node:sqlite` and `node:test` built in: no build step, no native modules, few dependencies. It's on the Actions runners already, and the code could move to a Cloudflare Worker later. Bun would also work; Node needs nothing extra |
| **The repo needs only Node 24 and just; dev environment files stay local** (2026-11-25, revised) | Flox and direnv are the author's personal workflow, not something a fork should inherit. `.flox/` and `.envrc` are gitignored; the Justfile loads `.env` itself (`dotenv-load`) |
| **Keep-alive by re-enabling the workflow through the API, not by committing** (2026-11-24) | GitHub turns off scheduled workflows after 60 days without repo activity, and this repo's runs never commit. Each run calls `gh workflow enable` with `GITHUB_TOKEN` (`actions: write`), so the repo needs no extra commits. This is the approach `keepalive-workflow` uses in its API mode; to be confirmed once built |
| Not doing: RSS output, SVG README cards, a public sql.js query box | Not wanted for now. SVG cards matter only for embedding in a GitHub profile README (GitHub strips everything but images). A public `.db` plus sql.js could be added later at little cost |

## Architecture

```
GitHub Actions (hourly)
  ├─ collect: fetch all public data from GitHub ──► state.db (on the runner, discarded after the run)
  └─ render: state.db + settings ──► dist/ ──► GitHub Pages
```

Visitors always get the last deployed static page, instantly. The run time only matters to the Action.

Every v1 run starts from an empty `state.db` and fetches the full history, so there's no separate backfill code path. Once the state store exists, runs will start from the stored copy and fetch only what's new.

### Working on the page locally

Collecting and rendering are separate steps, and `state.db` stays on your disk between them (it's gitignored):

```
just collect   →  fetches from GitHub once (a few minutes)  →  state.db
just render    →  state.db + settings → dist/index.html      →  under a second, no network
just dev       →  re-renders on every save and serves dist/  →  edit, refresh
```

Fetch once, then iterate on the page as often as you like; run `just collect` again only for fresher data. The tests render from recorded fixtures instead, and `just dev` can too, so design work needs no token at all. To explore the data, open `state.db` with Datasette or `sqlite3`.

### Later: the state store

Not in v1 (decided 2026-11-24; tracked in [#2](https://github.com/jonocodes/activity/issues/2); the discussion, measurements and pros and cons are in [research-state-store.md](research-state-store.md)). The plan: keep `state.db` between runs, so a run fetches only what's new and never deletes an item that disappeared from GitHub (it marks it gone). Nearly everything on the page can be fetched again on every run; the store matters only for things GitHub forgets, and for speed.

| Data | Re-fetchable any time? | What a stored copy adds | Value |
|---|---|---|---|
| Issues, PRs, comments, discussions | Yes, back to 2012 | Survives the repo being deleted, made private, or access lost | Small |
| Commits on main branches, with line counts | Yes, while the repo is readable | Same as above | Small for public repos |
| Private work at a job you later leave | **No.** After leaving, GitHub keeps only anonymous daily counts | Org, repos, commit and line counts survive the job change | Was the main reason; deferred with [private repos](#future-private-repos) |
| Pushes to non-main branches; branch create/delete | Only for 30 days (events). Walking the branches of your own repos covers branches that still exist, and PRs keep their commits after a branch is deleted | Branches deleted without a PR; repos you can't read | Small |
| Followers, stars received | Current values only (stars have dates, followers don't) | Growth over time | Vanity |
| Daily counts incl. the anonymous private total; orgs; profile | Yes, live | Nothing | None |
| **Speed** | A full fetch: measured 99 s for issues, PRs, comments and discussions with sequential requests, plus at least a minute of commit search (30 searches a minute). Roughly 3–5 min, less with parallel requests | Incremental runs take seconds | Practical; matters more for bigger histories |

Where to keep it (2026-11-25):

- **Leading option: text files on a `data` branch of this repo.** Each table is saved as sorted JSON lines, split by year (e.g. `commits/2024.jsonl`). A run rebuilds `state.db` from them in seconds, collects, writes them back, and commits only if something changed.
  - No extra account or secret: the workflow's own `GITHUB_TOKEN` writes it (`contents: write`), and only ever pushes to `data`.
  - Git history is the backup, so a bad run is undone by going back one commit, and `git log` shows what each hour added as readable diffs. Splitting by year keeps files small; old years rarely change.
  - `main` stays clean, and forks don't get the data, since GitHub's fork dialog copies only the default branch unless told otherwise. As a backstop the files record whose data they are, and the collector starts fresh if that doesn't match `ACTIVITY_USER`.
  - The commits may count as repo activity for the 60-day rule (unconfirmed); the API keep-alive stays either way.
  - Catches: everything committed is public permanently, so the privacy test must pass on the files before every commit. When private repos arrive, their data can't be stored here as plain text: it would need encrypting with a key in Actions secrets, or a different store.
- **Rejected: the SQLite file itself on a branch, or as a release asset.** Git can't store small changes to a binary SQLite file cheaply, so keeping hourly history would grow the repo by hundreds of MB a day. Overwriting instead leaves a single copy that a bad run can replace.
- **Rejected: the GitHub Actions cache** (2026-11-25). It suits speed, not being the only copy: restores sometimes fail during GitHub incidents, and a failed restore looks like an empty cache. Details in [research-actions-cache.md](research-actions-cache.md).
- **Fallback: a private Cloudflare R2 bucket or S3**, the original plan, if the data ever can't live in a public repo. A SQLite file rather than a hosted database: a run downloads one file of a few MB, queries locally, uploads it. Cloudflare D1 means an API round trip per query from Actions; Turso or Postgres add an account for no gain.
- **Possible extra: publish `state.db` next to the page on GitHub Pages,** so visitors can explore the raw data (e.g. in Datasette Lite). The data is public anyway.

Safety rules for whichever store, from the 2026-11-24 review: a failed load must not count as a first run, or an empty database gets saved over the real one. Fail on any error other than "not found", and refuse to save fewer rows than were loaded.

### Data sources

Live numbers and the limits behind each are in [research.md](research.md). In v1 every source is read with a public-only token, and anything marked private is dropped on arrival.

| Data | Source | Notes |
|---|---|---|
| Profile: created, bio, location, company | GraphQL `user(login:)` | Author's account created 2012-01-06 |
| Public org memberships | REST `/users/<user>/orgs` | Lists public memberships only, whatever the token. The author has 8 orgs, all private on the public profile, so none show until they make some public |
| Repos owned, forks and their upstream, licenses | GraphQL `repositories` | `isFork`, `parent`, `isPrivate` (drop if true), `isArchived`, `licenseInfo` |
| Issues, PRs, issue comments, commit comments, discussions, discussion replies | GraphQL `issues`, `pullRequests`, `issueComments`, `commitComments`, `repositoryDiscussions`, `repositoryDiscussionComments` | Full history, no time window. Newest first; with state, stop at the last item stored |
| Commits in other people's repos (sha, message, date) | REST commit search `author:<user>`, sliced by date | Main branches only; at most 1000 results per query, so slice by year or month. Search leaves most forks out. The same commit can appear in a repo and its forks; it's counted once (see Decisions) |
| Commits in own repos, forks included, with line counts | GraphQL `history(author: {id})` on each own repo's default branch: sha, message, date, `additions`, `deletions` | 1 point per 100 commits (measured on a 401-commit repo). Commit search misses own forks, so this walk is their only commit source |
| Daily counts, reviews, anonymous private total | GraphQL `contributionsCollection`, at most one year per query | All years once (2009–2026 for the author: 18 calls), then the current year. `restrictedContributionsCount` is a bare number with no repo; check in build step 2 that it comes through a public-only token |
| Later, with the state store: pushes to non-main branches, branch create/delete | REST `/users/<user>/events`, with ETags (a 304 is free) | Not in v1. GitHub keeps 30 days and 300 events; 300 covered about 10 days for the author, so hourly is plenty. Drop events with `public: false` |
| Later: commits on every branch of your own repos | REST commits per branch, only for repos whose `pushed_at` changed | Idea from kibotu/git-history-timeline (see research) |

### SQLite schema

Built in `src/db.ts` (schema version 2; version 1 spelled the `license` column `licence`). Every data table carries `source` (`github` in v1).

- `meta`: schema version. A file from another version is refused rather than migrated, since v1 rebuilds the database every run.
- `profile`: login, created_at, bio, location, company
- `orgs`: login, name (public memberships)
- `repos`: name_with_owner, owner, is_own, is_private, is_fork, is_archived, parent, description, stars, license, language, created_at, pushed_at. Own repos and the external repos on the page both live here
- `items`: node_id, kind (pr, issue, issue_comment, commit_comment, discussion, discussion_reply, review, new_repo, fork; anything else is rejected), repo, created_at, title, url, state, merged_at
- `commits`: sha (one row per commit), repo, authored_at, first line of message, additions, deletions
- `calendar`: date, total. `year_totals`: year, contributions, commits, issues, prs, reviews, restricted
- `runs`: started_at, finished_at, API calls, items collected, items dropped as private, error

Later, with the state store: `events` (event id, type, repo, branch, created_at) and `gone_at` on repos and items.

`is_private` is always false in v1; it stays for the private-repos feature. **Every timestamp must be UTC** (`…Z`): the schema rejects anything else, so a collector that forgets to convert (commit search returns local offsets) fails loudly instead of mis-sorting the feed.

Size: a few MB, mostly commits and line counts. Measured: 1568 public items made a 380 KB SQLite file.

### Generated site

- **`index.html`** holds:
  - the profile line: "N years of open source" (from the earliest dated work) and a link to achievements;
  - the overview: two ranked-bar lists side by side, licenses of own repos and languages by the owner's commits;
  - the stats strip, led by commits, in two labeled groups:
    - All time: commits, pull requests, issues, discussions, repos created, repos contributed to (the number of Contributing to rows);
    - Last 12 months: contributions, and active days (days with any contribution, from GitHub's calendar);
  - the heatmap of the last 12 months, labeled (months, weekdays, a key, tooltips on hover and tap);
  - three tabs:
    - Feed;
    - Projects: Favorites (if set, in the owner's order), then My projects (favorites left out; on every repo row, here and on Contributing to, counts of zero are left out): own repos that aren't forks, with a license badge, archived ones marked, plus adopted forks marked "fork of …" and forks whose upstream was deleted, marked as such;
    - Contributing to: a column chart of external repos worked in per year, closed off by a line; then the sort toggle and the timeline axis directly above the rows; then external repos most recent first, each row with description, stars, license, the owner's commits, pull requests, issues and discussions there (including commits in the owner's fork of it, linked, unless that fork is adopted), and a dot per item on a timeline shared by all rows;
  - older years as collapsed sections, each loading that year's pre-built fragment when opened (or, without JavaScript, linking to the year's own page): its totals, heatmap and most active repos, then its items;
  - on each Projects row, the owner's commits per month over the last 24 months as columns;
  - a footer on every page: "Updated 24 min ago" (when the data was fetched, so a page left behind by failing runs shows its age), the owner's time zone, and "Made with owner/repo", linking the repo the page is built from.

  It's pre-rendered, with a little JavaScript for the filter chips, the tabs, item ages and the color-mode toggle.
- **Theme:** a neutral default that follows the system light/dark setting; visitors can pick Light or Dark with the toggle in the top corner (remembered in their browser). No theme setting for the owner.
- **Narrow screens:** side-by-side blocks stack into one column on a phone: the two overview bar lists, and each Contributing to row, whose timeline moves under the text at full width. The prototype showed the bars vanishing and the timelines running off the screen at phone width.
- **Year pages:** `/<year>/` holds one older year (summary, heatmap, items), linked from the main page and to the neighboring years.
- **URL:** `<user>.github.io/activity/` or a custom domain. For the author, `activity.dgt.is` ([#9](https://github.com/jonocodes/activity/issues/9)): the blog is a separate Pages project on `www.dgt.is`, so the page can't sit at `www.dgt.is/activity/`. The blog menu links to it.
- **Feed:**
  - item kinds: commits, pull requests, issues, discussions, discussion replies, reviews, new repos and forks. Issue and commit comments are collected but hidden unless `ACTIVITY_FEED_COMMENTS` is on;
  - groups: items of the same kind, in the same repo, on the same day (the owner's day) become one row, such as "7 commits" or "opened 12 issues", which expands to list them. Commits group from 2, other kinds from 3. The row sits at the time of its newest item;
  - filter chips per kind, as in the prototype.

### Dates and time zones

- **Stored in UTC.** Every timestamp in `state.db` is UTC.
- **Days and weeks are the owner's.** The page describes the owner's days, so `ACTIVITY_TIMEZONE` (an IANA name, default `UTC`) decides which day an item falls on. That covers collapsing same-day commits, the week headings, the year sections and the habits chart.
- **No relative words baked into the HTML.** Each item renders as `<time datetime="2026-11-23T18:04:00Z">Nov 23</time>`, with the date in the owner's time zone. Without JavaScript that's what visitors see.
- **Ages are durations, computed in the browser.** The script rewrites items under a week old as "12 min ago", "5 h ago" or "3 d ago", worked out when the page is viewed. A duration means the same in every time zone, so it can never contradict a week heading the way a calendar word like "yesterday" can.
- **Hover shows the visitor's own time** (2026-11-27): `site.js` gives every date a tooltip with its exact time in the visitor's time zone ("Nov 19, 2026, 11:30 PM, your time"). Days, groups, weeks and active days stay in the owner's zone: the page is built once for everyone, so they need one definition of a day, and the owner's reads like a diary.
- **The footer** shows when the page was built, so a stale page is obvious.
- **The heatmap** uses GitHub's calendar as given. GitHub decides its day boundaries, so near midnight they may differ slightly from the feed's. That's acceptable.

## Workflow

Built in `.github/workflows/build.yml` (2026-11-27):

- **Triggers:** hourly at :23 (GitHub delays :00 at busy times), and by hand (`workflow_dispatch`) with a `force` option for the shrink guard. One run at a time.
- **build job** (`contents: read`, `actions: write`): checkout, Node 24, `configure-pages` (for the site URL), then `src/cli/collect.ts`, `src/cli/render.ts` and `src/cli/guard.ts`, upload `dist/` as the Pages artifact, and re-enable the workflow (the keep-alive). The code uses only Node built-ins, so there's no `npm ci`. Any failure stops the job, so nothing is deployed.
- **deploy job** (`pages: write`, `id-token: write`, environment `github-pages`): `deploy-pages`.
- **Env:** `GH_PAT` from secrets; `ACTIVITY_VARS` is `toJSON(vars)`, every repo variable at once.
- **Action versions** (checked 2026-11-27, all on Node 24, which GitHub now requires): checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5.

`.github/workflows/test.yml` runs the offline tests on every push and pull request. Both workflows pass `actionlint`.

### When a run fails

- **It doesn't deploy,** so Pages keeps serving the last good page. A run fails on:
  - an API error that persists after retries;
  - a GraphQL response carrying errors;
  - a commit search still reporting incomplete results for a single day. GitHub's search times out on its side now and then and says so with `incomplete_results`; the collector retries the query twice, then splits the date range in half and searches each half, and only fails when one day stays incomplete (added 2026-11-27, after the second live run failed on a six-month slice).
- **Rate limits:** a short wait (the `Retry-After` or reset time) is waited out; a long one fails the run.
- **Shrink guard:** each deploy also publishes `summary.json`, the counts per item kind. The next run fetches it from the live site and refuses to deploy if the total number of items fell by more than 10%. A `force` input on a manual (`workflow_dispatch`) run overrides it.
- **Hearing about it:** GitHub emails a failed scheduled run, by default to whoever last edited the schedule.

Gotchas:
- **Logs are public.** The job prints counts, not item titles.
- **Disabled schedules:** GitHub turns off scheduled workflows in a public repo after 60 days without repo activity. The keep-alive step above handles it without commits.
- **Forks:** Actions stay off in a fork until its owner enables them in the Actions tab. That's a setup step to document.
- **Secrets:** only `GH_PAT` in v1. The built-in `GITHUB_TOKEN` only sees its own repo, so it can't do the collecting.

## Settings

All optional, set as Actions variables (Settings → Secrets and variables → Actions → Variables). Locally, put them in `.env` (see [.env.example](../.env.example)); direnv loads it. The workflow passes every variable in at once (`toJSON(vars)`), so adding a setting never means editing the workflow. An unknown `ACTIVITY_*` name or a bad value fails the run with a clear message listing every problem, and suggests the nearest name for a typo (`ACTIVITY_TIMEZON` → `ACTIVITY_TIMEZONE`). A real env var wins over the same name in `ACTIVITY_VARS`. Built in `src/settings.ts`.

| Variable | Default | What it does |
|---|---|---|
| `ACTIVITY_USER` | the repo owner | GitHub login to build the page for |
| `ACTIVITY_TITLE` | `<user> on GitHub` | A headline instead of "<user> on GitHub": shown big and heavy, with `*starred*` words in red and `\|` for a line break, e.g. `*A LOT* GOING ON \| AT THE MOMENT`. Case is kept as typed. With a headline, the profile line starts with "<user> on GitHub", and the browser tab reads "<headline> · <user> on GitHub" |
| `ACTIVITY_TIMEZONE` | `UTC` | IANA time zone that decides which day an item falls on |
| `ACTIVITY_FAVORITES` | none (no Favorites section) | Comma-separated `owner/repo` list, in display order, shown at the top of Projects. A favorite that isn't a known public repo is left out, and the log counts it without naming it |
| `ACTIVITY_SECTIONS` | all except `habits` | Comma-separated: `profile`, `stats`, `overview`, `heatmap`, `feed`, `projects`, `contributing`, `habits` (busiest hours and weekdays) |
| `ACTIVITY_FEED_COMMENTS` | `false` | Show issue and commit comments in the feed |

## Token

A dedicated token, stored as the `GH_PAT` Actions secret: a fine-grained PAT with repository access set to **Public repositories (read-only)** and no extra permissions. It's read-only, can't see anything private, and needs no org approval. A classic PAT with no scopes ticked is the fallback; it's also public read-only.

**Expiry: one year or less** (found 2026-11-26). Some organizations and enterprises (`cypht-org`, NixOS) forbid fine-grained tokens with a lifetime over 366 days, even for reading public data. The first recording failed on the owner's forks of their repos with a FORBIDDEN error. The collector keeps failing the run on it, since the error names the fix and tolerating it would mislabel those forks; the cost is renewing the token yearly.

Checked in build step 2 (2026-11-26): every query works with this token, and the anonymous private total (`restrictedContributionsCount`) still comes through.

**Renewal reminders:** GitHub's own expiry emails are enough (decided 2026-11-26). The tool doesn't add its own; an expired token fails the run, and GitHub emails about that too.

## Testing

- **Fixtures, so collect and render run without the network:**
  - recordings of real GraphQL and REST responses from the author's public data, refreshed by hand with `just record-fixtures`;
  - small hand-written fixtures for edge cases: private items carrying canaries, one commit in a repo and its fork, items either side of midnight in the owner's time zone, a commit search slice that hits the 1000-result cap.
- **Render as a pure function of (database, settings),** checked against snapshot HTML.
- **Privacy test:** the fixtures include private items as a too-powerful token would return them, each carrying a canary string such as `CANARY-PRIVATE`. The test fails if a canary reaches `state.db`, `dist/` or the job's log output.
- **A live smoke test,** run by hand or with `workflow_dispatch`.

## Prototypes

Both prototypes were throwaway pages on real public data, now removed from `main` and kept as tags:

- [`archive/prototype-views`](https://github.com/jonocodes/activity/tree/archive/prototype-views) (was the `prototype/views` branch): three variants of the page, switchable with `?variant=A|B|C` or the ← → keys, with screenshots in `docs/img/`. The author liked all three, which led to the combined layout. The same tag has the probe scripts behind the measurements: `build_fixture.py` (with its GraphQL query in `q.graphql`), `size_probe.py` and `html_size.py`.
- [`archive/prototype-v1`](https://github.com/jonocodes/activity/tree/archive/prototype-v1) (removed 2026-11-27): a mockup of the v1 page in `prototype/`, served by `just prototype`, which settled favorites, adopted forks, the overview bars, the phone layout and loading years on demand. The real page replaced it.

Future prototypes go straight on `main`, and get the same treatment when they're done.

## Build plan

Each step ends with tests passing and the README updated.

1. **Skeleton** (done 2026-11-25):
   - a Justfile that loads `.env`; the repo needs only Node 24 and just (dev environment files stay local);
   - TypeScript on Node 24, run directly with no build step;
   - Justfile (`just test`, `just collect`, `just render`, `just dev`, `just record-fixtures`);
   - `node:test`;
   - the SQLite adapter on `node:sqlite`.
2. **GitHub collector into SQLite** (done 2026-11-26), driven by recorded fixtures: profile, public orgs, repos, the GraphQL connections, `contributionsCollection` by year, commit search slices, line counts. Drops private items. Confirms the public-only token works for every query.
3. **Settings from env vars,** validated; a render model; the privacy test (done 2026-11-26). The render model (`src/model.ts`) is a pure function of (database, settings, now) holding every display rule; the renderer only turns it into HTML.
4. **Renderer** (done 2026-11-27): `src/render/` turns the model into `dist/`: `index.html` (last 12 months), `<year>/index.html` per older year, shared `site.css` and `site.js`, and `summary.json` (counts per kind, for the shrink guard). Every value from GitHub is escaped by the HTML builder by default. The page works without JavaScript (tabs are jump links, years are links, dates are plain); `site.js` adds tabs, filter chips, "in feed" per repo, ages, and loading a year in place. Snapshot-tested; the privacy test covers every file. Measured on the author's data: `index.html` about 1 MB raw, 155 KB compressed.
5. **Workflow** (live 2026-11-27 at https://jonocodes.github.io/activity/): scheduled Action deploying to Pages, with the keep-alive, the failure rules and the shrink guard (`src/guard.ts`). First run: 5 min for the build job (225 API calls, 0 dropped as private), 8 s to deploy, 3,280 items.
6. **Later,** one GitHub issue each (the [open issues](https://github.com/jonocodes/activity/issues) are the current list; this one is a snapshot from 2026-11-27):
   - [state store](#later-the-state-store): incremental fetching, the events archive, `gone_at` ([#2](https://github.com/jonocodes/activity/issues/2));
   - [private repos](#future-private-repos) ([#3](https://github.com/jonocodes/activity/issues/3));
   - branch walk ([#6](https://github.com/jonocodes/activity/issues/6));
   - Hacker News source ([#7](https://github.com/jonocodes/activity/issues/7));
   - Codeberg source ([#8](https://github.com/jonocodes/activity/issues/8));
   - custom domain ([#9](https://github.com/jonocodes/activity/issues/9));
   - renewing the token, about 2027-02-25 ([#10](https://github.com/jonocodes/activity/issues/10));
   - making it usable by other people: other accounts, what's too opinionated, fork or template ([#11](https://github.com/jonocodes/activity/issues/11)).

## Open questions

- **Work for a past employer looks like contributing to someone else's project** (2026-11-25). The author's years at PLOS show up under Contributing to as 7 repos of a stranger, though it was their job. Possible answer: an owner-marked "work" org, shown as its own group ("Worked at PLOS, 2015–2018"). This overlaps with the `[[period]]` idea in [Future: private repos](#future-private-repos). Not for v1. [#4](https://github.com/jonocodes/activity/issues/4)
- **Allow and deny lists for orgs and repos** (2026-11-25). The owner wants to include or exclude orgs and repos by name, for public repos now and private ones later. To design together with the private-repo rules. Not for v1. [#5](https://github.com/jonocodes/activity/issues/5)

## Future: private repos

Deferred on 2026-11-24; tracked in [#3](https://github.com/jonocodes/activity/issues/3). Everything here was designed before the review and needs a fresh decision before it's built. Build it while the author still has access to their current job's repos, or that history survives only in local clones.

### What it would add

The same token, with private access (a classic PAT with `repo`, `read:user` and `read:org`; `repo` also grants write access. Fine-grained tokens cover one owner each, org tokens may need admin approval, and orgs can block classic PATs or require SSO). It would collect private repos, commits and line counts, private org memberships and private events, and show each at a level the owner picks. History from a job you later leave is the reason for the state store.

### Visibility rules (draft)

Stored as an `ACTIVITY_RULES` secret (TOML), since a file in the public repo would publish the list of things being hidden. Matching is `owner/*` or `owner/repo`; the most specific rule wins. Rules apply at render time, except `ignore`, which applies at collection time.

| Level | Page shows | Stored |
|---|---|---|
| `full` | Everything: repo name, titles, links | Yes |
| `org` | The org name with counts and line totals; no repo names or titles | Yes |
| `anonymous` | Counted in totals only ("private work") | Yes |
| `hidden` | Nothing | Yes |
| `ignore` | Nothing | Never collected |

```toml
default_public = "full"
default_private = "anonymous"

[[rule]]
match = "some-client-org/*"
level = "anonymous"

# Credit private work you can no longer access (GitHub reports it only as anonymous counts)
# to an org for a date range. Shown on the page as your claim, not GitHub's.
[[period]]
org = "Former Employer"
from = "2015-03"
to = "2018-06"
```

### Past private work

GitHub keeps counting work in private repos you can no longer access, but won't say where it was. For the author, `contributionsCollection` reports restricted contributions of 52 in 2015, 74 in 2016, 109 in 2017 and 122 in 2018, with no repo, and the token sees no private repo created before 2020. `read:user` doesn't help; it only details repos you can still read.

Two ways to show the org anyway:
- **`[[period]]` rules from a CV:** restricted counts inside a date range are credited to a named org. The page marks this as the owner's claim, not GitHub's.
- **Old clones:** `git log --author=… --numstat` gives exact commits and line counts, imported as a manual source.

### To decide before building

From the 2026-11-24 review:
- **Safe defaults for forks.** The old draft had `default_private = "org"`, which publishes a new user's employer name, commit counts and line totals before they've written any rules. Default to `anonymous`, and keep private org memberships off unless the owner opts in.
- **Renamed repos.** Rules match by name, so renaming a hidden public repo makes it fall back to `full`. Match on the repo's node ID too, or warn when a rule matches nothing.
- **Repos that disappear.** A repo marked `gone` may have been made private. Render a gone repo as private, whatever visibility was stored earlier.
- **Titles leak more than names.** Private issue titles, commit messages, branch names and URLs need the same checks as repo names. Extend the canary test to every field.
- **Log masking.** At the start of each job, emit `::add-mask::` for every private repo and org name, so Actions hides them in all later output, including errors like "Could not resolve repository org/private". This is defence in depth alongside the tests: it doesn't cover `dist/`, and step debug logging is a risk.
- **Which past employers, dates and org names** go in `[[period]]`, and do any old clones survive?
