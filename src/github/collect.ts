// Collects the owner's public GitHub activity into the database. See docs/design.md, "Data sources".
// Privacy: everything marked private is dropped on arrival and only counted, never named, in the log.
import type { Database } from '../db.ts';
import { CollectError, type Client } from './client.ts';

export interface CollectOptions { client: Client; db: Database; owner: string; now: Date; log: (line: string) => void; /** Pause between retries of a timed-out search. */ sleep?: (ms: number) => Promise<void>; /** Repos to fetch details for even without work in them (favorites). */ alsoRepos?: string[] }
export interface CollectResult { ownRepos: number; items: number; commits: number; externalRepos: number; droppedPrivate: number; apiCalls: number }

const SOURCE = 'github';
/** Every timestamp is stored in UTC; GitHub mixes UTC and local offsets (commit search). */
export const utc = (iso: string) => new Date(iso).toISOString().replace(/\.000Z$/, 'Z');
const REPO_REF = 'repository { nameWithOwner isPrivate }';

// The full-history connections on User: one item kind each.
const CONNECTIONS = [
  { op: 'Issues', field: 'issues', kind: 'issue', fields: `id createdAt title url state ${REPO_REF}` },
  { op: 'PullRequests', field: 'pullRequests', kind: 'pr', fields: `id createdAt title url state mergedAt ${REPO_REF}` },
  { op: 'IssueComments', field: 'issueComments', kind: 'issue_comment', fields: `id createdAt url issue { title } ${REPO_REF}` },
  { op: 'CommitComments', field: 'commitComments', kind: 'commit_comment', fields: `id createdAt url commit { oid } ${REPO_REF}` },
  { op: 'Discussions', field: 'repositoryDiscussions', kind: 'discussion', fields: `id createdAt title url ${REPO_REF}` },
  { op: 'DiscussionReplies', field: 'repositoryDiscussionComments', kind: 'discussion_reply', fields: `id createdAt url discussion { title ${REPO_REF} }` },
] as const;

interface Item { node_id: string; kind: string; repo: string; created_at: string; title: string; url: string; state?: string | null; merged_at?: string | null }
interface Commit { sha: string; repo: string; fork: boolean; authored_at: string; message: string; additions: number | null; deletions: number | null }

