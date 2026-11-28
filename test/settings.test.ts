import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, SettingsError, SECTIONS } from '../src/settings.ts';

const errorsOf = (env: Record<string, string>) => { try { loadSettings(env); return []; } catch (e) { assert.ok(e instanceof SettingsError); return e.problems; } };

test('every setting has a default; the owner defaults to the repo owner', () => {
  const s = loadSettings({ GITHUB_REPOSITORY_OWNER: 'octo' });
  assert.deepEqual(s, {
    user: 'octo', title: 'octo on GitHub', headline: null, timezone: 'UTC', favorites: [],
    sections: SECTIONS.filter(x => x !== 'habits'), feedComments: false, sourceRepo: null,
  });
});

test('settings come from ACTIVITY_* env vars', () => {
  const s = loadSettings({
    ACTIVITY_USER: 'someone', ACTIVITY_TITLE: 'My work', ACTIVITY_TIMEZONE: 'America/Los_Angeles',
    ACTIVITY_FAVORITES: 'someone/tool, other/lib', ACTIVITY_SECTIONS: 'stats,feed', ACTIVITY_FEED_COMMENTS: 'true',
  });
  assert.deepEqual(s, { user: 'someone', title: 'My work', headline: [[{ text: 'My work', accent: false }]], timezone: 'America/Los_Angeles', favorites: ['someone/tool', 'other/lib'], sections: ['stats', 'feed'], feedComments: true, sourceRepo: null });
});

test('the repo the page is built from comes from GITHUB_REPOSITORY, which Actions sets', () => {
  assert.equal(loadSettings({ ACTIVITY_USER: 'octo', GITHUB_REPOSITORY: 'octo/activity' }).sourceRepo, 'octo/activity');
  assert.deepEqual(errorsOf({ ACTIVITY_USER: 'octo', GITHUB_REPOSITORY: 'not a repo' }), ['GITHUB_REPOSITORY "not a repo" is not owner/repo']);
});

test('ACTIVITY_TITLE is a headline: *starred* words are accented, | breaks the line', () => {
  const s = loadSettings({ ACTIVITY_USER: 'octo', ACTIVITY_TITLE: '*A LOT* GOING ON | AT THE MOMENT' });
  assert.deepEqual(s.headline, [[{ text: 'A LOT', accent: true }, { text: ' GOING ON', accent: false }], [{ text: 'AT THE MOMENT', accent: false }]]);
  assert.equal(s.title, 'A LOT GOING ON AT THE MOMENT', 'the plain title for the browser tab');
  assert.match(errorsOf({ ACTIVITY_USER: 'octo', ACTIVITY_TITLE: '*A LOT GOING ON' })[0], /unmatched \*/);
});

test('in Actions, settings arrive as one JSON of all repo variables; a real env var wins', () => {
  const vars = JSON.stringify({ ACTIVITY_USER: 'from-vars', ACTIVITY_TIMEZONE: 'Europe/Lisbon', SOME_OTHER_VAR: 'ignored' });
  const s = loadSettings({ ACTIVITY_VARS: vars, ACTIVITY_TIMEZONE: 'Asia/Tokyo' });
  assert.equal(s.user, 'from-vars');
  assert.equal(s.timezone, 'Asia/Tokyo');
});

test('an unknown ACTIVITY_* name fails, so typos are noticed', () => {
  assert.deepEqual(errorsOf({ ACTIVITY_USER: 'x', ACTIVITY_TIMEZON: 'UTC' }), ['ACTIVITY_TIMEZON is not a setting (did you mean ACTIVITY_TIMEZONE?)']);
  assert.match(errorsOf({ ACTIVITY_USER: 'x', ACTIVITY_VARS: JSON.stringify({ ACTIVITY_FAVOURITES: 'a/b' }) })[0], /ACTIVITY_FAVOURITES is not a setting \(did you mean ACTIVITY_FAVORITES\?\)/);
});

test('bad values fail with every problem listed at once', () => {
  const problems = errorsOf({ ACTIVITY_TIMEZONE: 'Mars/Olympus', ACTIVITY_FAVORITES: 'just-a-name', ACTIVITY_SECTIONS: 'stats,sidebar', ACTIVITY_FEED_COMMENTS: 'maybe' });
  assert.deepEqual(problems, [
    'ACTIVITY_USER is not set, and there is no repo owner to default to',
    'ACTIVITY_TIMEZONE "Mars/Olympus" is not an IANA time zone (e.g. Europe/London)',
    'ACTIVITY_FAVORITES "just-a-name" is not owner/repo',
    `ACTIVITY_SECTIONS "sidebar" is not one of ${SECTIONS.join(', ')}`,
    'ACTIVITY_FEED_COMMENTS "maybe" is not true or false',
  ]);
});

test('ACTIVITY_VARS that is not JSON fails clearly', () => {
  assert.deepEqual(errorsOf({ ACTIVITY_USER: 'x', ACTIVITY_VARS: '{nope' }), ['ACTIVITY_VARS is not valid JSON']);
});
