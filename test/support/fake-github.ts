// A small fake of the GitHub APIs the collector uses, serving a fictional account ("the world").
// Hand-written edge cases go here; real recorded responses are replayed separately.
import type { HttpRequest, HttpResponse, Transport } from '../../src/github/client.ts';

export interface SearchCommit { sha: string; html_url: string; commit: { author: { date: string }; message: string }; repository: { full_name: string; private: boolean; fork: boolean; owner: { login: string } } }
export interface World {
  login: string; id: string; createdAt: string; bio: string | null; location: string | null; company: string | null;
  years: number[]; last12: { contributions: number; restricted: number };
  orgs: string[];
  repos: any[];                                   // own repos, GraphQL shape
  items: Record<string, any[]>;                   // connection name -> nodes
  yearTotals: Record<number, { commits: number; issues: number; prs: number; reviews: number; restricted: number; days: [string, number][] }>;
  reviews: Record<number, any[]>; repoContributions: Record<number, any[]>;
  history: Record<string, any[]>;                 // own repo -> commit nodes
  search: SearchCommit[];
  /** true: every search is incomplete; a function: decide per query (from, to, page). */
  searchIncomplete?: boolean | ((from: string, to: string, page: number) => boolean);
  external: Record<string, any | null>;           // external repo details; null = deleted
}

const page = <T>(nodes: T[], after: string | null | undefined) => {
  const start = after ? Number(after) : 0, slice = nodes.slice(start, start + 100);
  return { pageInfo: { hasNextPage: start + 100 < nodes.length, endCursor: String(start + 100) }, nodes: slice };
};
const json = (body: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });

export function fakeGitHub(w: World, log: HttpRequest[] = []): Transport {
  return async (req) => {
    log.push(req);
    if (req.url.endsWith('/graphql')) return json(graphql(w, JSON.parse(req.body!)));
    const url = new URL(req.url);
    if (url.pathname === `/users/${w.login}/orgs`) return json(w.orgs.map(login => ({ login })));
    if (url.pathname === '/search/commits') return json(search(w, url));
    return json({ message: 'Not Found' }, 404);
  };
}

function graphql(w: World, { query, variables: v }: { query: string; variables: any }) {
  const op = /query\s+(\w+)/.exec(query)![1];
  const user = (body: any) => ({ data: { user: body } });
  switch (op) {
    case 'Profile': return user({ id: w.id, login: w.login, createdAt: w.createdAt, bio: w.bio, location: w.location, company: w.company,
      contributionsCollection: { contributionYears: w.years, restrictedContributionsCount: w.last12.restricted, contributionCalendar: { totalContributions: w.last12.contributions } } });
    case 'Repos': return user({ repositories: page(w.repos, v.after) });
    case 'YearTotals': {
      const y = Number(v.from.slice(0, 4)), t = w.yearTotals[y] ?? { commits: 0, issues: 0, prs: 0, reviews: 0, restricted: 0, days: [] };
      return user({ contributionsCollection: { totalCommitContributions: t.commits, totalIssueContributions: t.issues, totalPullRequestContributions: t.prs,
        totalPullRequestReviewContributions: t.reviews, restrictedContributionsCount: t.restricted,
        contributionCalendar: { totalContributions: t.days.reduce((s, d) => s + d[1], 0), weeks: [{ contributionDays: t.days.map(([date, contributionCount]) => ({ date, contributionCount })) }] } } });
    }
    case 'YearReviews': return user({ contributionsCollection: { pullRequestReviewContributions: page(w.reviews[Number(v.from.slice(0, 4))] ?? [], v.after) } });
    case 'YearRepos': return user({ contributionsCollection: { repositoryContributions: page(w.repoContributions[Number(v.from.slice(0, 4))] ?? [], v.after) } });
    case 'History': {
      const nodes = (w.history[`${v.owner}/${v.name}`] ?? []).filter(c => !v.since || c.authoredDate >= v.since);
      return { data: { repository: { defaultBranchRef: { target: { history: page(nodes, v.after) } } } } };
    }
    case 'RepoDetails': {
      const data: Record<string, any> = {}, errors: any[] = [];
      for (const [, alias, owner, name] of query.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)) {
        const d = w.external[`${owner}/${name}`];
        data[alias] = d ?? null;
        if (!d) errors.push({ type: 'NOT_FOUND', path: [alias], message: `Could not resolve to a Repository with the name '${owner}/${name}'.` });
      }
      return errors.length ? { data, errors } : { data };
    }
    default: {
      const conn = CONNECTIONS[op];
      if (conn) return user({ [conn]: page(w.items[conn] ?? [], v.after) });
      return { errors: [{ type: 'UNKNOWN_OPERATION', message: op }] };
    }
  }
}
const CONNECTIONS: Record<string, string> = { Issues: 'issues', PullRequests: 'pullRequests', IssueComments: 'issueComments', CommitComments: 'commitComments', Discussions: 'repositoryDiscussions', DiscussionReplies: 'repositoryDiscussionComments' };

function search(w: World, url: URL) {
  const q = url.searchParams.get('q')!, [, from, to] = /author-date:(\S+)\.\.(\S+)/.exec(q)!;
  const hits = w.search.filter(c => { const d = c.commit.author.date.slice(0, 10); return d >= from && d <= to; });
  const p = Number(url.searchParams.get('page') ?? 1), per = Number(url.searchParams.get('per_page') ?? 30);
  if ((p - 1) * per >= 1000) throw new Error('fake: asked past the 1000-result cap');
  const incomplete = typeof w.searchIncomplete === 'function' ? w.searchIncomplete(from, to, p) : !!w.searchIncomplete;
  return { total_count: hits.length, incomplete_results: incomplete, items: hits.slice((p - 1) * per, p * per) };
}

// ---------- building blocks for worlds ----------
export const repo = (nameWithOwner: string, extra: Record<string, unknown> = {}) => ({
  nameWithOwner, owner: { login: nameWithOwner.split('/')[0] }, isPrivate: false, isFork: false, isArchived: false, description: null, stargazerCount: 0,
  licenseInfo: null, primaryLanguage: null, parent: null, createdAt: '2020-01-01T00:00:00Z', pushedAt: '2026-11-01T00:00:00Z', ...extra });
export const ref = (nameWithOwner: string, isPrivate = false) => ({ nameWithOwner, isPrivate });
export const commitNode = (oid: string, authoredDate: string, message = `commit ${oid}`) => ({ oid, authoredDate, messageHeadline: message, additions: 1, deletions: 0, url: `https://github.com/x/commit/${oid}` });
export const searchHit = (sha: string, fullName: string, date: string, extra: { private?: boolean; fork?: boolean; message?: string } = {}): SearchCommit => ({
  sha, html_url: `https://github.com/${fullName}/commit/${sha}`, commit: { author: { date }, message: extra.message ?? `commit ${sha}\n\nbody` },
  repository: { full_name: fullName, private: !!extra.private, fork: !!extra.fork, owner: { login: fullName.split('/')[0] } } });
