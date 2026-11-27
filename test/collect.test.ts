import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, type Database } from '../src/db.ts';
import { createClient, CollectError, type HttpRequest } from '../src/github/client.ts';
import { collectGitHub } from '../src/github/collect.ts';
import { fakeGitHub, repo, ref, commitNode, searchHit, type World } from './support/fake-github.ts';

const OWNER = 'fixture-owner';
const CANARY = 'CANARY-PRIVATE';

// The fictional account. Each test can change a copy of it.
function world(): World {
  return {
    login: OWNER, id: 'U_1', createdAt: '2015-03-01T10:00:00Z', bio: 'Builds small tools', location: 'Lisbon', company: null,
    years: [2026, 2025, 2024], last12: { contributions: 321, restricted: 12 },
    orgs: ['tidy-org'],
    repos: [
      repo(`${OWNER}/tool`, { licenseInfo: { spdxId: 'MIT' }, primaryLanguage: { name: 'TypeScript' }, stargazerCount: 7 }),
      repo(`${OWNER}/upstream`, { isFork: true, parent: { nameWithOwner: 'big/upstream' }, createdAt: '2025-06-01T00:00:00Z' }),
      repo(`${OWNER}/${CANARY}-repo`, { isPrivate: true, description: `${CANARY} description` }),
    ],
    items: {
      issues: [
        { id: 'I_1', createdAt: '2026-01-02T03:04:05Z', title: 'Crash on start', url: 'https://github.com/big/upstream/issues/1', state: 'OPEN', repository: ref('big/upstream') },
        { id: 'I_2', createdAt: '2026-01-03T03:04:05Z', title: `${CANARY} issue`, url: `https://github.com/acme/${CANARY}/issues/1`, state: 'OPEN', repository: ref(`acme/${CANARY}`, true) },
      ],
      pullRequests: [{ id: 'P_1', createdAt: '2026-02-02T03:04:05Z', title: 'Add a flag', url: 'https://github.com/fixture-owner/tool/pull/1', state: 'MERGED', mergedAt: '2026-02-03T03:04:05Z', repository: ref(`${OWNER}/tool`) }],
      issueComments: [{ id: 'IC_1', createdAt: '2026-01-04T03:04:05Z', url: 'https://github.com/big/upstream/issues/1#c', issue: { title: 'Crash on start' }, repository: ref('big/upstream') }],
      commitComments: [{ id: 'CC_1', createdAt: '2025-05-05T03:04:05Z', url: 'https://github.com/big/upstream/commit/c#c', commit: { oid: 'c0ffee1234' }, repository: ref('big/upstream') }],
      repositoryDiscussions: [{ id: 'D_1', createdAt: '2025-07-07T03:04:05Z', title: 'Roadmap?', url: 'https://github.com/big/upstream/discussions/1', repository: ref('big/upstream') }],
      repositoryDiscussionComments: [{ id: 'DC_1', createdAt: '2025-07-08T03:04:05Z', url: 'https://github.com/big/upstream/discussions/1#c', discussion: { title: 'Roadmap?', repository: ref('big/upstream') } }],
    },
    yearTotals: {
      2026: { commits: 3, issues: 2, prs: 1, reviews: 1, restricted: 5, days: [['2026-01-02', 2], ['2026-01-03', 0]] },
      2025: { commits: 4, issues: 0, prs: 0, reviews: 0, restricted: 0, days: [['2025-07-07', 1]] },
    },
    reviews: { 2026: [{ occurredAt: '2026-03-03T03:03:03Z', pullRequestReview: { id: 'R_1', url: 'https://github.com/big/upstream/pull/9#r' }, pullRequest: { title: 'Speed up', url: 'https://github.com/big/upstream/pull/9', repository: ref('big/upstream') } }] },
    repoContributions: { 2025: [
      { occurredAt: '2025-06-01T00:00:00Z', repository: { id: 'RP_2', nameWithOwner: `${OWNER}/upstream`, isPrivate: false, isFork: true, url: 'https://github.com/fixture-owner/upstream' } },
      { occurredAt: '2025-06-02T00:00:00Z', repository: { id: 'RP_3', nameWithOwner: `${OWNER}/${CANARY}-repo`, isPrivate: true, isFork: false, url: 'https://github.com/x' } },
    ] },
    history: {
      [`${OWNER}/tool`]: [commitNode('t1', '2026-02-01T10:00:00Z'), commitNode('t2', '2026-02-02T10:00:00Z')],
      // commits made in the fork: one later merged upstream (so search also finds it there), one only in the fork
      [`${OWNER}/upstream`]: [commitNode('shared', '2025-08-01T10:00:00Z'), commitNode('forkonly', '2025-08-02T10:00:00Z'), commitNode('before-fork', '2025-01-01T10:00:00Z')],
    },
    search: [
      searchHit('shared', 'big/upstream', '2025-08-01T03:00:00-07:00'),
      searchHit('shared', 'someone/upstream', '2025-08-01T03:00:00-07:00', { fork: true }),
      searchHit('ext1', 'other/lib', '2025-09-09T23:30:00-08:00', { message: 'Fix the thing\n\nlong body' }),
      searchHit('secret', `acme/${CANARY}`, '2025-09-10T10:00:00Z', { private: true, message: `${CANARY} commit` }),
    ],
    external: {
      'big/upstream': { nameWithOwner: 'big/upstream', isPrivate: false, description: 'The big one', stargazerCount: 5000, licenseInfo: { spdxId: 'Apache-2.0' }, primaryLanguage: { name: 'Go' } },
      'other/lib': null, // deleted since
      'someone/upstream': { nameWithOwner: 'someone/upstream', isPrivate: false, description: null, stargazerCount: 0, licenseInfo: null, primaryLanguage: null },
    },
  };
}