export async function collectGitHub(o: CollectOptions): Promise<CollectResult> {
  const { client, db, owner, log } = o;
  let dropped = 0;
  const isPublic = (r: { isPrivate?: boolean; private?: boolean } | null | undefined) => {
    if (!r || r.isPrivate || r.private) { dropped++; return false; }
    return true;
  };
  const pages = async <N>(fetchPage: (after: string | null) => Promise<{ pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: N[] } | null | undefined>) => {
    const out: N[] = [];
    for (let after: string | null = null; ;) {
      const conn = await fetchPage(after);
      if (!conn) return out;
      out.push(...conn.nodes);
      if (!conn.pageInfo.hasNextPage) return out;
      after = conn.pageInfo.endCursor;
    }
  };
  const user = async (query: string, variables: Record<string, unknown>) => (await client.graphql(query, { login: owner, ...variables })).user;

  // ---------- profile ----------
  const profile = await user(`query Profile($login: String!) { user(login: $login) { id login createdAt bio location company
    contributionsCollection { contributionYears restrictedContributionsCount contributionCalendar { totalContributions } } } }`, {});
  if (!profile) throw new CollectError(`no GitHub user named ${owner}`);
  const years: number[] = [...profile.contributionsCollection.contributionYears].sort();

  // ---------- own public repos ----------
  const repoNodes = await pages<any>(async after => (await user(`query Repos($login: String!, $after: String) { user(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes { nameWithOwner owner { login } isPrivate isFork isArchived description stargazerCount licenseInfo { spdxId } primaryLanguage { name }
        parent { nameWithOwner } createdAt pushedAt } } } }`, { after })).repositories);
  const ownRepos = repoNodes.filter(isPublic);
  const ownNames = new Set(ownRepos.map(r => r.nameWithOwner));

  const orgs: { login: string }[] = await client.rest(`/users/${encodeURIComponent(owner)}/orgs?per_page=100`);

  // ---------- items ----------
  const items: Item[] = [];
  const counts: Record<string, number> = {};
  const addItem = (repo: { nameWithOwner: string; isPrivate?: boolean } | null | undefined, item: Omit<Item, 'repo'>) => {
    if (!isPublic(repo)) return;
    items.push({ ...item, repo: repo!.nameWithOwner });
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  };
  for (const c of CONNECTIONS) {
    const nodes = await pages<any>(async after => (await user(`query ${c.op}($login: String!, $after: String) { user(login: $login) {
      ${c.field}(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${c.fields} } } } }`, { after }))[c.field]);
    for (const n of nodes) {
      const repo = n.repository ?? n.discussion?.repository;
      const title = n.title ?? n.issue?.title ?? n.discussion?.title ?? (n.commit ? `comment on ${n.commit.oid.slice(0, 7)}` : '');
      addItem(repo, { node_id: n.id, kind: c.kind, created_at: utc(n.createdAt), title, url: n.url, state: n.state ?? null, merged_at: n.mergedAt ? utc(n.mergedAt) : null });
    }
  }

  // ---------- per year: calendar, totals, reviews, repos created or forked ----------
  const calendar = new Map<string, number>();
  const yearTotals: Record<string, number>[] = [];
  for (const y of years) {
    const range = { from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` };
    const c = (await user(`query YearTotals($login: String!, $from: DateTime!, $to: DateTime!) { user(login: $login) { contributionsCollection(from: $from, to: $to) {
      totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`, range)).contributionsCollection;
    for (const w of c.contributionCalendar.weeks) for (const d of w.contributionDays) if (d.date.startsWith(`${y}-`)) calendar.set(d.date, d.contributionCount);
    yearTotals.push({ year: y, contributions: c.contributionCalendar.totalContributions, commits: c.totalCommitContributions, issues: c.totalIssueContributions,
      prs: c.totalPullRequestContributions, reviews: c.totalPullRequestReviewContributions, restricted: c.restrictedContributionsCount });

    const reviews = await pages<any>(async after => (await user(`query YearReviews($login: String!, $from: DateTime!, $to: DateTime!, $after: String) { user(login: $login) {
      contributionsCollection(from: $from, to: $to) { pullRequestReviewContributions(first: 100, after: $after) { pageInfo { hasNextPage endCursor }
        nodes { occurredAt pullRequestReview { id url } pullRequest { title ${REPO_REF} } } } } } }`, { ...range, after })).contributionsCollection.pullRequestReviewContributions);
    for (const r of reviews) addItem(r.pullRequest.repository, { node_id: r.pullRequestReview.id, kind: 'review', created_at: utc(r.occurredAt), title: r.pullRequest.title, url: r.pullRequestReview.url });

    const created = await pages<any>(async after => (await user(`query YearRepos($login: String!, $from: DateTime!, $to: DateTime!, $after: String) { user(login: $login) {
      contributionsCollection(from: $from, to: $to) { repositoryContributions(first: 100, after: $after) { pageInfo { hasNextPage endCursor }
        nodes { occurredAt repository { id nameWithOwner isPrivate isFork url } } } } } }`, { ...range, after })).contributionsCollection.repositoryContributions);
    for (const r of created) addItem(r.repository, { node_id: `repo:${r.repository.id}`, kind: r.repository.isFork ? 'fork' : 'new_repo', created_at: utc(r.occurredAt), title: r.repository.nameWithOwner, url: r.repository.url });
  }

  // ---------- commits: own repos by walking their default branch, everything else by search ----------
  const commits = new Map<string, Commit & { rank: number }>();
  const rank = (c: Commit) => !c.fork ? 0 : c.repo.startsWith(`${owner}/`) ? 1 : 2;   // not a fork, then the owner's fork, then any fork
  const addCommit = (c: Commit) => {
    const cur = commits.get(c.sha), r = rank(c);
    if (!cur || r < cur.rank) commits.set(c.sha, { ...c, rank: r, additions: c.additions ?? cur?.additions ?? null, deletions: c.deletions ?? cur?.deletions ?? null });
    else if (cur.additions == null && c.additions != null) Object.assign(cur, { additions: c.additions, deletions: c.deletions });
  };
  let fromHistory = 0, fromSearch = 0;
  for (const r of ownRepos) {
    const [name_owner, name] = r.nameWithOwner.split('/');
    // a fork is walked only from when it was forked: older commits are the upstream's
    const nodes = await pages<any>(async after => (await client.graphql(`query History($owner: String!, $name: String!, $author: ID!, $since: GitTimestamp, $after: String) {
      repository(owner: $owner, name: $name) { defaultBranchRef { target { ... on Commit { history(first: 100, after: $after, author: { id: $author }, since: $since) {
        pageInfo { hasNextPage endCursor } nodes { oid authoredDate messageHeadline additions deletions url } } } } } } }`,
      { owner: name_owner, name, author: profile.id, since: r.isFork ? r.createdAt : null, after })).repository?.defaultBranchRef?.target?.history);
    for (const n of nodes) { fromHistory++; addCommit({ sha: n.oid, repo: r.nameWithOwner, fork: r.isFork, authored_at: utc(n.authoredDate), message: n.messageHeadline, additions: n.additions, deletions: n.deletions }); }
  }
  // GitHub's search sometimes times out and says so with incomplete_results: retry a couple of times, then split the range
  // (smaller searches rarely time out); only a single day that stays incomplete fails the run.
  const sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  let searchRetries = 0, searchSplits = 0;
  const searchPage = async (q: string, page: number) => {
    for (let attempt = 1; ; attempt++) {
      const res = await client.rest(`/search/commits?q=${q}&per_page=100&page=${page}`);
      if (!res.incomplete_results || attempt === 3) return res;
      searchRetries++;
      await sleep(2000 * attempt);
    }
  };
  const searchSlice = async (from: string, to: string): Promise<void> => {
    const q = encodeURIComponent(`author:${owner} author-date:${from}..${to}`);
    const first = await searchPage(q, 1);
    if (first.incomplete_results) {
      if (from === to) throw new CollectError(`commit search for ${from} returned incomplete results, even after retrying`);
      searchSplits++;
      const mid = addDays(from, Math.floor(daysBetween(from, to) / 2));
      await searchSlice(from, mid);
      return searchSlice(addDays(mid, 1), to);
    }
    if (first.total_count >= 1000) {
      if (from === to) throw new CollectError(`commit search for ${from} has ${first.total_count} results, more than the 1000 it can return`);
      const mid = addDays(from, Math.floor(daysBetween(from, to) / 2));
      await searchSlice(from, mid);
      return searchSlice(addDays(mid, 1), to);
    }
    const hits = [...first.items];
    for (let p = 2; p <= Math.ceil(first.total_count / 100); p++) {
      const next = await searchPage(q, p);
      if (next.incomplete_results) throw new CollectError(`commit search for ${from}..${to} (page ${p}) returned incomplete results, even after retrying`);
      hits.push(...next.items);
    }
    for (const h of hits) {
      if (!isPublic(h.repository)) continue;
      fromSearch++;
      addCommit({ sha: h.sha, repo: h.repository.full_name, fork: h.repository.fork, authored_at: utc(h.commit.author.date), message: h.commit.message.split('\n')[0], additions: null, deletions: null });
    }
  };
  for (const y of years) await searchSlice(`${y}-01-01`, `${y}-12-31`);

  // ---------- details of external repos on the page ----------
  const externalNames = [...new Set([...items.map(i => i.repo), ...[...commits.values()].map(c => c.repo), ...ownRepos.filter(r => r.parent).map(r => r.parent.nameWithOwner), ...(o.alsoRepos ?? [])])]
    .filter(n => !ownNames.has(n) && !n.startsWith(`${owner}/`)).sort();
  const external: any[] = [];
  let missing = 0;
  for (let i = 0; i < externalNames.length; i += 25) {
    const batch = externalNames.slice(i, i + 25);
    const fields = batch.map((n, j) => { const [ow, nm] = n.split('/'); return `r${j}: repository(owner: ${JSON.stringify(ow)}, name: ${JSON.stringify(nm)}) { nameWithOwner isPrivate description stargazerCount licenseInfo { spdxId } primaryLanguage { name } }`; });
    const data = await client.graphql(`query RepoDetails {\n${fields.join('\n')}\n}`, {}, { allowNotFound: true });
    for (const d of Object.values<any>(data ?? {})) { if (!d) { missing++; continue; } if (isPublic(d)) external.push(d); }
  }

  // ---------- write ----------
  db.exec('BEGIN');
  try {
    const ins = (sql: string) => db.prepare(sql);
    ins(`INSERT INTO profile (source, login, created_at, bio, location, company) VALUES (?, ?, ?, ?, ?, ?)`).run(SOURCE, profile.login, utc(profile.createdAt), profile.bio, profile.location, profile.company);
    const meta = ins(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);
    meta.run('owner', profile.login);
    meta.run('collected_at', utc(o.now.toISOString()));
    meta.run('contributions_last_12_months', String(profile.contributionsCollection.contributionCalendar.totalContributions));
    meta.run('restricted_last_12_months', String(profile.contributionsCollection.restrictedContributionsCount));
    const org = ins(`INSERT INTO orgs (source, login, name) VALUES (?, ?, NULL)`);
    for (const g of orgs) org.run(SOURCE, g.login);
    const repo = ins(`INSERT INTO repos (source, name_with_owner, owner, is_own, is_private, is_fork, is_archived, parent, description, stars, license, language, created_at, pushed_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of ownRepos) repo.run(SOURCE, r.nameWithOwner, r.owner.login, 1, r.isFork ? 1 : 0, r.isArchived ? 1 : 0, r.parent?.nameWithOwner ?? null, r.description, r.stargazerCount,
      license(r), r.primaryLanguage?.name ?? null, utc(r.createdAt), r.pushedAt ? utc(r.pushedAt) : null);
    for (const r of external) repo.run(SOURCE, r.nameWithOwner, r.nameWithOwner.split('/')[0], 0, 0, 0, null, r.description, r.stargazerCount, license(r), r.primaryLanguage?.name ?? null, null, null);
    const item = ins(`INSERT OR IGNORE INTO items (source, node_id, kind, repo, created_at, title, url, state, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const i of items) item.run(SOURCE, i.node_id, i.kind, i.repo, i.created_at, i.title, i.url, i.state ?? null, i.merged_at ?? null);
    const commit = ins(`INSERT INTO commits (source, sha, repo, authored_at, message, additions, deletions) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const c of commits.values()) commit.run(SOURCE, c.sha, c.repo, c.authored_at, c.message, c.additions, c.deletions);
    const day = ins(`INSERT INTO calendar (source, date, total) VALUES (?, ?, ?)`);
    for (const [d, n] of [...calendar].sort()) day.run(SOURCE, d, n);
    const yt = ins(`INSERT INTO year_totals (source, year, contributions, commits, issues, prs, reviews, restricted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const t of yearTotals) yt.run(SOURCE, t.year, t.contributions, t.commits, t.issues, t.prs, t.reviews, t.restricted);
    ins(`INSERT INTO runs (started_at, finished_at, api_calls, items_collected, items_dropped_private, error) VALUES (?, ?, ?, ?, ?, NULL)`)
      .run(utc(o.now.toISOString()), utc(o.now.toISOString()), client.calls(), items.length, dropped);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  // ---------- log: counts only ----------
  log(`contribution years: ${years[0]}–${years[years.length - 1]}`);
  log(`own public repos: ${ownRepos.length}; public orgs: ${orgs.length}`);
  log(`items: ${Object.entries(counts).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
  log(`commits: ${commits.size} (from own repos ${fromHistory}, search hits ${fromSearch})${searchRetries || searchSplits ? `; search timed out ${searchRetries} times, retried${searchSplits ? `, split ${searchSplits} ranges` : ''}` : ''}`);
  log(`external repos: ${external.length}${missing ? ` (${missing} no longer exist)` : ''}`);
  log(`dropped as private: ${dropped}`);
  log(`API calls: ${client.calls()}`);
  return { ownRepos: ownRepos.length, items: items.length, commits: commits.size, externalRepos: external.length, droppedPrivate: dropped, apiCalls: client.calls() };
}

const license = (r: { licenseInfo?: { spdxId?: string } | null }) => r.licenseInfo?.spdxId && r.licenseInfo.spdxId !== 'NOASSERTION' ? r.licenseInfo.spdxId : null;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
