// `just collect`: fetch the owner's public GitHub data into state.db.
// `just record-fixtures`: the same, also saving every API exchange as the recorded test fixture.
import { existsSync, rmSync } from 'node:fs';
import { openDatabase } from '../db.ts';
import { createClient, fetchTransport, CollectError } from '../github/client.ts';
import { collectGitHub } from '../github/collect.ts';
import { recordingTransport, saveRecording } from '../github/record.ts';
import { loadSettings, SettingsError } from '../settings.ts';

const RECORDING = 'test/fixtures/recorded/github.json.gz';
const record = process.argv.includes('--record');
const dbAt = process.argv.indexOf('--db');
const dbPath = dbAt > 0 ? process.argv[dbAt + 1] : 'state.db';

const token = process.env.GH_PAT;
let owner: string, favorites: string[];
try { ({ user: owner, favorites } = loadSettings(process.env)); }
catch (e) { if (e instanceof SettingsError) fail(e.problems.join('\n  ')); throw e; }
if (!token) fail('GH_PAT is not set: a fine-grained token with "Public repositories (read-only)" access and an expiry of a year or less (see the README)');

const recorder = record ? recordingTransport(fetchTransport) : null;
const client = createClient({ transport: recorder?.transport ?? fetchTransport, token: token! });
if (existsSync(dbPath)) rmSync(dbPath);   // v1 rebuilds the database on every run
const db = openDatabase(dbPath);
const now = new Date();
const started = Date.now();
try {
  await collectGitHub({ client, db, owner: owner!, now, log: line => console.log(`collect: ${line}`), alsoRepos: favorites! });
  console.log(`collect: wrote ${dbPath} in ${Math.round((Date.now() - started) / 1000)} s`);
  if (recorder) {
    saveRecording(RECORDING, { owner: owner!, recordedAt: now.toISOString(), exchanges: recorder.exchanges });
    console.log(`collect: recorded ${recorder.exchanges.length} API exchanges to ${RECORDING}`);
  }
} catch (e) {
  db.close();
  rmSync(dbPath, { force: true });
  fail(e instanceof CollectError ? e.message : String((e as Error).stack ?? e));
} finally { if (db.isOpen) db.close(); }

function fail(message: string): never {
  console.error(`collect failed: ${message}`);
  process.exit(1);
}
