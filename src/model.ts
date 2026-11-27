// The render model: everything the page shows, worked out from (database, settings, now). Pure: no network, no clock.
// Every display rule lives here (README "Methodology"); the renderer only turns this into HTML.
import type { Database } from './db.ts';
import type { Settings, Section } from './settings.ts';

export type Kind = 'commit' | 'pr' | 'issue' | 'discussion' | 'discussion_reply' | 'review' | 'new_repo' | 'fork' | 'issue_comment' | 'commit_comment';
export interface FeedItem { kind: Kind; repo: string; at: string; title: string; url: string }
export type FeedRow = (FeedItem & { group: false }) | { group: true; kind: Kind; repo: string; at: string; items: FeedItem[] };
export interface Week { start: string; rows: FeedRow[] }
export interface Counts { commits: number; prs: number; issues: number; discussions: number }
export interface RepoRow {
  repo: string; url: string; description: string | null; stars: number; licence: string | null; archived: boolean;
  /** Set for an adopted fork: the repo it was forked from. */
  forkOf: string | null;
  /** A fork whose upstream no longer exists. */
  upstreamDeleted: boolean;
  /** The owner's forks whose work is counted on this row. */
  forks: string[];
  counts: Counts; lastActive: string | null;
  /** Commits per month, the last 24 months, oldest first (the owner's months). */
  monthly: number[];
  /** One per commit, pull request, issue or discussion, for the Contributing to timeline. */
  dots: { at: string; kind: Kind; title: string }[];
}
export interface YearSection {
  year: number;
  totals: { contributions: number; commits: number; prs: number; issues: number; discussions: number; newRepos: number };
  mostActive: { repo: string; count: number }[];
  calendar: { date: string; count: number }[];
  weeks: Week[];
}
export interface Model {
  owner: string; title: string; timezone: string; builtAt: string; sections: Section[];
  profile: { login: string; bio: string | null; location: string | null; company: string | null; since: number; orgs: string[]; achievementsUrl: string };
  stats: {
    allTime: { commits: number; prs: number; issues: number; discussions: number; reposCreated: number };
    last12: { contributions: number; currentStreak: number; longestStreak: number };
    /** GitHub's anonymous count of private contributions, when it gives one. */
    privateLast12: number | null;
  };
  overview: { licences: { name: string; count: number }[]; languages: { name: string; commits: number; share: number }[] };
  heatmap: { date: string; count: number }[];
  /** Items per kind across all years, for the feed's filter chips. */
  kindCounts: Partial<Record<Kind, number>>;
  feed: { weeks: Week[] };
  years: YearSection[];
  projects: { favorites: RepoRow[]; mine: RepoRow[]; idleForks: number; /** Favorites that aren't a known public repo (unknown, deleted or private): left out. */ skippedFavorites: number };
  contributing: { repos: number; owners: number; firstYear: number | null; perYear: { year: number; repos: number }[]; axis: { from: string; to: string } | null; rows: RepoRow[] };
}

const COMMENTS: Kind[] = ['issue_comment', 'commit_comment'];
const WORK: Kind[] = ['commit', 'pr', 'issue', 'discussion', 'discussion_reply'];   // what a repo row counts
const ADOPTION_THRESHOLD = 3;
const LANGUAGES_SHOWN = 6;

