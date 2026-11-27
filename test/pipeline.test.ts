// Whole-pipeline checks: collect (through a transport) -> database -> render model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { openDatabase } from '../src/db.ts';
import { createClient, type Transport } from '../src/github/client.ts';
import { collectGitHub } from '../src/github/collect.ts';
import { loadRecording, replayTransport } from '../src/github/record.ts';
import { buildModel, type Model } from '../src/model.ts';
import { renderSite } from '../src/render/site.ts';
import { loadSettings } from '../src/settings.ts';
import { fakeGitHub, repo, ref, commitNode, searchHit, type World } from './support/fake-github.ts';

async function pipeline(transport: Transport, owner: string, now: Date, env: Record<string, string> = {}) {
  const db = openDatabase(':memory:'), log: string[] = [];
  const settings = loadSettings({ ACTIVITY_USER: owner, ...env });
  await collectGitHub({ client: createClient({ transport, token: 't', sleep: async () => {} }), db, owner, now, log: l => log.push(l), alsoRepos: settings.favorites });
  const tables = ['profile', 'orgs', 'repos', 'items', 'commits', 'calendar', 'year_totals', 'meta', 'runs'].map(t => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())).join('\n');
  return { model: buildModel(db, settings, now), log: log.join('\n'), tables };
}

// ---------- privacy: canaries in every private place, end to end ----------
const C = 'CANARY-PRIVATE';
const privateWorld = (): World => ({
  login: 'fixture-owner', id: 'U_1', createdAt: '2015-03-01T10:00:00Z', bio: null, location: null, company: null,
  years: [2026], last12: { contributions: 10, restricted: 3 }, orgs: [],
  repos: [repo('fixture-owner/tool'), repo(`fixture-owner/${C}-repo`, { isPrivate: true, description: `${C} description`, primaryLanguage: { name: `${C}-lang` }, licenseInfo: { spdxId: `${C}-license` } })],
  items: {
    issues: [{ id: 'I1', createdAt: '2026-05-01T10:00:00Z', title: `${C} issue title`, url: `https://github.com/acme/${C}/issues/1`, state: 'OPEN', repository: ref(`acme/${C}`, true) },
      { id: 'I2', createdAt: '2026-05-02T10:00:00Z', title: 'public issue', url: 'https://github.com/a/b/issues/2', state: 'OPEN', repository: ref('a/b') }],
    pullRequests: [{ id: 'P1', createdAt: '2026-05-03T10:00:00Z', title: `${C} pr`, url: `https://github.com/acme/${C}/pull/1`, state: 'OPEN', mergedAt: null, repository: ref(`acme/${C}`, true) }],
    issueComments: [{ id: 'C1', createdAt: '2026-05-04T10:00:00Z', url: 'u', issue: { title: `${C} commented issue` }, repository: ref(`acme/${C}`, true) }],
    commitComments: [], repositoryDiscussions: [{ id: 'D1', createdAt: '2026-05-05T10:00:00Z', title: `${C} discussion`, url: 'u', repository: ref(`acme/${C}`, true) }],
    repositoryDiscussionComments: [{ id: 'DC1', createdAt: '2026-05-06T10:00:00Z', url: 'u', discussion: { title: `${C} thread`, repository: ref(`acme/${C}`, true) } }],
  },
  yearTotals: { 2026: { commits: 1, issues: 1, prs: 0, reviews: 0, restricted: 3, days: [['2026-05-02', 1]] } },
  reviews: { 2026: [{ occurredAt: '2026-05-07T10:00:00Z', pullRequestReview: { id: 'R1', url: 'u' }, pullRequest: { title: `${C} reviewed`, repository: ref(`acme/${C}`, true) } }] },
  repoContributions: { 2026: [{ occurredAt: '2026-05-08T10:00:00Z', repository: { id: 'X', nameWithOwner: `fixture-owner/${C}-repo`, isPrivate: true, isFork: false, url: 'u' } }] },
  history: { 'fixture-owner/tool': [commitNode('pub1', '2026-05-09T10:00:00Z')], [`fixture-owner/${C}-repo`]: [commitNode('priv1', '2026-05-09T11:00:00Z', `${C} commit message`)] },
  search: [searchHit('priv2', `acme/${C}`, '2026-05-10T10:00:00Z', { private: true, message: `${C} searched commit` })],
  external: { 'a/b': { nameWithOwner: 'a/b', isPrivate: false, description: null, stargazerCount: 0, licenseInfo: null, primaryLanguage: null },
    [`acme/${C}`]: { nameWithOwner: `acme/${C}`, isPrivate: true, description: `${C} external description`, stargazerCount: 0, licenseInfo: null, primaryLanguage: null } },
});

test('privacy: nothing private reaches the database, the render model, the site or the log', async () => {
  for (const env of [{}, { ACTIVITY_FEED_COMMENTS: 'true', ACTIVITY_FAVORITES: `acme/${C},fixture-owner/tool` }] as Record<string, string>[]) {
    const { model, log, tables } = await pipeline(fakeGitHub(privateWorld()), 'fixture-owner', new Date('2026-11-25T12:00:00Z'), env);
    const modelText = JSON.stringify(model);
    assert.ok(!tables.includes(C), 'database');
    assert.ok(!modelText.includes(C), 'render model');
    for (const [path, content] of Object.entries(renderSite(model))) assert.ok(!content.includes(C), `dist/${path}`);
    assert.ok(!log.includes(C), 'log');
    assert.match(log, /dropped as private: \d+/);
    assert.ok(model.stats.allTime.commits === 1 && model.stats.allTime.issues === 1, 'the public work is all still there');
    if (env.ACTIVITY_FAVORITES) assert.equal(model.projects.skippedFavorites, 1, 'a private favorite is skipped');
  }
});

// ---------- the real recorded account ----------
const PATH = 'test/fixtures/recorded/github.json.gz';
const skip = existsSync(PATH) ? false : 'no recording yet: run `just record-fixtures`';

test('the render model of the real recorded account is consistent', { skip }, async () => {
  const rec = loadRecording(PATH), now = new Date(rec.recordedAt);
  const { model: m } = await pipeline(replayTransport(rec), rec.owner, now);
  const rows = [...m.projects.favorites, ...m.projects.mine, ...m.contributing.rows];
  const sum = (k: keyof Model['contributing']['rows'][0]['counts']) => rows.reduce((s, r) => s + r.counts[k], 0);
  assert.equal(sum('commits'), m.stats.allTime.commits, 'every commit is counted in exactly one row');
  assert.equal(sum('prs'), m.stats.allTime.prs, 'every pull request is counted in exactly one row');
  assert.equal(new Set(rows.map(r => r.repo)).size, rows.length, 'no repo has two rows');
  assert.ok(m.contributing.repos > 0 && m.projects.mine.length > 0);
  const cutoff = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  assert.ok(m.feed.weeks.flatMap(w => w.rows).every(r => r.at >= cutoff), 'the feed holds the last 12 months');
  assert.deepEqual(m.years.map(y => y.year), [...m.years.map(y => y.year)].sort((a, b) => b - a));
  assert.ok(m.heatmap.length >= 360);
});
