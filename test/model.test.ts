import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, type FeedRow } from '../src/model.ts';
import { emptyDb, own, ext, item, commit, days, settings, NOW, OWNER } from './support/build-db.ts';

const LA = { ACTIVITY_TIMEZONE: 'America/Los_Angeles' };
const rows = (m: ReturnType<typeof buildModel>) => m.feed.weeks.flatMap(w => w.rows);
const label = (r: FeedRow) => r.group ? `${r.kind}×${r.items.length} ${r.repo}` : `${r.kind} ${r.repo}`;

test('same-day items of one kind in one repo become a group: commits from 2, others from 3', () => {
  const db = emptyDb(); own(db, 'tool');
  commit(db, `${OWNER}/tool`, '2026-11-20T10:00:00Z'); commit(db, `${OWNER}/tool`, '2026-11-20T11:00:00Z');
  commit(db, `${OWNER}/tool`, '2026-11-19T11:00:00Z');
  item(db, 'issue', 'a/b', '2026-11-20T10:30:00Z'); item(db, 'issue', 'a/b', '2026-11-20T09:00:00Z');
  for (const h of [10, 11, 12]) item(db, 'pr', 'a/b', `2026-11-18T${h}:00:00Z`);
  const m = buildModel(db, settings(), NOW);
  assert.deepEqual(rows(m).map(label), [`commit×2 ${OWNER}/tool`, 'issue a/b', 'issue a/b', `commit ${OWNER}/tool`, 'pr×3 a/b']);
  const g = rows(m)[0];
  assert.ok(g.group && g.at === '2026-11-20T11:00:00Z', 'a group sits at its newest item');
});

test("days are the owner's: items either side of UTC midnight group by the owner's day", () => {
  const db = emptyDb(); own(db, 'tool');
  // 15:00 and 23:30 on Nov 19 in Los Angeles, though the second is already Nov 20 in UTC
  commit(db, `${OWNER}/tool`, '2026-11-19T23:00:00Z'); commit(db, `${OWNER}/tool`, '2026-11-20T07:30:00Z');
  assert.deepEqual(rows(buildModel(db, settings(LA), NOW)).map(label), [`commit×2 ${OWNER}/tool`]);
  assert.deepEqual(rows(buildModel(db, settings(), NOW)).map(label), [`commit ${OWNER}/tool`, `commit ${OWNER}/tool`], 'in UTC they are different days');
});

test("weeks start on Monday, in the owner's time zone", () => {
  const db = emptyDb();
  item(db, 'issue', 'a/b', '2026-11-23T05:00:00Z');   // Mon Nov 23 in UTC, still Sun Nov 22 in Los Angeles
  item(db, 'issue', 'a/b', '2026-11-24T20:00:00Z');   // Tue
  assert.deepEqual(buildModel(db, settings(), NOW).feed.weeks.map(w => w.start), ['2026-11-23']);
  assert.deepEqual(buildModel(db, settings(LA), NOW).feed.weeks.map(w => w.start), ['2026-11-23', '2026-11-16']);
});

test('comments are left out of the feed unless ACTIVITY_FEED_COMMENTS is on', () => {
  const db = emptyDb();
  item(db, 'issue_comment', 'a/b', '2026-11-20T10:00:00Z'); item(db, 'commit_comment', 'a/b', '2026-11-19T10:00:00Z'); item(db, 'issue', 'a/b', '2026-11-18T10:00:00Z');
  assert.deepEqual(rows(buildModel(db, settings(), NOW)).map(r => r.kind), ['issue']);
  assert.deepEqual(rows(buildModel(db, settings({ ACTIVITY_FEED_COMMENTS: 'true' }), NOW)).map(r => r.kind), ['issue_comment', 'commit_comment', 'issue']);
});