async function run(w: World) {
  const db = openDatabase(':memory:'), lines: string[] = [], requests: HttpRequest[] = [];
  const client = createClient({ transport: fakeGitHub(w, requests), token: 't', sleep: async () => {} });
  const result = await collectGitHub({ client, db, owner: w.login, now: new Date('2026-11-25T12:00:00Z'), log: l => lines.push(l), sleep: async () => {} });
  return { db, lines, requests, result };
}
const all = (db: Database, sql: string) => db.prepare(sql).all() as any[];
const dump = (db: Database) => ['profile', 'orgs', 'repos', 'items', 'commits', 'calendar', 'year_totals', 'meta', 'runs'].map(t => JSON.stringify(all(db, `SELECT * FROM ${t}`))).join('\n');

test('collects the profile, public orgs and own repos', async () => {
  const { db } = await run(world());
  assert.deepEqual({ ...all(db, 'SELECT login, created_at, bio, location, company FROM profile')[0] }, { login: OWNER, created_at: '2015-03-01T10:00:00Z', bio: 'Builds small tools', location: 'Lisbon', company: null });
  assert.deepEqual(all(db, 'SELECT login FROM orgs').map(r => r.login), ['tidy-org']);
  const own = all(db, 'SELECT name_with_owner, is_fork, parent, licence, language, stars FROM repos WHERE is_own = 1 ORDER BY name_with_owner');
  assert.deepEqual(own.map(r => [r.name_with_owner, r.is_fork, r.parent, r.licence, r.language, r.stars]), [
    [`${OWNER}/tool`, 0, null, 'MIT', 'TypeScript', 7],
    [`${OWNER}/upstream`, 1, 'big/upstream', null, null, 0],
  ]);
});

test('collects every kind of item', async () => {
  const { db } = await run(world());
  const kinds = all(db, 'SELECT kind, repo, title FROM items ORDER BY kind').map(r => `${r.kind} ${r.repo} ${r.title}`);
  assert.deepEqual(kinds, [
    'commit_comment big/upstream comment on c0ffee1',
    'discussion big/upstream Roadmap?',
    'discussion_reply big/upstream Roadmap?',
    'fork fixture-owner/upstream fixture-owner/upstream',
    'issue big/upstream Crash on start',
    'issue_comment big/upstream Crash on start',
    'pr fixture-owner/tool Add a flag',
    'review big/upstream Speed up',
  ]);
  assert.equal(all(db, `SELECT merged_at FROM items WHERE kind = 'pr'`)[0].merged_at, '2026-02-03T03:04:05Z');
});

test('collects the calendar, year totals and the last 12 months', async () => {
  const { db } = await run(world());
  assert.deepEqual(all(db, 'SELECT date, total FROM calendar ORDER BY date').map(r => [r.date, r.total]), [['2025-07-07', 1], ['2026-01-02', 2], ['2026-01-03', 0]]);
  assert.deepEqual({ ...all(db, 'SELECT * FROM year_totals WHERE year = 2026')[0] }, { source: 'github', year: 2026, contributions: 2, commits: 3, issues: 2, prs: 1, reviews: 1, restricted: 5 });
  const meta = Object.fromEntries(all(db, 'SELECT key, value FROM meta').map(r => [r.key, r.value]));
  assert.equal(meta.owner, OWNER);
  assert.equal(meta.contributions_last_12_months, '321');
  assert.equal(meta.restricted_last_12_months, '12');
});

