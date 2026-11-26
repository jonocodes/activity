// Replays real API responses recorded from the author's public account (`just record-fixtures`), so the collector is
// checked against what GitHub actually returns. Assertions read the owner from the recording, never a literal login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { openDatabase } from '../src/db.ts';
import { createClient } from '../src/github/client.ts';
import { collectGitHub } from '../src/github/collect.ts';
import { assertNoPrivate, loadRecording, replayTransport } from '../src/github/record.ts';

const PATH = 'test/fixtures/recorded/github.json.gz';
const skip = existsSync(PATH) ? false : 'no recording yet: run `just record-fixtures` with a public-only GH_PAT';

test('the recording holds nothing private', { skip }, () => {
  assertNoPrivate(loadRecording(PATH).exchanges);
});

test('the collector handles a real recorded account', { skip }, async () => {
  const rec = loadRecording(PATH);
  const db = openDatabase(':memory:'), lines: string[] = [];
  const client = createClient({ transport: replayTransport(rec), token: 'replay', sleep: async () => {} });
  const result = await collectGitHub({ client, db, owner: rec.owner, now: new Date(rec.recordedAt), log: l => lines.push(l) });
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  assert.equal(n(`SELECT count(*) AS n FROM profile WHERE login = '${rec.owner}'`), 1);
  assert.ok(result.ownRepos > 0 && result.items > 0 && result.commits > 0, JSON.stringify(result));
  assert.equal(result.droppedPrivate, 0, 'a public-only token sees nothing private');
  assert.equal(n('SELECT count(*) AS n FROM repos WHERE is_private = 1'), 0);
  assert.equal(n('SELECT count(DISTINCT sha) AS n FROM commits'), result.commits);
  assert.ok(n('SELECT count(*) AS n FROM calendar') > 300, 'a calendar day for most days');
  assert.ok(lines.some(l => /^API calls: \d+/.test(l)));
});