test('the feed holds the last 12 months; older items go to year sections, newest year first', () => {
  const db = emptyDb();
  item(db, 'issue', 'a/b', '2026-03-01T10:00:00Z'); item(db, 'pr', 'a/b', '2025-06-01T10:00:00Z'); item(db, 'issue', 'c/d', '2023-02-01T10:00:00Z');
  db.prepare(`INSERT INTO year_totals (source, year, contributions, commits, issues, prs, reviews, restricted) VALUES ('github', 2025, 99, 0, 0, 1, 0, 0)`).run();
  days(db, ['2025-06-01', 3], ['2024-12-31', 1]);
  const m = buildModel(db, settings(), NOW);
  assert.deepEqual(rows(m).map(label), ['issue a/b']);
  assert.deepEqual(m.years.map(y => y.year), [2025, 2023]);
  const y2025 = m.years[0];
  assert.equal(y2025.totals.contributions, 99);
  assert.equal(y2025.totals.prs, 1);
  assert.deepEqual(y2025.mostActive, [{ repo: 'a/b', count: 1 }]);
  assert.deepEqual(y2025.calendar, [{ date: '2025-06-01', count: 3 }]);
  assert.deepEqual(y2025.weeks.flatMap(w => w.rows).map(label), ['pr a/b']);
});

test("a fork's commits count on its upstream's row; an adopted fork (3+ PRs or issues inside) is the owner's project", () => {
  const db = emptyDb();
  own(db, 'helper', { fork: true, parent: 'big/upstream' });
  own(db, 'mine-now', { fork: true, parent: 'small/original' });
  own(db, 'orphan', { fork: true, parent: null });
  own(db, 'idle', { fork: true, parent: 'quiet/thing' });
  ext(db, 'big/upstream'); ext(db, 'small/original');
  commit(db, `${OWNER}/helper`, '2026-10-01T10:00:00Z'); item(db, 'pr', 'big/upstream', '2026-10-02T10:00:00Z');
  for (const d of ['01', '02', '03']) item(db, 'pr', `${OWNER}/mine-now`, `2026-09-${d}T10:00:00Z`);
  commit(db, `${OWNER}/mine-now`, '2026-09-04T10:00:00Z');
  item(db, 'issue', 'small/original', '2026-09-05T10:00:00Z');
  const m = buildModel(db, settings(), NOW);

  const upstream = m.contributing.rows.find(r => r.repo === 'big/upstream')!;
  assert.deepEqual(upstream.counts, { commits: 1, prs: 1, issues: 0, discussions: 0 });
  assert.deepEqual(upstream.forks, [`${OWNER}/helper`]);
  assert.ok(!m.projects.mine.some(r => r.repo === `${OWNER}/helper`), 'a contribution fork is not its own project');

  const adopted = m.projects.mine.find(r => r.repo === `${OWNER}/mine-now`)!;
  assert.equal(adopted.forkOf, 'small/original');
  assert.deepEqual(adopted.counts, { commits: 1, prs: 3, issues: 0, discussions: 0 });
  const original = m.contributing.rows.find(r => r.repo === 'small/original')!;
  assert.deepEqual(original.counts, { commits: 0, prs: 0, issues: 1, discussions: 0 }, 'work sent upstream still counts upstream');

  const orphan = m.projects.mine.find(r => r.repo === `${OWNER}/orphan`)!;
  assert.equal(orphan.upstreamDeleted, true);
  assert.equal(m.projects.idleForks, 1, 'the idle fork is counted, not listed');
});

test('favorites come first in the order given, and appear only once', () => {
  const db = emptyDb(); own(db, 'a'); own(db, 'b'); own(db, 'c'); ext(db, 'x/y');
  const m = buildModel(db, settings({ ACTIVITY_FAVORITES: `x/y,${OWNER}/b` }), NOW);
  assert.deepEqual(m.projects.favorites.map(r => r.repo), ['x/y', `${OWNER}/b`]);
  assert.ok(!m.projects.mine.some(r => r.repo === `${OWNER}/b`));
  assert.ok(!m.contributing.rows.some(r => r.repo === 'x/y'), 'a favorite with no work in it is not a contribution');
  assert.deepEqual(buildModel(db, settings(), NOW).projects.favorites, []);
  const unknown = buildModel(db, settings({ ACTIVITY_FAVORITES: `no/such-repo,${OWNER}/a` }), NOW).projects;
  assert.deepEqual(unknown.favorites.map(r => r.repo), [`${OWNER}/a`], 'a favorite that is not a known public repo is left out');
  assert.equal(unknown.skippedFavorites, 1);
});