test('counts each commit once, preferring the repo that is not a fork', async () => {
  const { db } = await run(world());
  const commits = Object.fromEntries(all(db, 'SELECT sha, repo FROM commits').map(r => [r.sha, r.repo]));
  assert.equal(commits.shared, 'big/upstream', 'merged upstream: credited there, not to either fork');
  assert.equal(commits.forkonly, `${OWNER}/upstream`, 'only in the fork: stays with the fork');
  assert.equal(commits.t1, `${OWNER}/tool`);
  assert.equal(commits.ext1, 'other/lib');
});

test('walks a fork only from when it was forked', async () => {
  const { db, requests } = await run(world());
  assert.equal(all(db, `SELECT 1 FROM commits WHERE sha = 'before-fork'`).length, 0);
  const forkWalk = requests.map(r => r.body && JSON.parse(r.body)).find(b => b?.variables?.name === 'upstream');
  assert.equal(forkWalk.variables.since, '2025-06-01T00:00:00Z');
});

test('converts every timestamp to UTC and keeps only the first line of a commit message', async () => {
  const { db } = await run(world());
  assert.deepEqual({ ...all(db, `SELECT authored_at, message FROM commits WHERE sha = 'ext1'`)[0] }, { authored_at: '2025-09-10T07:30:00Z', message: 'Fix the thing' });
});

test('stores details of external repos and skips ones that no longer exist', async () => {
  const { db } = await run(world());
  const ext = all(db, 'SELECT name_with_owner, description, stars, licence, language FROM repos WHERE is_own = 0 ORDER BY name_with_owner');
  // other/lib was deleted; someone/upstream only held a commit that's counted under big/upstream, so it isn't on the page
  assert.deepEqual(ext.map(r => r.name_with_owner), ['big/upstream']);
  assert.deepEqual([ext[0].description, ext[0].stars, ext[0].licence, ext[0].language], ['The big one', 5000, 'Apache-2.0', 'Go']);
});

test('nothing private is collected or logged, and the log only counts what was dropped', async () => {
  const { db, lines } = await run(world());
  assert.ok(!dump(db).includes(CANARY), 'no private repo, item or commit in the database');
  assert.ok(!lines.join('\n').includes(CANARY), 'no private name in the log');
  assert.ok(!lines.join('\n').includes('Crash on start'), 'no item titles in the log');
  assert.match(lines.join('\n'), /dropped as private: 4/);
});

test('splits a commit search slice that hits the 1000-result cap', async () => {
  const w = world();
  for (let i = 0; i < 1500; i++) w.search.push(searchHit(`bulk${i}`, 'busy/repo', new Date(Date.UTC(2024, 0, 1) + i * 5 * 3600_000).toISOString()));
  w.external['busy/repo'] = { nameWithOwner: 'busy/repo', isPrivate: false, description: null, stargazerCount: 1, licenseInfo: null, primaryLanguage: null };
  const { db } = await run(w);
  assert.equal(all(db, `SELECT count(*) AS n FROM commits WHERE repo = 'busy/repo'`)[0].n, 1500);
});

test('a search that is briefly incomplete (GitHub timing out) is retried', async () => {
  const w = world(); let flaky = 2;
  w.searchIncomplete = () => flaky-- > 0;
  const { db } = await run(w);
  assert.equal(all(db, `SELECT count(*) AS n FROM commits WHERE sha = 'ext1'`)[0].n, 1);
});

test('a range that keeps timing out is split into smaller searches', async () => {
  const w = world();
  w.searchIncomplete = (from, to) => Date.parse(to) - Date.parse(from) > 60 * 86_400_000;   // only ranges over 60 days time out
  const { db } = await run(w);
  assert.equal(all(db, `SELECT count(*) AS n FROM commits WHERE sha = 'ext1'`)[0].n, 1, 'nothing lost');
});

test('a search still incomplete for a single day fails the run', async () => {
  const w = world(); w.searchIncomplete = true;
  await assert.rejects(run(w), (e: Error) => e instanceof CollectError && /incomplete/.test(e.message));
});

test('records the run', async () => {
  const { db, result } = await run(world());
  const r = all(db, 'SELECT * FROM runs')[0];
  assert.equal(r.items_dropped_private, 4);
  assert.equal(r.items_collected, result.items);
  assert.ok(r.api_calls > 10);
  assert.equal(r.finished_at, '2026-11-25T12:00:00Z');
});
