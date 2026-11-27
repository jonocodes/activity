// `just render`: build dist/ from state.db (or, with --from-recording, from the recorded fixture: no token needed).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase, type Database } from '../db.ts';
import { createClient } from '../github/client.ts';
import { collectGitHub } from '../github/collect.ts';
import { loadRecording, replayTransport } from '../github/record.ts';
import { buildModel } from '../model.ts';
import { renderSite } from '../render/site.ts';
import { loadSettings, SettingsError } from '../settings.ts';

const RECORDING = 'test/fixtures/recorded/github.json.gz';
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

export async function render(o: { fromRecording?: boolean; db?: string; out?: string; log?: (l: string) => void } = {}) {
  const log = o.log ?? (l => console.log(`render: ${l}`));
  const out = o.out ?? 'dist';
  let db: Database, env = { ...process.env };
  if (o.fromRecording) {
    const rec = loadRecording(RECORDING);
    env.ACTIVITY_USER ||= rec.owner;
    db = openDatabase(':memory:');
    await collectGitHub({ client: createClient({ transport: replayTransport(rec), token: 'replay', sleep: async () => {} }), db, owner: rec.owner, now: new Date(rec.recordedAt), log: () => {} });
    log(`using the recorded fixture (${rec.owner}, recorded ${rec.recordedAt.slice(0, 10)})`);
  } else {
    const path = o.db ?? 'state.db';
    if (!existsSync(path)) throw new Error(`${path} doesn't exist: run \`just collect\` first, or render from the recording (\`just render --from-recording\`)`);
    db = openDatabase(path);
    env.ACTIVITY_USER ||= (db.prepare(`SELECT value FROM meta WHERE key = 'owner'`).get() as { value: string } | undefined)?.value;   // the data says whose it is
  }
  const settings = loadSettings(env);
  const collectedAt = (db.prepare(`SELECT value FROM meta WHERE key = 'collected_at'`).get() as { value: string } | undefined)?.value;
  const model = buildModel(db, settings, collectedAt ? new Date(collectedAt) : new Date());
  db.close();
  const files = renderSite(model);
  rmSync(out, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), content); }
  const kb = (s: string) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
  log(`wrote ${Object.keys(files).length} files to ${out}/: index.html ${kb(files['index.html'])}, ${model.years.length} year pages`);
  if (model.projects.skippedFavorites) log(`${model.projects.skippedFavorites} of ACTIVITY_FAVORITES left out: not a public repo GitHub knows about (check for typos)`);
  return { model, files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { await render({ fromRecording: process.argv.includes('--from-recording'), db: arg('--db'), out: arg('--out') }); }
  catch (e) { console.error(`render failed: ${e instanceof SettingsError ? e.problems.join('\n  ') : (e as Error).message}`); process.exit(1); }
}