test('Contributing to: external repos newest first, with breadth numbers and repos per year', () => {
  const db = emptyDb(); own(db, 'tool');
  item(db, 'issue', 'org1/a', '2024-05-01T10:00:00Z'); item(db, 'pr', 'org1/b', '2026-11-01T10:00:00Z');
  item(db, 'discussion_reply', 'org2/c', '2026-06-01T10:00:00Z'); item(db, 'pr', `${OWNER}/tool`, '2026-11-02T10:00:00Z');
  item(db, 'issue_comment', 'org3/only-commented', '2026-11-03T10:00:00Z');
  const c = buildModel(db, settings(), NOW).contributing;
  assert.deepEqual(c.rows.map(r => r.repo), ['org1/b', 'org2/c', 'org1/a']);
  assert.deepEqual({ repos: c.repos, owners: c.owners, firstYear: c.firstYear }, { repos: 3, owners: 2, firstYear: 2024 });
  assert.deepEqual(c.perYear, [{ year: 2024, repos: 1 }, { year: 2025, repos: 0 }, { year: 2026, repos: 2 }]);
  assert.equal(c.rows.find(r => r.repo === 'org2/c')!.counts.discussions, 1, 'discussion replies count as discussions');
});

test('Projects rows carry commits per month for the last 24 months', () => {
  const db = emptyDb(); own(db, 'tool');
  commit(db, `${OWNER}/tool`, '2026-11-01T10:00:00Z'); commit(db, `${OWNER}/tool`, '2026-11-02T10:00:00Z'); commit(db, `${OWNER}/tool`, '2025-12-15T10:00:00Z'); commit(db, `${OWNER}/tool`, '2020-01-01T10:00:00Z');
  const row = buildModel(db, settings(), NOW).projects.mine[0];
  assert.equal(row.monthly.length, 24);
  assert.equal(row.monthly[23], 2, 'this month is last');
  assert.equal(row.monthly[12], 1, 'Dec 2025 is 11 months back');
  assert.equal(row.monthly.reduce((a, b) => a + b, 0), 3, 'older commits are outside the window');
});

test('stats: all-time counts, the last 12 months, active days, and the private count', () => {
  const db = emptyDb(); own(db, 'tool');
  commit(db, `${OWNER}/tool`, '2026-11-01T10:00:00Z'); commit(db, `${OWNER}/tool`, '2019-11-01T10:00:00Z');
  item(db, 'pr', 'a/b', '2026-11-01T10:00:00Z'); item(db, 'issue', 'a/b', '2020-11-01T10:00:00Z'); item(db, 'discussion', 'a/b', '2021-11-01T10:00:00Z'); item(db, 'new_repo', `${OWNER}/tool`, '2020-01-01T10:00:00Z');
  // active days: days in the last 12 months with any contribution
  days(db, ['2026-11-10', 1], ['2026-11-11', 2], ['2026-11-12', 1], ['2026-11-13', 0], ['2026-11-23', 4], ['2026-11-24', 1], ['2026-11-25', 0]);
  const s = buildModel(db, settings(), NOW).stats;
  assert.deepEqual(s.allTime, { commits: 2, prs: 1, issues: 1, discussions: 1, reposCreated: 1 });
  assert.deepEqual(s.last12, { contributions: 321, activeDays: 5 });
  assert.ok(!('privateLast12' in s), 'the anonymous private count is not shown');
});

test('overview: licenses of own repos that are not forks, and languages weighted by commits (top 6, then Other)', () => {
  const db = emptyDb();
  own(db, 'a', { license: 'MIT', language: 'Go' }); own(db, 'b', { license: 'MIT' }); own(db, 'c', { license: 'GPL-3.0' }); own(db, 'd'); own(db, 'f', { fork: true, parent: 'x/y', license: 'Apache-2.0' });
  const langs = ['Go', 'Rust', 'C', 'Zig', 'Lua', 'Nim', 'Elm', 'Odin'];
  langs.forEach((l, i) => { ext(db, `e/${l}`, { language: l }); for (let k = 0; k <= 8 - i; k++) commit(db, `e/${l}`, `2026-0${1 + (k % 9)}-01T10:00:00Z`); });
  const o = buildModel(db, settings(), NOW).overview;
  assert.deepEqual(o.licenses, [{ name: 'MIT', count: 2 }, { name: 'GPL-3.0', count: 1 }]);
  assert.deepEqual(o.languages.map(l => l.name), ['Go', 'Rust', 'C', 'Zig', 'Lua', 'Nim', 'Other']);
  assert.equal(o.languages.at(-1)!.commits, 3 + 2, 'Elm and Odin fold into Other');
  assert.equal(Math.round(o.languages.reduce((s, l) => s + l.share, 0) * 100), 100);
});

