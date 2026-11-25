# Research: using the GitHub Actions cache to carry `state.db` between runs

> Researched 2026-11-24 against GitHub Docs, the GitHub changelog, and the `actions/cache` and `actions/toolkit` repos (README, source on `main`, and issues with replies from GitHub staff). Anything not confirmed in a primary source is marked **unverified**.

The question: our hourly scheduled workflow, in a public repo, builds a small SQLite file (`state.db`, a few MB) of public data. Can the Actions cache carry it from one run to the next so each run fetches only what's new? How reliable is that, and what are the catches?

## TL;DR

- **The cache is a per-repo store of tarballs, keyed by a string, that workflow runs can restore and save.** It exists to speed up builds (npm, pip and similar downloads), and GitHub's own docs say "a job should always be able to re-download or regenerate these files if a cache isn't available" ([dependency caching concepts](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)). It fits "make runs faster". It does not fit "the only copy of something".
- **Scheduled runs on the default branch can read and write it.** `schedule` is one of the "trusted" triggers allowed to write default-branch caches. Pull requests, including ones from forks, cannot write a cache the default branch will later restore ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-access-for-low-trust-workflow-triggers)). Anyone who can open a PR can *read* our caches, which is fine because `state.db` holds only public data.
- **Limits are generous for a few MB.** The free tier is 10 GB per repo. Entries are deleted 7 days after they were last used, and the oldest-used entries go first when a repo goes over its size limit. Since November 2025, admins on a paid plan or with a payment method on file can raise the size (up to 10 TB) and the retention (up to 90 days for public repos) ([repo settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-cache-settings-for-your-repository), [changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/)). An entry restored every hour should never age out.
- **In practice it mostly works, but restores sometimes fail even though the entry exists.** In a June 2025 incident, restores failed for several hours while the entries were still there ([actions/cache#1621](https://github.com/actions/cache/issues/1621), staff-confirmed). An open 2026 issue reports intermittent "Cache not found" right after a successful save ([#1735](https://github.com/actions/cache/issues/1735), [#1710](https://github.com/actions/cache/issues/1710)). A staff member also confirmed a 2025 bug that evicted entries out of order ([#1667](https://github.com/actions/cache/issues/1667)). A failed restore is logged as a warning and the run carries on as if the cache were empty ([toolkit source](https://github.com/actions/toolkit/blob/main/packages/cache/src/cache.ts)). So we **must** handle a missing cache.
- **The trap for us:** once `state.db` holds things GitHub forgets (events older than 30 days), one failed restore followed by a fresh full fetch and save would make a thinner `state.db` the "newest" entry, and the forgotten history would be gone for good. The guard: if no cache was restored but `state-` entries still exist, the restore failed. In that case skip the save (or fail the run).
- **Recommendation:** use the cache, with `actions/cache/restore@v6` and `actions/cache/save@v6` and a unique key per run (`state-v1-${{ github.run_id }}-${{ github.run_attempt }}`, restored through the prefix `state-v1-`). Fall back to a full fetch when nothing is restored, use the guard above, and prune old entries with `gh cache delete` (`actions: write`). Treat the cache as a speed-up only. If we later need durable history, add a second copy that doesn't expire. The cheapest is publishing `state.db` next to the page on GitHub Pages and fetching it back as a fallback (section 9).

## 1. What the cache is, from the ground up

### The problem it solves

Every GitHub Actions job runs on a **runner**, a fresh virtual machine that is thrown away when the job ends. Nothing on its disk survives to the next run: "Jobs on GitHub-hosted runners start in a clean runner image and must download dependencies each time" ([dependency caching concepts](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)). The cache is GitHub's answer. At the end of a job you can save some files to GitHub's storage under a name, called a **key**. A later run asks for that key and gets the files back.

Under the hood, saving packs the paths you list into a compressed tarball (zstd or gzip) and uploads it. Restoring downloads that tarball and unpacks it in the same place ([toolkit `cache.ts`](https://github.com/actions/toolkit/blob/main/packages/cache/src/cache.ts)).

### What it's normally used for

- **Package-manager downloads:** `~/.npm`, pip's download cache, Gradle and Maven caches, Go modules. The docs' main example caches `~/.npm` under a key that includes a hash of `package-lock.json`, so a lockfile change makes a new cache ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#example-using-the-cache-action)).
- **Built-in caching in `setup-*` actions:** `setup-node`, `setup-python`, `setup-java`, `setup-go`, `setup-dotnet` and `ruby/setup-ruby` can manage the cache for you with one input ([reference table](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#setup--actions-for-specific-package-managers)). For example, `actions/setup-node` with `cache: npm` "uses actions/cache under the hood for caching global packages data". It caches npm's global download store, not `node_modules`. It also now turns npm caching on automatically when `package.json` declares npm as its package manager ([setup-node README](https://github.com/actions/setup-node#caching-global-packages-data)).
- **Intermediate build outputs** that are expensive to regenerate (compiler caches such as ccache, SDK installs).

### Cache versus artifacts

GitHub has two ways to store files from a run. Its docs say they "cannot be used interchangeably" ([workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)):

| | Cache | Artifact |
|---|---|---|
| Purpose | Reuse files across runs to go faster. "A job should always be able to re-download or regenerate these files if a cache isn't available" ([concepts](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)) | Keep a run's outputs (build results, logs) after it ends, or pass files between jobs in one run ([artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)) |
| Belongs to | The repo and a branch, shared by every run on that branch ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)) | One workflow run |
| Lifetime | 7 days after last access by default; can be evicted earlier when the repo is over its size limit | 90 days by default, 1 to 90 days for public repos, set per repo or per artifact ([repo settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-the-retention-period-for-checks-workflow-runs-commit-statuses-artifacts-and-logs-in-your-repository)) |
| Found by | Key or key prefix, automatically | Name plus run ID; another run needs a token and the run ID ([download-artifact](https://github.com/actions/download-artifact#download-artifacts-from-other-workflow-runs-or-repositories)) |
| Download outside Actions | No. You can list and delete entries, but there's no download API (staff in [actions/cache#105](https://github.com/actions/cache/issues/105)) | Yes, from the UI or API |
| Storage allowance | Separate: 10 GB per repo ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) | Shared with GitHub Packages, per account ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) |

## 2. How it's put together

### Keys and restore keys

- **`key`** is required. It can be any string built from expressions, up to 512 characters, with no commas. The key plus all restore keys can number at most 10 ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#input-parameters-for-the-cache-action), [toolkit `checkKey`](https://github.com/actions/toolkit/blob/main/packages/cache/src/cache.ts)).
- **Hit and miss:** an exact match on `key` is a **cache hit**. Anything else is a **miss**.
- **`restore-keys`** is an ordered list of fallback **prefixes**. A prefix is the start of a key: `npm-` matches `npm-abc` and `npm-xyz`. "If there are multiple partial matches for a restore key, the action returns the most recently created cache" ([reference, cache key matching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-key-matching)).
- **Lookup order:** the exact key, then `key` as a prefix, then each restore key in order. All of that happens first in the current branch, then again in the default branch ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-key-matching)).
- **Outputs:** `cache-hit` is `'true'` only for an exact key match. A prefix match restores files but leaves `cache-hit` not `'true'` ([README outputs](https://github.com/actions/cache#outputs)). The standalone restore action also outputs `cache-primary-key` and `cache-matched-key`, the key actually restored ([restore README](https://github.com/actions/cache/blob/main/restore/README.md#outputs)).

### Immutability: you can't overwrite a key

"You cannot change the contents of an existing cache. Instead, you can create a new cache with a new key" ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-action-usage)). The action's own tips put it more bluntly: "A cache today is immutable and cannot be updated". For data that changes on every run, they recommend "a `key` which is unique for every run" and `restore-keys` to pick up the newest one, noting that this "will create a new cache on every run and hence will consume the cache quota" ([tips: update a cache](https://github.com/actions/cache/blob/main/tips-and-workarounds.md#update-a-cache)). If a save targets a key that already exists or is being written, the toolkit logs "Unable to reserve cache with key …, another job may be creating this cache" and skips the save without failing ([toolkit `cache.ts`](https://github.com/actions/toolkit/blob/main/packages/cache/src/cache.ts)).

### The hidden "version"

Each entry also carries a **version**: a SHA-256 of the cached `path` list, the compression method, a `windows-only` marker on Windows unless cross-OS is enabled, and a salt ([toolkit `getCacheVersion`](https://github.com/actions/toolkit/blob/main/packages/cache/src/internal/cacheUtils.ts), [README: cache version](https://github.com/actions/cache#cache-version)). Lookups match on key *and* version. So:

- the `path` in the restore and save steps must be written identically;
- the runner OS must stay the same, because different compression means a different version.

A mismatch shows up as a plain miss. Users have asked for clearer docs on this ([#1653](https://github.com/actions/cache/issues/1653)).

### Branch and ref scoping: who can restore what

A cache belongs to the **ref** (branch or tag) the run ran on ([reference, restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)):

- A run can restore caches from its **own branch** and from the **default branch**. A PR run can also restore from the PR's base branch, "including base branches of forked repositories".
- A run **cannot** restore caches from child or sibling branches, or from a different tag.
- A `pull_request` run saves its cache to the PR's **merge ref** (`refs/pull/<n>/merge`, the temporary commit GitHub builds to test the merge). That cache can only be restored by re-runs of the same PR, never by the base branch or other PRs.

For us everything runs on the default branch, so every run sees every `state-` entry.

### The cache service v2 and which `actions/cache` version to use

- **New backend (2025):** "The cache backend service has been rewritten from the ground up for improved performance and reliability". It rolled out from 1 February 2025, when the legacy service was switched off. Workflows on deprecated action versions (anything older than `v3.4.0` or `v4.2.0`) started failing ([README, What's New](https://github.com/actions/cache#whats-new), [migration discussion](https://github.com/actions/cache/discussions/1510)). The toolkit chooses the v2 protocol when the runner sets `ACTIONS_CACHE_SERVICE_V2` ([toolkit `config.ts`](https://github.com/actions/toolkit/blob/main/packages/cache/src/internal/config.ts)).
- **Node runtime:** `v4` runs on Node 20. GitHub removed Node 20 from Actions runners on 2026-09-23 and asks workflow authors to move to actions that support Node 24 ([changelog](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/)). `v5` runs on Node 24 and needs runner ≥ 2.327.1, which GitHub-hosted runners have ([README](https://github.com/actions/cache#whats-new)).
- **Current:** `v6.1.0` (2026-06-26) is the latest release. It adds clean handling of read-only cache tokens, logging a warning instead of failing ([release](https://github.com/actions/cache/releases/tag/v6.1.0), [README: read-only access](https://github.com/actions/cache#read-only-access)). **Use `@v6`** (or pin its SHA).
- **Split actions:** `actions/cache` restores at the start and saves automatically at the end, but only if the job succeeds. `actions/cache/restore` and `actions/cache/save` let you choose exactly when, and under what condition, to save ([README](https://github.com/actions/cache), [save README](https://github.com/actions/cache/blob/main/save/README.md)).

## 3. Scheduled workflows on the default branch

- **Yes, they can read and write.** For `schedule`, `GITHUB_REF` is the default branch and `GITHUB_SHA` is its last commit ([events reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)). `schedule` is on the list of triggers that "can create or overwrite caches in the default branch's scope" ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-access-for-low-trust-workflow-triggers)). `workflow_dispatch` is too, so manual runs behave the same.
- **`cache-mode`:** this workflow-level key, added 2026-09-10, can narrow cache access to `read`, `write`, `write-only` or `none`. If omitted, trusted triggers like `schedule` get `write` ([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#cache-mode), [changelog](https://github.blog/changelog/2026-09-10-control-github-actions-cache-access-with-cache-mode/)). We don't need to set it.

Gotchas:

- **Late or dropped runs.** Scheduled runs "can be delayed during periods of high loads", especially at the top of the hour, and "some queued jobs may be dropped" ([events reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)). A dropped run doesn't hurt the cache; the next run restores the same entry.
- **The 60-day rule.** "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" ([events reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)). If the schedule stops for more than 7 days, the cache ages out and the next run starts from scratch. design.md already handles keep-alive.
- **Forks start cold.** Forks have scheduled workflows disabled by default ([disable/enable docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)). Caches are per repository, so a fork's first run has no cache and does a full fetch. That a fork can't see the upstream repo's default-branch caches for scheduled runs is inferred from the scoping rules, not stated outright (**unverified**).
- **Overlapping runs.** Two runs restoring the same entry and each saving their own result would split the history. design.md's `concurrency` group (one run at a time) prevents this.
- **Re-runs share `run_id`.** Re-running a workflow keeps `github.run_id`, so a key made only from `run_id` already exists and the save is skipped. Add `github.run_attempt` to the key.

## 4. Size limits

- **Per repo:** 10 GB by default. There's no limit on the number of entries, only on their total size ([reference, usage limits](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy)). That has been the size since 2021 ([changelog 2021-11-22](https://github.blog/changelog/2021-11-22-github-actions-cache-size-is-now-increased-to-10gb-per-repository/)).
- **2025 change, larger and paid:** since 2025-11-20, repos can go over 10 GB on a pay-as-you-go basis. "All repositories will continue to receive access to 10 GB, which is provided at no additional cost." Raising the limit needs a Pro, Team or Enterprise account ([changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/)). The settings docs say the feature is "available to users with a payment method on file, GitHub Pro, GitHub Team, or GitHub Enterprise Cloud plans". User-owned repos can set up to 10,000 GB ([repo settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-cache-settings-for-your-repository)).
- **Budgets:** if a budget for the Actions Cache Storage product is exceeded, "your cache will become read-only" until billing is resolved or usage drops below 10 GB ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#increasing-cache-size)). This doesn't apply on the free 10 GB.
- **Per entry:** the client refuses to save an archive over 10 GB ("is over the 10GB limit, not saving cache"), and the server can also reject an entry as "over the data cap" ([toolkit `cache.ts`](https://github.com/actions/toolkit/blob/main/packages/cache/src/cache.ts)). The docs give no separate per-entry limit.
- **Us:** a few MB per entry, compressed. Even 168 unpruned entries (section 8) come to well under 1 GB.

## 5. Eviction

**Eviction** means GitHub deleting entries without being asked. The docs describe two rules ([reference, usage limits](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy), [README, cache limits](https://github.com/actions/cache#cache-limits)):

1. **Age:** "GitHub will remove any cache entries that have not been accessed in over 7 days." The 2025 changelog says the retention limit counts how long entries are kept "after last access" ([changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/)). Public repos can now raise this to 90 days on an eligible account ([repo settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-cache-settings-for-your-repository)). Whether raising retention costs anything by itself is **unverified**.
2. **Size:** when the repo goes over its limit, "GitHub will save the new cache but will begin evicting caches until the total size is less than the repository limit", "in order of last access date, from oldest to most recent". This is **LRU**, least recently used first. The docs warn this can cause "cache thrashing", meaning entries created and deleted at a high rate.

**How often eviction runs.** It used to run every 24 hours, so repos could sit above 10 GB between passes. GitHub announced it would switch to "every hour" and warned this "could lead to additional cache thrashing" ([changelog 2025-09-29](https://github.blog/changelog/2025-09-29-new-date-for-enforcement-of-cache-eviction-policy/)). In November 2025 a staff member wrote that once the configurable limits shipped "by November 24", "LRU cache evictions will happen at a near real-time pace" ([#1667, staff comment](https://github.com/actions/cache/issues/1667#issuecomment-3510737240)). The current docs give no interval.

### Docs versus practice

- **Out-of-order eviction (2025, fixed).** A maintainer logged hourly snapshots showing newer, actively used entries expiring before older ones, which goes against the documented LRU order. Staff confirmed "a known issue where cache entries uploaded are not expired (LRU or otherwise) even when repos exceed the 10GB threshold until after 24 hours have passed". They said it was fixed and rolling out with the November 2025 limits ([#1667](https://github.com/actions/cache/issues/1667)). This only hit repos over the size limit.
- **Service incidents.** On 2025-06-18, restores failed for several hours with `Cache hit for: … / Failed to restore` followed by `Cache not found`, even though the entries existed. The cache list page flickered between entries and "No Caches". Staff called it an incident, pointed to githubstatus.com and rolled out a fix ([#1621](https://github.com/actions/cache/issues/1621)). Saves failed too.
- **Intermittent misses and indexing lag (2026, open).** Users report a fresh save taking about 4 minutes to become visible ([#1710](https://github.com/actions/cache/issues/1710), [#1694](https://github.com/actions/cache/issues/1694)). They also report intermittent `Cache not found` on keys that were just saved, from March to at least June 2026, with no staff reply yet ([#1735](https://github.com/actions/cache/issues/1735)). A gap of minutes doesn't matter at an hourly cadence; intermittent not-found does.
- How often incidents happen overall is **unverified**. I didn't go through the githubstatus.com history.

### What this means for an entry touched every hour

- **Age-based eviction should never hit us.** Each run restores the newest `state-` entry, which updates its last access, and the next save is less than an hour later.
- **Size-based eviction would only hit us** if something else in the repo pushed total usage over 10 GB. Even then LRU would take our entry last, since it's the most recently used.
- **What remains is outages and intermittent restore failures.** The client deliberately turns these into a miss: restore errors are caught and logged ("warn on cache restore failure and continue build"), and the step succeeds with nothing restored ([toolkit `cache.ts`](https://github.com/actions/toolkit/blob/main/packages/cache/src/cache.ts)).

So **yes, we must handle a missing cache**: fall back to a full fetch. GitHub's own guidance is the same: "a job should always be able to re-download or regenerate these files" ([concepts](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)). We must also avoid saving a degraded `state.db` over a good one (section 8).

## 6. Rate limits

Per repository ([Actions limits](https://docs.github.com/en/actions/reference/limits), [reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy)):

| Operation | Limit |
|---|---|
| Cache uploads (new entries) | 200 per minute (introduced 2026-01-16 because "some repositories upload large volumes of cache entries in short bursts" ([changelog](https://github.blog/changelog/2026-01-16-rate-limiting-for-actions-cache-entries/))) |
| Cache downloads | 1,500 per minute |
| Cache deletes | 400 per minute, each delete by key or ID counts |

When a limit is exceeded, further attempts fail until it resets, and the reset time is in the `Retry-After` header. The toolkit does not retry on HTTP 429. It logs "You've hit a rate limit…" and gives up, which on restore means a miss ([toolkit twirp client](https://github.com/actions/toolkit/blob/main/packages/cache/src/internal/shared/cacheTwirpClient.ts)). The list and delete REST endpoints also count against the normal REST API rate limits ([Actions limits](https://docs.github.com/en/actions/reference/limits)). Running hourly, with one restore, one save and a few deletes per run, we are nowhere near any of these.

## 7. Security in a public repo

**Who can read our caches?**

- **Metadata is public.** Anyone can see key, size, ref and timestamps without logging in. `GET /repos/actions/cache/actions/caches` returned 200 with no token (checked live 2026-11-24). The docs say the list endpoint needs `repo` scope, which applies to private repos ([REST cache API](https://docs.github.com/en/rest/actions/cache#list-github-actions-caches-for-a-repository)).
- **Contents can be read by anyone who can run a workflow against us.** There's no download API ([#105](https://github.com/actions/cache/issues/105)). But "Anyone with read access can create a pull request on a repository and access the contents of a cache. Additionally, forks of a repository can create pull requests on the base branch and access caches on the base branch" ([reference note](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#input-parameters-for-the-cache-action)). In a public repo, that is anyone with a GitHub account.
  - In practice that needs a workflow in our repo that runs on `pull_request`; ours runs only on `schedule` and `workflow_dispatch`. A PR that *adds* such a workflow would run it, subject to the repo's approval settings for first-time contributors (**unverified** for this exact path).
  - Either way, treat cache contents as public.
- **For us:** `state.db` must hold only public data. That is already the v1 privacy rule, and the canary test already checks `state.db`. Using the cache makes that check load-bearing: a canary in `state.db` would become readable by anyone, not just sit on a throwaway runner.

**Cache poisoning** means someone writes a malicious cache that a more trusted run later restores and executes or trusts ([concepts, cache security](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching#cache-security)). Cache contents "are not signed or verified" ([best practices](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#best-practices-for-using-caches-securely)). Who can write a cache our default branch will restore:

- **`pull_request`, including from forks: no.** Its caches go to `refs/pull/<n>/merge` and "cannot be written to the default branch's scope" ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-access-for-low-trust-workflow-triggers)). Fork PRs get a read-only cache token anyway ([README: read-only access](https://github.com/actions/cache#read-only-access)).
- **`pull_request_target`, `issue_comment`, `workflow_run` and other triggers outsiders can cause: no, since 2026-06-26.** They run on the default branch but now get **read-only** cache access there. Before that, they could write ([changelog](https://github.blog/changelog/2026-06-26-read-only-actions-cache-for-untrusted-triggers/), [reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-access-for-low-trust-workflow-triggers)). A workflow can opt back in with `cache-mode: write`, so don't.
- **Who still can:** only trusted triggers on the default branch (`push`, `schedule`, `workflow_dispatch`, `repository_dispatch`, `delete`, `registry_package`, `page_build`), which in practice means people with write access, or a compromised workflow step.

Our residual risk is small: `state.db` is data, not code. Still, the collector should treat a restored file as untrusted input. Check it opens, passes `PRAGMA integrity_check`, and carries the expected schema version, and fall back to a full fetch if not.

## 8. Recommended pattern for `state.db`

```yaml
permissions:
  contents: read
  actions: write        # delete old cache entries (also used by the keep-alive step)
concurrency: { group: activity, cancel-in-progress: false }

steps:
  - uses: actions/checkout@v6

  - name: Restore state.db
    id: restore
    uses: actions/cache/restore@v6
    with:
      path: state.db                       # must be written identically in the save step
      key: state-v1-${{ github.run_id }}-${{ github.run_attempt }}
      restore-keys: state-v1-

  - name: Detect a failed restore
    id: guard
    env: { GH_TOKEN: "${{ github.token }}" }
    run: |
      if [ ! -f state.db ] && [ -n "$(gh cache list --key state-v1- --limit 1 --json id --jq '.[].id')" ]; then
        echo "::warning::state-v1- entries exist but none restored; will not save this run"
        echo "skip_save=true" >> "$GITHUB_OUTPUT"
      fi

  - name: Collect          # incremental if state.db is present and valid, full fetch otherwise
    run: just collect

  - name: Save state.db
    if: steps.guard.outputs.skip_save != 'true'
    uses: actions/cache/save@v6
    with:
      path: state.db
      key: ${{ steps.restore.outputs.cache-primary-key }}

  - name: Prune old state entries (keep newest 3)
    env: { GH_TOKEN: "${{ github.token }}" }
    run: |
      gh cache list --key state-v1- --sort created_at --order desc --limit 100 --json id --jq '.[3:][].id' \
        | xargs -r -n1 gh cache delete
```

Why each piece:

- **A unique key per run, plus a prefix restore.** This is the documented way to "update" an immutable cache ([tips](https://github.com/actions/cache/blob/main/tips-and-workarounds.md#update-a-cache)). Prefix matching returns "the most recently created" entry ([reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-key-matching)), which is the last successful save.
- **`run_attempt` in the key**, so a re-run can save (section 3).
- **`v1` in the prefix.** Bumping it when the schema changes makes every run start fresh, and old entries age out on their own.
- **Split restore and save.** Save runs only after a successful collect, and can be skipped by the guard ([save README](https://github.com/actions/cache/blob/main/save/README.md)). `cache-hit` will always be `false` here, because there is never an exact match. Check whether `state.db` exists instead, or use `cache-matched-key`.
- **The guard** stops a failed restore from replacing rich history with a thinner full fetch. It matters only once `state.db` holds things GitHub forgets. Until then a full fetch rebuilds everything, and the guard costs nothing.
  - It uses the list API, which has had its own inconsistency during incidents ([#1621](https://github.com/actions/cache/issues/1621), [#1735](https://github.com/actions/cache/issues/1735)). So it lowers the risk but can't remove it.
  - A stricter version fails the run instead of skipping the save, so a human notices.
- **Pruning.** `gh cache list` filters by key prefix and sorts by `created_at`. `gh cache delete` takes an ID ([gh cache CLI](https://cli.github.com/manual/gh_cache)). Deleting needs `actions: write` on `GITHUB_TOKEN`: the docs' own cleanup example sets `permissions: actions: write` ([managing caches](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manage-caches#force-deleting-cache-entries)). For fine-grained tokens, the delete endpoints need "Actions" repository permission: write ([fine-grained permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens#repository-permissions-for-actions)).
  - Keeping a few entries gives a short rollback window if a bad `state.db` is ever saved.
  - Pruning is best-effort: if it fails, nothing breaks.

**How many entries pile up, and does it matter?**

- **Without pruning:** each superseded entry is never read again, so it expires about 7 days after creation. That gives roughly 24 × 7 = **168 entries** in steady state, a few hundred MB at most. It fits in 10 GB, there's no limit on entry count, and it uses less than 1 upload per minute against a limit of 200. So no, it doesn't matter.
- **With pruning:** 3 entries. The Caches page stays readable, and if other workflows ever fill the repo, LRU has less of ours to consider.

## 9. Alternatives for persisting state between runs

| Option | Retention | Notes |
|---|---|---|
| **Actions cache** (above) | 7 days after last use (up to 90 days on an eligible account); can be evicted | Free, no setup, fastest. Can fail transiently. Speed only |
| **Workflow artifact chain** | 90 days by default; 1 to 90 days for public repos, per repo or per artifact (`retention-days`) ([repo settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-the-retention-period-for-checks-workflow-runs-commit-statuses-artifacts-and-logs-in-your-repository), [remove artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts#setting-the-retention-period-for-an-artifact)) | Each run uploads `state.db`. The next run finds the last successful run (`gh run list --workflow … --status success --limit 1`) and downloads its artifact with `actions/download-artifact@v8` using `run-id` and `github-token`. The README calls for a "token with actions:read permissions" ([download-artifact](https://github.com/actions/download-artifact#download-artifacts-from-other-workflow-runs-or-repositories)); that `GITHUB_TOKEN` with `actions: read` is enough for the same repo is **unverified**. Not evicted for size, but more moving parts. Anyone with read access can download artifacts ([download artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)). Whether artifact storage counts against any allowance in a public repo is **unverified**; the billing page describes storage charges only for private repos ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) |
| **Commit to a branch** (such as an orphan `state` branch) | Permanent | Durable and inspectable. Binary SQLite diffs poorly, so committing hourly grows history fast: GitHub recommends staying under 10 GB on disk and 1 MB per object, with a hard 100 MB per file ([repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)). Force-pushing a single-commit orphan branch keeps history short; when GitHub garbage-collects the orphaned objects is **unverified**. Commits would also count as "repository activity" for the 60-day rule ([events reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)), but the docs don't define that term (**unverified**), and design.md already chose an API keep-alive with no commits. Needs `contents: write` |
| **Publish it with the page (GitHub Pages)** | As long as the site exists | Bold but cheap. The data is already public, so ship `state.db` (gzipped) in `dist/` and have the next run download it from the site if the cache misses. No token, no expiry, no eviction, and visitors get the raw data (for example in Datasette Lite). Limits: published site ≤ 1 GB, 100 GB/month soft bandwidth ([Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). Costs: it raises the stakes of the privacy test, since the file would be a public download by design; and it depends on the last deploy having succeeded. CDN staleness after a deploy is **unverified**, and an hour's gap should cover it |
| **External object storage** (S3, R2, B2) | Whatever you configure | Durable and conventional. Needs an account and a secret in Actions, which is more setup for every fork. design.md lists it as a candidate |

A sensible layering, if durability is ever needed: Actions cache first (fast), then the Pages copy (durable), then a full fetch, with the guard from section 8 applied to the whole chain.

## Sources

- https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching
- https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manage-caches
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#cache-mode
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- https://docs.github.com/en/rest/actions/cache
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://cli.github.com/manual/gh_cache (also `gh cache list --help` / `gh cache delete --help`, gh 2.104.0)
- https://github.blog/changelog/2021-11-22-github-actions-cache-size-is-now-increased-to-10gb-per-repository/
- https://github.blog/changelog/2025-09-29-new-date-for-enforcement-of-cache-eviction-policy/
- https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/
- https://github.blog/changelog/2026-01-16-rate-limiting-for-actions-cache-entries/
- https://github.blog/changelog/2026-06-26-read-only-actions-cache-for-untrusted-triggers/
- https://github.blog/changelog/2026-09-10-control-github-actions-cache-access-with-cache-mode/
- https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/
- https://github.com/actions/cache (README, `restore/README.md`, `save/README.md`, `tips-and-workarounds.md`)
- https://github.com/actions/cache/releases/tag/v6.1.0
- https://github.com/actions/cache/discussions/1510
- https://github.com/actions/toolkit/tree/main/packages/cache/src (`cache.ts`, `internal/cacheUtils.ts`, `internal/config.ts`, `internal/shared/cacheTwirpClient.ts`)
- https://github.com/actions/setup-node#caching-global-packages-data
- https://github.com/actions/download-artifact#download-artifacts-from-other-workflow-runs-or-repositories
- https://github.com/actions/cache/issues/105 (no cache download API; staff replies)
- https://github.com/actions/cache/issues/1621 (June 2025 restore incident; staff replies)
- https://github.com/actions/cache/issues/1653 (path must match between save and restore)
- https://github.com/actions/cache/issues/1667 (out-of-order eviction; staff confirmed and fixed)
- https://github.com/actions/cache/issues/1694 and https://github.com/actions/cache/issues/1710 (indexing lag after save)
- https://github.com/actions/cache/issues/1735 (intermittent "Cache not found", open, no staff reply)
