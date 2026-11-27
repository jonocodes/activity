import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/model.ts';
import { renderSite } from '../src/render/site.ts';
import { emptyDb, own, ext, item, commit, days, settings, NOW, OWNER } from './support/build-db.ts';

function site(env: Record<string, string> = {}) {
  const db = emptyDb();
  own(db, 'tool', { licence: 'MIT', language: 'TypeScript', description: 'A small "tool" & more' });
  ext(db, 'big/upstream', { stars: 1200, licence: 'Apache-2.0' });
  commit(db, `${OWNER}/tool`, '2026-11-20T07:30:00Z', 'Fix <script>alert(1)</script> in "titles"');
  commit(db, `${OWNER}/tool`, '2026-11-20T06:30:00Z');
  item(db, 'pr', 'big/upstream', '2026-11-24T18:00:00Z', 'Speed up the <b>parser</b>');
  item(db, 'issue', 'big/upstream', '2023-04-01T10:00:00Z', 'Old issue');
  item(db, 'issue', 'big/upstream', '2021-04-01T10:00:00Z', 'Older issue');
  days(db, ['2026-11-20', 2], ['2026-11-24', 1], ['2023-04-01', 1]);
  return renderSite(buildModel(db, settings({ ACTIVITY_TIMEZONE: 'America/Los_Angeles', ...env }), NOW));
}

test('the site is a main page, one page per older year, shared assets and a summary', () => {
  const files = site();
  assert.deepEqual(Object.keys(files).sort(), ['2021/index.html', '2023/index.html', 'index.html', 'site.css', 'site.js', 'summary.json']);
  assert.deepEqual(JSON.parse(files['summary.json']), { owner: OWNER, builtAt: NOW.toISOString(), kinds: { commit: 2, pr: 1, issue: 2 }, items: 5 });
});

test('text from GitHub is escaped everywhere', () => {
  const html = site()['index.html'];
  assert.ok(!html.includes('<script>alert'), 'no raw script from a commit message');
  assert.ok(!html.includes('<b>parser</b>'), 'no raw markup from a title');
  assert.ok(html.includes('&lt;b&gt;parser&lt;/b&gt;'));
  assert.ok(html.includes('A small &quot;tool&quot; &amp; more'));
});

test("dates are plain, in the owner's time zone, inside <time> for the browser to turn into ages", () => {
  const html = site()['index.html'];
  // 06:30 and 07:30 UTC on Nov 20 are late on Nov 19 in Los Angeles: one group, dated Nov 19
  assert.match(html, /<time datetime="2026-11-20T07:30:00Z">Nov 19<\/time>/);
  assert.match(html, /2 commits/);
  assert.ok(!/today|yesterday/i.test(html));
  assert.match(html, /Dates are in America\/Los_Angeles/);
  assert.match(html, /<p class="profile"><span>\d+ years of open source<\/span><span><a href="https:\/\/github.com\/fixture-owner\?tab=achievements">achievements<\/a><\/span><\/p>/, 'the profile line is only the years and achievements');
  assert.match(html, /active days, last 12 months/);
  assert.ok(!/streak|on GitHub since|first contribution|private/i.test(html), 'no streaks, account date, first-year box or private count');
});

test('older years are links to their own pages, which load in place with JavaScript', () => {
  const files = site();
  assert.match(files['index.html'], /<details class="year"><summary>2023 .*<a href="2023\/">Open 2023<\/a>/);
  const y = files['2023/index.html'];
  assert.match(y, /<h1>2023<\/h1>/);
  assert.match(y, /<div id="year-body">[\s\S]*Old issue/);
  assert.match(y, /<a href="..\/">← fixture-owner on GitHub<\/a> · <a href="..\/2021\/">2021<\/a>/, 'links home and to the neighbouring year');
  assert.match(y, /href="..\/site.css"/);
  assert.ok(!files['index.html'].includes('Old issue'), 'older items are not on the main page');
});

test('ACTIVITY_SECTIONS leaves parts of the page out', () => {
  const html = site({ ACTIVITY_SECTIONS: 'feed' })['index.html'];
  assert.ok(html.includes('id="feed"'));
  for (const gone of ['id="projects"', 'id="contributing"', 'class="stats"', 'class="overview"', 'nav class="tabs"', 'class="profile"', 'class="heat"']) assert.ok(!html.includes(gone), gone);
  assert.ok(site({ ACTIVITY_SECTIONS: 'feed,habits' })['index.html'].includes('class="habits"'));
});

test('repo rows carry what the sort toggle needs; the lists are sortable, favorites are not', () => {
  const html = site({ ACTIVITY_FAVORITES: 'big/upstream' })['index.html'];
  assert.match(html, /<div class="proj" data-filter="fixture-owner\/tool" data-score="[\d.]+" data-last="2026-11-20T07:30:00Z" data-total="2">/);
  assert.equal((html.match(/<div class="repos" data-sortable>/g) ?? []).length, 2, 'My projects and Contributing to');
  assert.ok(!/<h2>Favorites<\/h2>\s*<div class="repos" data-sortable>/.test(html), 'favorites keep the owner\'s order');
});

test('the heatmap is labelled: heading, months, weekdays, a key, and readable tooltips', () => {
  const files = site(), html = files['index.html'];
  assert.match(html, /<h4>Contributions, last 12 months<\/h4>/);
  assert.match(html, />Nov<\/text>/, 'month names along the top');
  for (const d of ['Mon', 'Wed', 'Fri']) assert.match(html, new RegExp(`>${d}</text>`), `${d} down the side`);
  assert.match(html, /<div class="legend">less .*more<\/div>/, 'a key from less to more');
  assert.match(html, /data-tip="Fri, Nov 20, 2026: 2 contributions"/);
  assert.match(html, /data-tip="Tue, Nov 24, 2026: 1 contribution"/, 'singular for one');
  assert.match(files['2023/index.html'], /<h4>Contributions in 2023<\/h4>/, 'year pages too');
});

test('the main page (snapshot)', (t) => {
  t.assert.snapshot(site()['index.html']);
});