test('profile, heatmap and chip counts', () => {
  const db = emptyDb();
  db.prepare(`INSERT INTO orgs (source, login) VALUES ('github', 'tidy-org')`).run();
  days(db, ['2025-11-25', 9], ['2025-11-26', 1], ['2026-11-25', 2]);
  item(db, 'issue', 'a/b', '2026-11-01T10:00:00Z'); item(db, 'issue', 'a/b', '2010-11-01T10:00:00Z');
  const m = buildModel(db, settings(), NOW);
  assert.deepEqual(m.profile, { login: OWNER, bio: 'Builds small tools', location: 'Lisbon', company: null, yearsActive: 16, orgs: ['tidy-org'], achievementsUrl: `https://github.com/${OWNER}?tab=achievements` });
  assert.deepEqual(m.heatmap.map(d => d.date), ['2025-11-26', '2026-11-25'], 'the last 12 months only');
  assert.equal(m.kindCounts.issue, 2, 'chips count every year');
});

test("habits: the owner's busiest weekdays and hours over the last 12 months, in their time zone", () => {
  const db = emptyDb(); own(db, 'tool');
  commit(db, `${OWNER}/tool`, '2026-11-24T05:30:00Z');   // Monday 21:30 in Los Angeles, Tuesday 05:30 in UTC
  item(db, 'issue', 'a/b', '2026-11-24T06:10:00Z');      // Monday 22:10 in Los Angeles
  item(db, 'issue', 'a/b', '2020-11-24T06:10:00Z');      // too old to count
  const h = buildModel(db, settings(LA), NOW).habits;
  assert.deepEqual(h.weekdays, [2, 0, 0, 0, 0, 0, 0]);
  assert.equal(h.hours[21], 1); assert.equal(h.hours[22], 1);
  assert.deepEqual(buildModel(db, settings(), NOW).habits.weekdays, [0, 2, 0, 0, 0, 0, 0]);
});

test('years active count from the earliest dated work, even from before the account existed', () => {
  const db = emptyDb(); own(db, 'old');   // the account was created in 2015
  commit(db, `${OWNER}/old`, '2009-06-01T10:00:00Z');   // history imported from before then
  item(db, 'issue', 'a/b', '2020-01-01T10:00:00Z');
  assert.equal(buildModel(db, settings(), NOW).profile.yearsActive, 17, 'Jun 2009 to Nov 2026 is 17 whole years');
  assert.equal(buildModel(emptyDb(), settings(), NOW).profile.yearsActive, 0, 'no work yet');
});

test('repo lists are ordered by Top: a lot of work, weighted towards recent (each item halves in weight every year)', () => {
  const db = emptyDb(); own(db, 'busy-last-year'); own(db, 'touched-today'); own(db, 'huge-but-ancient');
  for (let i = 0; i < 40; i++) commit(db, `${OWNER}/busy-last-year`, `2025-12-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`);
  commit(db, `${OWNER}/touched-today`, '2026-11-25T10:00:00Z');
  for (let i = 0; i < 200; i++) commit(db, `${OWNER}/huge-but-ancient`, `2014-03-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`);
  const mine = buildModel(db, settings(), NOW).projects.mine;
  assert.deepEqual(mine.map(r => r.repo.split('/')[1]), ['busy-last-year', 'touched-today', 'huge-but-ancient']);
  const [busy, today, ancient] = mine;
  assert.equal(busy.total, 40);
  assert.ok(busy.score > 18 && busy.score < 24, `40 commits about a year old count about half each (${busy.score})`);
  assert.ok(today.score > 0.99 && today.score <= 1, `today's commit counts fully (${today.score})`);
  assert.ok(ancient.score < 0.1, `200 commits from 12 years ago count for almost nothing (${ancient.score})`);
});

test('Contributing to is ordered by Top too', () => {
  const db = emptyDb();
  item(db, 'pr', 'one/drive-by', '2026-11-20T10:00:00Z');
  for (let i = 1; i <= 9; i++) item(db, 'issue', 'regular/project', `2026-0${i}-10T10:00:00Z`);
  assert.deepEqual(buildModel(db, settings(), NOW).contributing.rows.map(r => r.repo), ['regular/project', 'one/drive-by']);
});
