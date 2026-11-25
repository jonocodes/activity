# Research: one page for all my GitHub activity

> Research done 2026-11-23/24, before the design. The findings still hold; the recommendation in section 4 (a collector on a home server feeding the blog) was superseded by [design.md](design.md).

Researched 2026-11-23 for GitHub login `jonocodes` (confirmed with `gh api user --jq .login`). Live numbers below come from read-only `gh` calls made that day with the local `gh` OAuth token (scopes `repo`, `read:org`, `gist`, `admin:public_key`).

## TL;DR

- **GitHub has no single page for this.** Your activity is split across the profile's contribution graph and timeline (one year at a time, default-branch commits only, forks excluded), the repositories tab, the Issues/PR dashboards, search (`author:`, `commenter:`, `involves:`), and the per-repo Activity view. Discussions are the hardest to find: search is the only place to list them ([contributions reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference), [discussion search](https://docs.github.com/en/search-github/searching-on-github/searching-discussions)).
- **The APIs together can rebuild almost everything, back to 2012.** The GraphQL `User` connections (`issues`, `pullRequests`, `issueComments`, `repositoryDiscussions`, `repositoryDiscussionComments`, `commitComments`) are not time-limited. They returned your first items from 2012 and matched search totals exactly (419 issues, 1069 PRs). Commits are the weak spot. `contributionsCollection` gives per-repo daily counts, one year per query. Commit search gives real commits, but only on default branches and only 1000 results per query.
- **The Events API is now a 30-day window, not 90.** The docs now say 30 days and 300 events. For you, 300 events covered only about 10 days (2026-11-13 to 2026-11-23). Since 2025-10-07, `PushEvent` payloads have no commit list ([events docs](https://docs.github.com/en/rest/activity/events), [changelog](https://github.blog/changelog/2025-08-08-upcoming-changes-to-github-events-api-payloads/), checked live). Keeping events beyond 30 days means polling and storing them yourself.
- **No existing tool covers the whole list.** README-card tools (`metrics`, `github-readme-stats` and its successor) show totals or the last ~30 days. `lowlighter/metrics` has had no commit since 2023-12, `github-readme-stats` is officially unmaintained, and OSS Insight shuts down on 2026-12-04. `dogsheep/github-to-sqlite` is built around repositories, not users: it has no events and no discussions.
- **Recommendation:** a small script of your own, about 200 lines, run by a systemd timer on lute (or a scheduled Action). It pulls the GraphQL connections and commit search into SQLite, polls `/users/jonocodes/events` with ETags so the history keeps growing, and exports a JSON file with private repos filtered out. The blog ([jonocodes/blog](https://github.com/jonocodes/blog), Eleventy) renders that JSON from `_data/` at build time. Datasette on the same SQLite file gives you a private, searchable view on the tailnet at no extra cost. A full backfill is under 200 API calls.

## 1. What GitHub shows natively

### Profile contribution graph, activity overview, contribution timeline

- **The graph shows one year.** The profile's contribution graph covers "your repository contributions over the past year". The contribution activity section is "a detailed timeline of your work, including commits you've made or co-authored, pull requests you've proposed, and issues you've opened". The optional activity overview shows "the types of contributions you make and repositories you're most active in" ([Contributions on your profile](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)).
- **What counts:** creating a repository and forking one always count. Issues, PRs, PR reviews, discussions opened and discussions answered count only in a standalone repo, not a fork ([profile contributions reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)).
- **When a commit counts:** all of the following must hold ([profile contributions reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)):
  - the author email is linked to your account;
  - the repo is not a fork;
  - the commit is on the default branch or `gh-pages`;
  - you are a collaborator or org member, or you have forked the repo, or you have opened an issue or PR in it.
- **Commits made in a fork don't count**, and new commits can take up to 24 hours to appear ([troubleshooting missing contributions](https://docs.github.com/en/account-and-profile/reference/why-are-my-contributions-not-showing-up-on-my-profile)).
- **Private contributions** can be shown, but only as anonymised daily counts with no details ([contributions concepts](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile), [reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)).
- **Timestamps:** contributions are in UTC. Commits use the time zone in the commit; issues and PRs use the browser's time zone ([concepts](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile), [reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)).

### Repositories tab

`github.com/jonocodes?tab=repositories&type=fork` lists forks. It returned "31 results for forked repositories", which matches GraphQL `repositories(isFork:true)` = 31. The Type filter offers All, Sources, Forks, Archived, Can be sponsored, Mirrors and Templates ([live page](https://github.com/jonocodes?tab=repositories&type=fork)).

### Dashboard feed

The home dashboard feed shows activity from people you follow and repos you watch. "Recent activity" previews at most 4 updates from the last two weeks, mainly issues and PRs you're involved in. "Top repositories" is generated automatically ([personal dashboard](https://docs.github.com/en/account-and-profile/reference/personal-dashboard)). It is not a history of your own activity.

### Issues and PR dashboards

The Issues dashboard at `github.com/issues` has the views "Created by me", "Assigned to me" and "Mentioned", plus a "Recent activity" view (since April 2025) ([changelog](https://github.blog/changelog/2025-04-02-github-issues-dashboard-updates/)). It covers only issues and PRs: no commits and no discussions.

### Repository Activity view

`/<owner>/<repo>/activity` lists pushes, merges, force pushes and branch changes, filterable by branch, user, time and activity type ([activity view docs](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/using-the-activity-view-to-see-changes-to-a-repository)). It is per repo only; you can't see your pushes across all repos.

### Search qualifiers

- **Issues and PRs:** `author:`, `commenter:`, `involves:` and `-user:` (to exclude your own repos) work for issues and PRs.
- **Discussions:** discussion search supports `author:`, `commenter:`, `involves:` (author OR mentions OR commenter) and `answered-by:` ([searching discussions](https://docs.github.com/en/search-github/searching-on-github/searching-discussions)).
- **Commits:** commit search only covers default branches ([REST search](https://docs.github.com/en/rest/search/search)).

### Why it feels scattered

- **Different rules per surface.** Each one has its own time window (one year on the graph, two weeks in Recent activity, 30 days in the Events API) and its own counting rules (default branch only, forks excluded).
- **Some activity never shows up together.** No surface lists commits to non-default branches across repos. Discussions only appear in search.

## 2. APIs: what each can and can't see

### Live counts for jonocodes on 2026-11-23

| Source | Query | Result |
|---|---|---|
| GraphQL `viewer` | `repositories(ownerAffiliations: OWNER)` | 89 (31 forks) |
| GraphQL `viewer` | `issues` / `pullRequests` | 419 / 1069 (match search exactly) |
| GraphQL `viewer` | `issueComments` / `commitComments` | 778 / 17 |
| GraphQL `viewer` | `repositoryDiscussions` / `repositoryDiscussionComments` | 20 / 31 |
| GraphQL `viewer` | `repositoriesContributedTo(includeUserRepositories:false)` | 39 other repos (nixpkgs, home-manager, coolify, paseo, t3code, …) |
| GraphQL `viewer` | oldest `issues` / `pullRequests` / `issueComments` | 2012-11-21 / 2012-02-23 / 2012-02-06, so full history is available |
| GraphQL `contributionsCollection` (last year) | totals | commits 1381, issues 289, PRs 334, reviews 7, repos created 39, restricted 1235, calendar 3294 |
| GraphQL `contributionsCollection` | `contributionYears` | 2009–2026 (pre-2012 comes from backdated commits) |
| REST search `issues` | `author:jonocodes type:issue` / `type:pr` | 419 / 1069 |
| REST search `issues` | `… -user:jonocodes` (issues / PRs in other people's repos) | 148 / 739 |
| REST search `issues` | `commenter:jonocodes` / `involves:jonocodes` | 746 / 1868 |
| REST search `commits` | `author:jonocodes` / `-user:jonocodes` | 3515 / 1624 |
| GraphQL `search(type: DISCUSSION)` | `author:` / `commenter:` / `involves:` / `answered-by:` | 19 / 17 / 27 / 1 |
| REST `/users/jonocodes/events` | paginate to the end | 300 events, oldest 2026-11-13, 13 repos, 118 private |

### Events API (`/users/{username}/events`)

- **Window:** up to 300 events, and "only events created within the past 30 days" ([events docs](https://docs.github.com/en/rest/activity/events)). Older sources still say 90 days ([ghexport README](https://github.com/karlicoss/ghexport)); the current docs say 30.
- **Latency:** "can be anywhere from 30s to 6h" ([events docs](https://docs.github.com/en/rest/activity/events)).
- **Private events:** included when you are authenticated as that user ([events docs](https://docs.github.com/en/rest/activity/events)).
- **Polling is cheap.** An unchanged ETag returns 304 and doesn't use up rate limit; respect `X-Poll-Interval`, which was 60s live ([events docs](https://docs.github.com/en/rest/activity/events)).
- **Event types:** there are 16, including `DiscussionEvent`, `ForkEvent`, `CreateEvent` and `PushEvent` ([event types](https://docs.github.com/en/rest/using-the-rest-api/github-event-types)).
- **Push events no longer list commits.** Since 2025-10-07, push events dropped "commit summaries and counts" ([changelog](https://github.blog/changelog/2025-08-08-upcoming-changes-to-github-events-api-payloads/)). Live `PushEvent.payload` keys were only `before, head, push_id, ref, repository_id`. To get the commits, call the compare API on `before...head`.
- **This is the only source that sees** pushes to non-default branches, branch creation and deletion, forks and stars as they happen. It only keeps them for 30 days.

### GraphQL `contributionsCollection`

- **One year per query.** `from`/`to` "must not exceed 1 year"; tested live, it is a validation error. With no arguments it defaults to the last year ([User.contributionsCollection, live introspection](https://docs.github.com/en/graphql/reference/objects#user)). Backfill by looping over `contributionYears`.
- **Per-repo fields:** `commitContributionsByRepository`, `issueContributionsByRepository`, `pullRequestContributionsByRepository` and `pullRequestReviewContributionsByRepository`. Each takes `maxRepositories`, which is capped at 100 (tested live: "Only up to 100 repositories is supported").
- **Commits come as daily counts, not commits.** Commit contributions are `{occurredAt, commitCount}`, with no SHAs or messages (live).
- **`repositoryContributions`** covers "repositories owned by the user that the user created in this time range". It includes forks: live results had `jonocodes/lastbook`, `tailmux` and `rclone` with `isFork: true`. That makes it a "created or forked" timeline.
- **No discussion fields at all** ([ContributionsCollection, live introspection](https://docs.github.com/en/graphql/reference/objects#contributionscollection)). The profile calendar does count discussions: the calendar total (3294) was 9 higher than the sum of the typed totals plus restricted (3285). You opened 7 discussions and had 1 answer accepted in that window, which fits. Get discussions from `User.repositoryDiscussions` or from search.
- **Private details need the `read:user` scope.** The schema says: "Contributions in private and internal repositories are only included with the optional read:user scope." The local token lacks `read:user`, so 1235 contributions came back as `restrictedContributionsCount` and no private repo appeared in the per-repo lists.
- **Same counting rules as the profile:** default branch only, no forks.

### GraphQL `User` connections (the most useful source)

- **No time limit.** `issues`, `pullRequests`, `issueComments`, `commitComments`, `repositoryDiscussions` and `repositoryDiscussionComments` can all be paged back to 2012 (live). There is no one-year window and no 1000-result cap.
- **They cover other people's repos.** Issues and PRs you opened there are included (live counts equal `author:` search).
- **Coverage per type:** discussions you started and discussion comments are both covered; neither is in `contributionsCollection`.
- **Reviews are the exception.** Use `contributionsCollection.pullRequestReviewContributions` per year, or search `reviewed-by:jonocodes`.

### Search API

- **Rate limit:** 30 requests per minute when authenticated.
- **Result cap:** "up to 1,000 results for each search". Tested live: page 11 of commit search returns HTTP 422 "Only the first 1000 search results are available".
- **Commits:** commit search covers the default branch only.
- **Timeouts** set `incomplete_results` ([REST search](https://docs.github.com/en/rest/search/search)).
- **Getting past the cap:** your 3515 commits need date-sliced queries (`author-date:2024-01-01..2024-03-31`).
- **Discussions** are only searchable through GraphQL `search(type: DISCUSSION)` (live).

### Rate limits

- **REST:** 5000 requests per hour for a user token. In Actions, `GITHUB_TOKEN` gets 1000 per hour per repo. There is a secondary cap of 900 points per minute and 100 concurrent requests ([REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
- **GraphQL:** 5000 points per hour, connections of at most 100, at most 500k nodes per call, and a 10s timeout ([GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)). A 100-repo × 100-contribution query cost 1 point live.
- **A full backfill for this account is about 200 calls**, which is negligible.

### Other first-party or bulk sources

- **Account data export:** Settings → Account → Export account data produces a tar.gz. The download link expires after 7 days ([docs](https://docs.github.com/en/get-started/archiving-your-github-personal-account-and-public-repositories/requesting-an-archive-of-your-personal-accounts-data)). It's useful as a one-off archive, not as a feed.
- **GH Archive:** records the public timeline from 2011-02-12 onward, as hourly files at `data.gharchive.org/YYYY-MM-DD-H.json.gz` and as a BigQuery dataset with 1 TB of free queries per month ([gharchive.org](https://www.gharchive.org/)). This is the only way to recover public `PushEvent` and `CreateEvent` data older than 30 days. It never has private events, and since October 2025 push events have no commit list.

## 3. Existing projects and tools (verified 2026-11-23)

Stars, last default-branch commit and licence come from `gh api repos/<r>` and `gh api repos/<r>/commits?per_page=1`.

| Project | Stars / last commit | What it is |
|---|---|---|
| [lowlighter/metrics](https://github.com/lowlighter/metrics) | 17.5k / **2023-12-18** | SVG infographics with 47 plugins. `activity` draws on events (default 300). `discussions` gives stats only. `calendar`, `followup`, `notable`. Runs as an Action or Docker. Effectively unmaintained. |
| [anuraghazra/github-readme-stats](https://github.com/anuraghazra/github-readme-stats) | 79.8k / 2026-06-30 | README says "**This repository is no longer maintained**". Successor: [stats-organization/github-stats-extended](https://github.com/stats-organization/github-stats-extended) (1.7k, pushed 2026-11-23). Shows totals only. |
| [Ashutosh00710/github-readme-activity-graph](https://github.com/Ashutosh00710/github-readme-activity-graph) | 2.4k / 2026-11-15 | Contribution graph for the "last 31 days". |
| [vn7n24fzkq/github-profile-summary-cards](https://github.com/vn7n24fzkq/github-profile-summary-cards) | 3.7k / 2026-10-25 | Summary cards (languages, commit times). |
| [jamesgeorge007/github-activity-readme](https://github.com/jamesgeorge007/github-activity-readme) | 966 / 2026-03-15 | Action that writes the last N **public** events (`IssuesEvent`, `IssueCommentEvent`, `PullRequestEvent`, `ReleaseEvent`) into a README. Default `MAX_LINES` 5. |
| [dlvhdr/gh-dash](https://github.com/dlvhdr/gh-dash) | 12.8k / 2026-11-21 | Terminal UI with "per-repo PRs & issues sections" defined by search filters. Live work queue, not history. |
| [kenchan/gh-furik](https://github.com/kenchan/gh-furik) | 16 / 2025-12-12 | `gh` extension. GraphQL activity (issues, PRs, comments, reviews) for `--from/--to`, output as Markdown grouped by repo. |
| [gh-tui-tools/gh-activity-chronicle](https://github.com/gh-tui-tools/gh-activity-chronicle) | 1 / 2026-03-04 | `gh` extension. Writes md/json/html reports: commits (default and all branches), PRs, reviews, issues, lines changed, repos by category. No mention of discussions. Very new and tiny. |
| [remotion-dev/github-unwrapped](https://github.com/remotion-dev/github-unwrapped) | 1.3k / 2026-04-06 | Year-in-review video. Novelty. |
| [pingcap/ossinsight](https://github.com/pingcap/ossinsight) | 2.5k / 2026-11-20 | Per-user analytics built on GH Archive. "**Shutting down on December 4, 2026**": the site becomes read-only and the API stops. |
| [dogsheep/github-to-sqlite](https://github.com/dogsheep/github-to-sqlite) + [Datasette](https://github.com/simonw/datasette) | 477 / 2026-09-11 | Commands (from `cli.py`): `issues`, `pull-requests` (supports `--search`), `issue-comments`, `commits`, `releases`, `tags`, `contributors`, `repos`, `starred`, `stargazers`, `workflows`, `scrape-dependents`, `emojis`, `get`. All per repo except `repos`, `starred` and `pull-requests --search`. **No events, no discussions, no contributions.** |
| [karlicoss/ghexport](https://github.com/karlicoss/ghexport) | 59 / 2026-11-16 | Takes JSON snapshots of every PyGithub `get_*` call for the authenticated user (events, received_events, repos, starred, …). The `dal` merges snapshots, so periodic runs build up events. No GraphQL, no discussions. |
| [timelinize/timelinize](https://github.com/timelinize/timelinize) | 3.7k / 2026-05-21 | Self-hosted personal timeline. Its GitHub source imports **starred repositories only** (`datasources/github/github.go`). |
| [glanceapp/glance](https://github.com/glanceapp/glance) | 38.4k / 2026-11-07 | Self-hosted dashboard. Its `repository` widget is per repo. Its `custom-api` widget can render any JSON with Go templates ([config docs](https://github.com/glanceapp/glance/blob/main/docs/configuration.md#custom-api)), so it could display your own feed. |
| [GH Archive](https://www.gharchive.org/) | n/a | Public events since 2011, via BigQuery or hourly files. |

Static-site examples exist, for instance an Astro site that renders the contribution calendar from GraphQL ([kkhys/me](https://github.com/kkhys/me)). These cover the calendar heatmap only. No packaged Astro, Hugo or Eleventy integration does the full activity feed.

### Why the two big ones stopped (checked 2026-11-24)

- **github-readme-stats:** the free hosted endpoint ended when Vercel stopped sponsoring it: "now that we are no longer sponsored by vercel and the hosted endpoint is not available anymore" ([PR #4716](https://github.com/anuraghazra/github-readme-stats/pull/4716), 2026-01). The project then recommended a GitHub Action that generates the cards in your own repo ([github-readme-stats-action](https://github.com/stats-organization/github-readme-stats-action)). In 2026-06 it was marked unmaintained in favour of the fork [github-stats-extended](https://github.com/stats-organization/github-stats-extended) ([PR #4895](https://github.com/anuraghazra/github-readme-stats/pull/4895)), whose [fork page](https://github-stats-extended.vercel.app/frontend/docs/fork/) cites slow development: "The volume is overwhelming for the small team."
- **lowlighter/metrics:** no announcement; commits just stop on 2023-12-18, with only Dependabot branches since. Open discussions show plugins breaking as outside APIs change:
  - `activity` crashes on the 2025 event payloads ([#1826](https://github.com/lowlighter/metrics/discussions/1826));
  - `achievements` fails since Projects Classic was retired ([#1841](https://github.com/lowlighter/metrics/discussions/1841));
  - WakaTime and Steam broke ([#1852](https://github.com/lowlighter/metrics/discussions/1852), [#1846](https://github.com/lowlighter/metrics/discussions/1846));
  - `tweets` is marked deprecated.

### Archive and timeline projects (searched 2026-11-24)

A second search, for full-history archive pages rather than summary cards:

| Project | Stars / last push | What it does | Gap |
|---|---|---|---|
| [waldyrious/contributions-timeline](https://github.com/waldyrious/contributions-timeline) | 0 / 2026-02 | Closest in shape: Node scripts fetch GitHub (commits, issues, PRs, reviews, comments), Wikimedia and OpenStreetMap, merge them into one timeline and render static HTML with filter toggles. A daily Action publishes to Pages | No saved state, so it re-fetches daily. Commits come only from the Events API ("last 90 days only"). No discussions. A personal site, not a reusable tool |
| [kibotu/git-history-timeline](https://github.com/kibotu/git-history-timeline) | 9 / 2026-01 | Static HTML timeline of every commit on every branch. Walks each accessible repo's branches (`/user/repos`), uses commit search for other repos, and caches by repo so it only re-fetches what changed | Commits only. Run locally |
| [xiaomingio/github-activity](https://github.com/xiaomingio/github-activity) | 1 / 2026-06 | Local repo-by-date commit timeline from your `gh` login, including private repos, with filters | Commits only. Run locally |
| [atinux/my-pull-requests](https://github.com/atinux/my-pull-requests) | 201 / 2026-10 | Nuxt site listing your 50 most recent PRs, with an RSS feed | PRs only, recent only |
| [deariary/github-weekly-reporter](https://github.com/deariary/github-weekly-reporter) | 29 / 2026-11 | Action that publishes a weekly report page to Pages, with AI-written summaries of commits, PRs and reviews | Weekly digests, not an archive. Needs an LLM key |
| [thomas-zahner/commitoria](https://github.com/thomas-zahner/commitoria) | 10 / 2026-09 | Contribution calendar combined across GitHub, GitLab, Gitea/Forgejo and bare git | Daily counts only |
| [sio/issyours](https://github.com/sio/issyours) | 2 / 2019 | Read-only static archive of issues and PRs | Dead |

None keeps durable history, covers discussions and forks, or has visibility rules. Ideas worth taking:
- an RSS/Atom feed (atinux);
- walking every branch of your own repos for commits on non-main branches (kibotu);
- other forges such as Codeberg as future sources (commitoria);
- a weekly digest page (deariary).

### Comparison

✓ = yes, ~ = partial, ✗ = no.

| Tool | Commits | Own repos | Forks | Issues | PRs | Discussions | Per-repo | History beyond 30 days | Self-host | Embeddable | Maintained |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GitHub profile | ~ default branch, 1 yr view | ✓ | ✓ tab | ✓ | ✓ | ~ counted, not listed | ~ overview | ✓ by year | ✗ | ✗ | ✓ |
| lowlighter/metrics | ~ counts | ✓ | ~ | ~ counts | ~ counts | ~ stats | ~ | ✗ for feed | ✓ | ✓ SVG | ✗ (2023) |
| github-readme-stats / stats-extended | ~ totals | ~ | ✗ | ~ totals | ~ totals | ✗ | ✗ | ~ totals | ✓ | ✓ SVG | ✗ / ✓ |
| github-readme-activity-graph | ~ graph | ✗ | ✗ | ~ | ~ | ✗ | ✗ | ✗ (31 d) | ✓ | ✓ SVG | ✓ |
| github-activity-readme | ✗ | ✗ | ✗ | ✓ public | ✓ public | ✗ | ✗ | ✗ | ✓ Action | ✓ README | ✓ |
| gh-dash | ✗ | ✗ | ✗ | ✓ open/filters | ✓ | ✗ | ✓ | ~ via search | ✓ CLI | ✗ | ✓ |
| gh-furik | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ date range | ✓ CLI | ~ Markdown | ~ |
| gh-activity-chronicle | ✓ | ~ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ CLI | ✓ HTML | ? new |
| OSS Insight | ✓ public | ✓ | ? | ✓ | ✓ | ? | ✓ | ✓ | ✗ | ✓ widgets | ✗ ends 2026-12-04 |
| github-to-sqlite + Datasette | ~ per repo | ✓ | ✓ (`fork` col) | ~ per repo | ✓ `--search` | ✗ | ✓ SQL | ✓ | ✓ | ✓ Datasette | ✓ |
| ghexport | ~ via events | ✓ | ✓ | ~ | ~ | ✗ | ~ | ✓ if run regularly | ✓ | ✗ | ✓ |
| Timelinize | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |
| GH Archive | ~ public, no SHAs after Oct 2025 | ✓ | ✓ | ✓ public | ✓ public | ✓ public | ✓ | ✓ since 2011 | ~ BigQuery | ✗ | ✓ |
| **Custom script (below)** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | your own |

## 4. Recommendation

**Build a small collector of your own and render a static page.** Nothing existing covers discussions, forks, commits to other people's repos and per-repo breakdown together. All the data is reachable in under 200 calls. Adopting `metrics` or a stats card would give a nice graphic but not "one place".

### Architecture

1. **Collector:** a Python or Node script using GraphQL plus REST search, writing to `github.db` (SQLite, upserts keyed on node ID or event ID). Run it from a systemd timer on lute (this repo already manages lute), or from a scheduled Action in the blog repo.
2. **Token:** a classic PAT with `read:user` and `repo`. `read:user` is needed for private contribution details. The Actions `GITHUB_TOKEN` is limited to one repo and is not you. A public page must not need private data: filter on `repository.isPrivate` before export. The current token already sees private repos such as `Terradot/monorepo` in commit search.
3. **Publish:** export a filtered `activity.json` into the blog's `_data/`. Eleventy picks up global data files there ([blog repo](https://github.com/jonocodes/blog) already has `_data/`). Render a timeline plus a per-repo table.
4. **Private view (optional):** `datasette github.db` behind the tailnet gives you full SQL and faceting, including private items ([Datasette](https://github.com/simonw/datasette)).

### What to pull

- **Repos:** `viewer.repositories(ownerAffiliations: OWNER, first:100)` with `isFork parent{nameWithOwner} createdAt pushedAt isPrivate stargazerCount`, plus `repositoriesContributedTo(includeUserRepositories:false, contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,REPOSITORY,PULL_REQUEST_REVIEW])`.
- **Full-history connections, paged by 100, incremental with `orderBy` and stop at last seen:**
  - `viewer.issues`
  - `pullRequests`
  - `issueComments`
  - `commitComments`
  - `repositoryDiscussions`
  - `repositoryDiscussionComments`

  Pull `repository{nameWithOwner isPrivate}`, `createdAt`, `url` and `title`/`state` for each.
- **Per-year contributions:** for each year in `contributionsCollection.contributionYears`, run `contributionsCollection(from: Y-01-01, to: Y-12-31T23:59:59)`. Store `commitContributionsByRepository{contributions(first:100){nodes{occurredAt commitCount}}}`, `pullRequestReviewContributions`, `repositoryContributions` (created or forked) and the totals. Backfill once; re-run only the current year after that.
- **Commits as real objects:** run `search/commits?q=author:jonocodes author-date:A..B`, sliced by quarter or month so each slice stays under 1000. Keep sha, message, repo and date. Search allows 30 requests per minute, so sleep 2 seconds between calls.
- **Events archive:** every 15–60 minutes, `GET /users/jonocodes/events` with `If-None-Match`; a 304 is free. Insert new event IDs into `events(raw json)`. This is the only source for non-default-branch pushes and branch create/delete, so run it all the time from day one. History before that can't be recovered except for public events in GH Archive.
- **Optional public backfill:** a one-off BigQuery query on `githubarchive` for `actor.login = 'jonocodes'` across 2011–2025. It recovers public pushes and branches older than 30 days. A full scan of all years is costly; try month or day tables first ([gharchive.org](https://www.gharchive.org/)).

### Gotchas

- **Scheduled Actions stop in quiet repos.** In a public repo, scheduled workflows are disabled after 60 days without repo activity ([Actions docs](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow)). Committing the JSON keeps the repo active. A lute timer avoids the problem and keeps the PAT off GitHub.
- **Profile counts and the API differ** for commits on non-default branches, commits in forks and commits from unlinked emails ([reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)). The page should say what it counts.
- **Commit search also finds your commits in other people's forks.** The first 100 `author:jonocodes -user:jonocodes` hits were 99 in `Terradot/monorepo` (private) and 1 in `adamhalama/t3code`, someone else's fork. Decide whether to group forks under their upstream with `parent`, and drop private repos before publishing.

### Trade-offs against an existing tool

- **Custom:** complete, and keeps history going forward, but you maintain it. The GraphQL schema is stable, but the Events payload changed in 2025.
- **github-to-sqlite + Datasette:** quick to set up for PRs (`pull-requests --search 'author:jonocodes'`) and repos. You would still write the discussions, contributions and events parts yourself. You could use it as the storage layer: `github-to-sqlite get` can page any API, and `sqlite-utils` can insert the GraphQL output.
- **metrics / stats cards:** fine as a decorative header on the page; not a feed.

### Bold idea

Make the SQLite file the source of truth and publish it twice.

1. Export a filtered public copy (private rows dropped) and serve it with Datasette, or render it statically. Visitors can then browse your full public history with real faceting by repo, type and year.
2. Keep the unfiltered copy private on lute.

Both come from one collector and one schema, so the website and your own dashboard are the same data at different privacy levels.

## Sources

- https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile
- https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference
- https://docs.github.com/en/account-and-profile/reference/why-are-my-contributions-not-showing-up-on-my-profile
- https://docs.github.com/en/account-and-profile/reference/personal-dashboard
- https://github.blog/changelog/2025-04-02-github-issues-dashboard-updates/
- https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/using-the-activity-view-to-see-changes-to-a-repository
- https://docs.github.com/en/search-github/searching-on-github/searching-discussions
- https://docs.github.com/en/rest/activity/events
- https://docs.github.com/en/rest/using-the-rest-api/github-event-types
- https://github.blog/changelog/2025-08-08-upcoming-changes-to-github-events-api-payloads/
- https://docs.github.com/en/graphql/reference/objects#contributionscollection (field descriptions confirmed by live schema introspection)
- https://docs.github.com/en/rest/search/search
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- https://docs.github.com/en/get-started/archiving-your-github-personal-account-and-public-repositories/requesting-an-archive-of-your-personal-accounts-data
- https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow
- https://www.gharchive.org/
- https://github.com/lowlighter/metrics
- https://github.com/anuraghazra/github-readme-stats
- https://github.com/stats-organization/github-stats-extended
- https://github.com/Ashutosh00710/github-readme-activity-graph
- https://github.com/vn7n24fzkq/github-profile-summary-cards
- https://github.com/jamesgeorge007/github-activity-readme
- https://github.com/dlvhdr/gh-dash
- https://github.com/kenchan/gh-furik
- https://github.com/gh-tui-tools/gh-activity-chronicle
- https://github.com/remotion-dev/github-unwrapped
- https://github.com/pingcap/ossinsight
- https://github.com/dogsheep/github-to-sqlite
- https://github.com/simonw/datasette
- https://github.com/karlicoss/ghexport
- https://github.com/timelinize/timelinize
- https://github.com/glanceapp/glance
- https://github.com/kkhys/me
- https://github.com/jonocodes/blog
