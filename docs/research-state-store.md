# Research: keeping the database between runs (the state store)

> Discussed 2026-11-24 to 2026-11-27, with measurements from the author's account (`jonocodes`) on 2026-11-27, the day v1 went live. Current leaning: **don't build it yet.** The design's Decisions table and [Later: the state store](design.md#later-the-state-store) hold the decision itself; this is the record of why.

## TL;DR

- **What it is.** Each hourly run builds `state.db` from scratch: it fetches the owner's whole history from GitHub, renders the page, and throws the database away. A state store would keep `state.db` between runs, so a run only fetches what's new.
- **What it would buy:**
  - speed: seconds instead of about 5 minutes per run;
  - keeping things GitHub forgets: the 30-day Events API, and work in repos later deleted or made private;
  - steadier runs, since an API hiccup couldn't shrink the page.
- **What it buys this owner today is small.**
  - Nobody waits for the hourly runs, and Actions minutes are free for public repos.
  - The Events API window holds little that isn't already on the page. Over the owner's last two weeks, that's **4 pushes on 2 experimental branches** with no pull request, plus branch creation and deletion.
  - Local development already keeps `state.db` (`just collect` once, then `just render` and `just dev`).
- **Cost:**
  - incremental fetching and a "gone" state for items;
  - safety rules, so a failed load never overwrites good data with less;
  - a place to keep the data;
  - more to test.
- **Leaning:** defer. Revisit when one of these happens:
  - the owner wants branch pushes or experiments on the page;
  - items start disappearing because repos get deleted or made private;
  - work starts on private repos, which can't be re-fetched after leaving a job.

## 1. What a run does now

v1 has no state store (decided 2026-11-24). Every run:

1. starts from an empty `state.db`;
2. fetches everything public: profile, repos, the full-history issue, PR, comment and discussion connections, contribution calendars year by year, commits (walking own repos' default branches, and commit search for everything else), and details of external repos;
3. renders `dist/` and deploys it;
4. discards `state.db`.

**First live run** (2026-11-27, GitHub Actions): build job 5 min 6 s, of which collecting took 298 s. 225 API calls, 0 items dropped as private, 3,280 items on the page. Most of the time is commit search, limited to 30 requests a minute ([research.md](research.md)).

## 2. What a stored copy would buy

| | Without a store (v1) | With a store |
|---|---|---|
| Time per hourly run | about 5 minutes, every run | seconds, fetching only what's new |
| API calls per run | about 225 | a handful |
| Pushes to non-default branches, branch create and delete | not shown at all: only the Events API has them, for at most 30 days and 300 events | archived from the day the store starts |
| Items in a repo later deleted or made private | disappear from the page on the next run | kept, marked gone |
| Private work at a job you later leave (future private-repos feature) | can't be kept: after leaving, GitHub keeps only anonymous daily counts | kept |
| An API hiccup that returns less | caught by the shrink guard (no deploy if items fall over 10%) | can't shrink stored data; the guard rarely matters |
| Growth over time (followers, stars) | current values only | history |
| Local development | already has a local `state.db`: collect once, re-render in about a second | same |

## 3. The 30-day window, in numbers

Measured 2026-11-27 with the public-only token, from `GET /users/jonocodes/events` (3 pages of 100):

- **300 public events, covering Nov 12 to Nov 26: two weeks, not 30 days.** 300 is GitHub's cap, and a busy account reaches it first.

| Event type | Count | On the page another way? |
|---|---|---|
| Issues (opened, closed, …) | 96 | yes, from the full-history issues connection |
| Pull requests | 73 | yes |
| Pushes | 64 | partly; see below |
| Branches created | 31 | no: Events API only |
| Issue comments | 18 | yes |
| Branches deleted | 16 | no: Events API only |
| Fork | 1 | yes |
| Review | 1 | yes |

**The 64 pushes:**

- **46 to a default branch.** Already covered: those commits are on the page.
- **18 to other branches, on 10 branches.** For each, a pull request from that branch was looked for, in the repo itself and, for the lastbook fork, upstream:

| Repo | Branch | Pushes | Pull request |
|---|---|---|---|
| jonocodes/deckd | ci/macos-dmg-dry-run | 1 | #186, merged |
| jonocodes/deckd | feat/152-app-switcher | 1 | #178, open |
| jonocodes/deckd | feat/homepage-mockups | 3 | #182, merged |
| jonocodes/deckd | feat/linux-tarball-168 | 4 | #185, merged |
| jonocodes/deckd | implement-195-196 | 1 | #203, merged |
| jonocodes/deckd | probe/macos-gui | 3 | **none** |
| jonocodes/lastbook | flatpak-poc | 1 | **none** (upstream checked too) |
| jonocodes/siderail | add-dashboard-icons-search | 1 | #5, merged |
| jonocodes/stashcast | dependency-lockfile | 2 | #44, merged |
| jonocodes/stashcast | publish-docker-images | 1 | #41, merged |

**What the page would gain by archiving events, for these two weeks:**

- **4 pushes on 2 experimental branches** that never became a pull request (`deckd` `probe/macos-gui`, `lastbook` `flatpak-poc`);
- **31 branches created and 16 deleted**: a picture of how the owner works, not of output;
- the times of pushes to branches whose pull requests are already shown.

So for this owner the window holds **very little that isn't already on the page**. Most of it is branch churn. Its value would be a fuller "how I work" picture, such as spikes and experiments that went nowhere. That's a nice extra, not a gap.

Two facts that would shape an archiver:

- Push events no longer list their commits (since 2025-10-07, [research.md](research.md)). Counting a push's commits means a compare call per push.
- The 300-event cap matters more than the 30 days for an active account. Hourly polling with ETags (an unchanged 304 is free) keeps up easily.

## 4. Where the data could live

| Option | Verdict | Why |
|---|---|---|
| **Text files on a `data` branch of this repo** (one JSON-lines file per table, split by year; `state.db` rebuilt from them each run) | **leading option** | No extra account or secret: the workflow's own token writes it. Git history is the backup and an hourly diff of what changed. Old years rarely change, so diffs stay small. Forks don't copy non-default branches by default. Catch: everything committed is public forever, so private data could never go here as plain text |
| **The SQLite file itself on a branch, or as a release asset** | rejected | Git can't store small changes to a binary file cheaply: hourly history would grow the repo by hundreds of MB a day. Overwriting instead leaves one copy that a bad run can replace |
| **GitHub Actions cache** | rejected 2026-11-25 | Free and fast, but built for speed, not as the only copy. Restores sometimes fail during GitHub incidents, and a failed restore looks the same as an empty cache. Details: [research-actions-cache.md](research-actions-cache.md) |
| **Private Cloudflare R2 bucket or S3** | fallback | The original plan. Durable, and can hold private data. Costs an extra account and secrets, for the owner and for every fork |
| **Published next to the page on GitHub Pages** | possible extra | The data is public anyway; visitors could explore it (e.g. in Datasette Lite). Not a store on its own |

**Safety rules for any of them:**

- A failed load must never count as a first run, or an empty database gets saved over the real one. Fail on any error other than "not found".
- Refuse to save fewer rows than were loaded.

## 5. Would storing data in the repo make the activity look unnatural?

A question raised 2026-11-27: the page is meant to show natural activity, so would hourly commits show up as activity?

- **v1 commits nothing.** Pages deploys from an uploaded artifact: there's no `gh-pages` branch and no commit. The keep-alive is an API call. Workflow runs and deployments aren't contributions on GitHub.
- **A `data` branch would commit**, but as `github-actions[bot]` with the workflow's own token, not as the owner. Those commits appear in that branch's history only. They're not on the owner's profile or contribution graph, and they're not on this page, which collects only work the owner authored.
- **R2 or S3** involves no commits at all.
- The one thing to avoid is committing with the owner's personal token.

## 6. Costs of building it

- **Incremental fetching.** Each connection fetches newest first and stops at the last stored item. Commit search and branch walks run from the last run. Calendars and year totals re-fetch only the current year.
- **A "gone" state.** Never delete an item that vanished from GitHub; mark it with `gone_at`. That raises a privacy question for later: a repo that vanished may have been made private.
- **The safety rules above, plus tests for each:** failed load, partial load, schema change.
- **Owner checks.** A fork that copied the data branch must not render someone else's data; the files record whose data they are.
- **Somewhere to keep it, and more for a fork to understand.**

## 7. Decision record

| Date | Decision |
|---|---|
| 2026-11-24 | No state store in v1; its main reason (private work) was deferred with private repos |
| 2026-11-25 | Actions cache rejected as the store (research-actions-cache.md); text files on a `data` branch become the leading option |
| 2026-11-27 | Measured the Events API window on the owner's account (section 3): little would be lost. Leaning: keep deferring |

**Revisit when:**

- the owner wants experiments or branch pushes on the page;
- items disappear because repos are deleted or made private;
- work starts on private repos;
- run time starts to matter, for example on a much bigger account.