export function buildModel(db: Database, settings: Settings, now: Date): Model {
  const tz = settings.timezone, owner = settings.user;
  const q = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as T[];
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = (iso: string | Date) => dayFmt.format(new Date(iso));
  const yearOf = (iso: string) => Number(day(iso).slice(0, 4));
  const today = day(now);
  const cutoff = new Date(now.getTime() - 365 * 86_400_000).toISOString();

  // ---------- load ----------
  const meta = Object.fromEntries(q<{ key: string; value: string }>('SELECT key, value FROM meta').map(r => [r.key, r.value]));
  const prof = q<any>('SELECT * FROM profile LIMIT 1')[0];
  const repos = new Map(q<any>('SELECT * FROM repos').map(r => [r.name_with_owner, r]));
  const ownRepos = [...repos.values()].filter(r => r.is_own);
  const items: FeedItem[] = q<any>('SELECT kind, repo, created_at, title, url FROM items').map(r => ({ kind: r.kind, repo: r.repo, at: r.created_at, title: r.title, url: r.url }));
  const commits: FeedItem[] = q<any>('SELECT sha, repo, authored_at, message FROM commits').map(r => ({ kind: 'commit', repo: r.repo, at: r.authored_at, title: r.message, url: `https://github.com/${r.repo}/commit/${r.sha}` }));
  const all = [...items, ...commits].sort(newestFirst);
  const feedKinds = (k: Kind) => settings.feedComments || !COMMENTS.includes(k);
  const feed = all.filter(i => feedKinds(i.kind));
  const calendar = q<{ date: string; total: number }>('SELECT date, total FROM calendar ORDER BY date').map(r => ({ date: r.date, count: r.total }));

  // ---------- forks: folded into their upstream, unless adopted ----------
  const insideFork = new Map<string, number>();
  for (const i of items) if ((i.kind === 'pr' || i.kind === 'issue') && repos.get(i.repo)?.is_own && repos.get(i.repo)?.is_fork) insideFork.set(i.repo, (insideFork.get(i.repo) ?? 0) + 1);
  const adopted = new Set([...insideFork].filter(([, n]) => n >= ADOPTION_THRESHOLD).map(([r]) => r));
  const rowOf = (repo: string) => { const r = repos.get(repo); return r?.is_own && r.is_fork && r.parent && !adopted.has(repo) ? r.parent : repo; };

  // ---------- repo rows ----------
  const monthIndex = (iso: string) => { const [y, m] = day(iso).split('-').map(Number), [ny, nm] = today.split('-').map(Number); return 23 - ((ny - y) * 12 + nm - m); };
  const rowData = new Map<string, Omit<RepoRow, 'url' | 'description' | 'stars' | 'licence' | 'archived' | 'forkOf' | 'upstreamDeleted'>>();
  const empty = (repo: string) => ({ repo, forks: [] as string[], counts: { commits: 0, prs: 0, issues: 0, discussions: 0 }, lastActive: null as string | null, monthly: new Array(24).fill(0), dots: [] as RepoRow['dots'] });
  const data = (repo: string) => { let d = rowData.get(repo); if (!d) rowData.set(repo, d = empty(repo)); return d; };
  for (const i of all) {
    if (!WORK.includes(i.kind)) continue;
    const d = data(rowOf(i.repo));
    if (i.kind === 'commit') { d.counts.commits++; const m = monthIndex(i.at); if (m >= 0 && m < 24) d.monthly[m]++; }
    else if (i.kind === 'pr') d.counts.prs++;
    else if (i.kind === 'issue') d.counts.issues++;
    else d.counts.discussions++;
    if (!d.lastActive || i.at > d.lastActive) d.lastActive = i.at;
    if (rowOf(i.repo) !== i.repo && !d.forks.includes(i.repo)) d.forks.push(i.repo);
    d.dots.push({ at: i.at, kind: i.kind, title: i.title });
  }
  const row = (repo: string): RepoRow => {
    const r = repos.get(repo), d = rowData.get(repo) ?? empty(repo);   // reading a row never registers work
    return { ...d, url: `https://github.com/${repo}`, description: r?.description ?? null, stars: r?.stars ?? 0, licence: r?.licence ?? null, archived: !!r?.is_archived,
      forkOf: r?.is_own && r.is_fork && r.parent && adopted.has(repo) ? r.parent : null, upstreamDeleted: !!(r?.is_own && r.is_fork && !r.parent),
      lastActive: d.lastActive ?? r?.pushed_at ?? null, dots: [...d.dots].sort(newestFirst) };
  };
  const isOwnRow = (repo: string) => !!repos.get(repo)?.is_own || repo.startsWith(`${owner}/`);

  const favorites = settings.favorites.filter(f => repos.has(f)).map(row);   // the collector only stores public repos
  const mine = ownRepos.filter(r => (!r.is_fork || !r.parent || adopted.has(r.name_with_owner)) && !settings.favorites.includes(r.name_with_owner))
    .map(r => row(r.name_with_owner)).sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
  const touched = new Set(all.filter(i => i.kind !== 'fork').map(i => i.repo));
  const idleForks = ownRepos.filter(r => r.is_fork && r.parent && !adopted.has(r.name_with_owner) && !touched.has(r.name_with_owner)).length;

  // ---------- contributing to: external repos and how broad the work is ----------
  const external = [...rowData.keys()].filter(r => !isOwnRow(r)).map(row).sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
  const extDots = external.flatMap(r => r.dots.map(d => ({ ...d, repo: r.repo })));
  const firstYear = extDots.length ? Math.min(...extDots.map(d => yearOf(d.at))) : null;
  const perYear: { year: number; repos: number }[] = [];
  if (firstYear) for (let y = firstYear; y <= Number(today.slice(0, 4)); y++) perYear.push({ year: y, repos: new Set(extDots.filter(d => yearOf(d.at) === y).map(d => d.repo)).size });
  const earliest = extDots.reduce<string | null>((m, d) => (!m || d.at < m ? d.at : m), null);

  // ---------- feed: the last 12 months; older years in their own sections ----------
  const recent = feed.filter(i => i.at >= cutoff), older = feed.filter(i => i.at < cutoff);
  const yearTotals = new Map(q<any>('SELECT * FROM year_totals').map(r => [r.year, r]));
  const years = [...new Set(older.map(i => yearOf(i.at)))].sort((a, b) => b - a).map((year): YearSection => {
    const inYear = all.filter(i => yearOf(i.at) === year), count = (k: Kind) => inYear.filter(i => i.kind === k).length;
    const active = new Map<string, number>();
    for (const i of inYear.filter(i => feedKinds(i.kind))) active.set(rowOf(i.repo), (active.get(rowOf(i.repo)) ?? 0) + 1);
    return {
      year,
      totals: { contributions: yearTotals.get(year)?.contributions ?? 0, commits: count('commit'), prs: count('pr'), issues: count('issue'), discussions: count('discussion'), newRepos: count('new_repo') },
      mostActive: [...active].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([repo, count]) => ({ repo, count })),
      calendar: calendar.filter(d => d.date.startsWith(`${year}-`)),
      weeks: weeksOf(older.filter(i => yearOf(i.at) === year), day),
    };
  });

  // ---------- stats ----------
  const lastYearDays = calendar.filter(d => d.date > shiftDay(today, -365) && d.date <= today);
  let longest = 0, run = 0;
  for (const d of lastYearDays) { run = d.count ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  { const byDate = new Map(lastYearDays.map(d => [d.date, d.count]));
    let d = (byDate.get(today) ?? 0) ? today : shiftDay(today, -1);   // nothing yet today doesn't break the streak
    while (byDate.get(d)) { current++; d = shiftDay(d, -1); } }
  const count = (k: Kind) => all.filter(i => i.kind === k).length;
  const restricted = Number(meta.restricted_last_12_months ?? 0);

  // ---------- overview ----------
  const licences = new Map<string, number>();
  for (const r of ownRepos) if (!r.is_fork && r.licence) licences.set(r.licence, (licences.get(r.licence) ?? 0) + 1);
  const langCommits = new Map<string, number>();
  for (const c of commits) { const l = repos.get(c.repo)?.language; if (l) langCommits.set(l, (langCommits.get(l) ?? 0) + 1); }
  const langs = [...langCommits].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = langs.slice(0, LANGUAGES_SHOWN), rest = langs.slice(LANGUAGES_SHOWN).reduce((s, [, n]) => s + n, 0);
  if (rest) shown.push(['Other', rest]);
  const langTotal = shown.reduce((s, [, n]) => s + n, 0);

  const kindCounts: Partial<Record<Kind, number>> = {};
  for (const i of feed) kindCounts[i.kind] = (kindCounts[i.kind] ?? 0) + 1;

  return {
    owner, title: settings.title, timezone: tz, builtAt: now.toISOString(), sections: settings.sections,
    profile: { login: prof?.login ?? owner, bio: prof?.bio ?? null, location: prof?.location ?? null, company: prof?.company ?? null, since: prof ? new Date(prof.created_at).getUTCFullYear() : 0,
      orgs: q<{ login: string }>('SELECT login FROM orgs ORDER BY login').map(r => r.login), achievementsUrl: `https://github.com/${owner}?tab=achievements` },
    stats: {
      allTime: { commits: count('commit'), prs: count('pr'), issues: count('issue'), discussions: count('discussion'), reposCreated: count('new_repo') },
      last12: { contributions: Number(meta.contributions_last_12_months ?? lastYearDays.reduce((s, d) => s + d.count, 0)), currentStreak: current, longestStreak: longest },
      privateLast12: restricted > 0 ? restricted : null,
    },
    overview: {
      licences: [...licences].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
      languages: shown.map(([name, commits]) => ({ name, commits, share: commits / langTotal })),
    },
    heatmap: lastYearDays,
    kindCounts,
    feed: { weeks: weeksOf(recent, day) },
    years,
    projects: { favorites, mine, idleForks, skippedFavorites: settings.favorites.length - favorites.length },
    contributing: { repos: external.length, owners: new Set(external.map(r => r.repo.split('/')[0])).size, firstYear, perYear,
      axis: earliest ? { from: earliest, to: now.toISOString() } : null, rows: external },
  };
}

/** Groups (same kind, repo and owner's day; commits from 2, others from 3), then weeks starting on the owner's Monday. */
function weeksOf(list: FeedItem[], day: (iso: string) => string): Week[] {
  const buckets = new Map<string, FeedItem[]>();
  for (const i of list) { const k = `${i.kind}|${i.repo}|${day(i.at)}`; let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(i); }
  const rows: FeedRow[] = [];
  for (const b of buckets.values()) {
    const sorted = [...b].sort(newestFirst);
    if (sorted.length >= (sorted[0].kind === 'commit' ? 2 : 3)) rows.push({ group: true, kind: sorted[0].kind, repo: sorted[0].repo, at: sorted[0].at, items: sorted });
    else rows.push(...sorted.map(i => ({ ...i, group: false as const })));
  }
  rows.sort(newestFirst);
  const weeks = new Map<string, FeedRow[]>();
  for (const r of rows) { const d = day(r.at), dow = new Date(`${d}T00:00:00Z`).getUTCDay(), start = shiftDay(d, -((dow + 6) % 7)); let w = weeks.get(start); if (!w) weeks.set(start, w = []); w.push(r); }
  return [...weeks].map(([start, rows]) => ({ start, rows }));
}

const newestFirst = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at);
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
