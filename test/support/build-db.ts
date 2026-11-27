// Builds a small database by hand, for render-model tests (seam 2: database + settings + now).
import { openDatabase, type Database } from '../../src/db.ts';
import { loadSettings, type Settings } from '../../src/settings.ts';

export const OWNER = 'fixture-owner';
let n = 0;

export function emptyDb(): Database {
  const db = openDatabase(':memory:');
  db.prepare(`INSERT INTO profile (source, login, created_at, bio, location, company) VALUES ('github', ?, '2015-03-01T10:00:00Z', 'Builds small tools', 'Lisbon', NULL)`).run(OWNER);
  for (const [k, v] of [['owner', OWNER], ['contributions_last_12_months', '321'], ['restricted_last_12_months', '12']]) db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(k, v);
  return db;
}
export function own(db: Database, name: string, o: { fork?: boolean; parent?: string | null; archived?: boolean; license?: string; language?: string; pushed?: string; description?: string } = {}) {
  db.prepare(`INSERT INTO repos (source, name_with_owner, owner, is_own, is_fork, is_archived, parent, description, stars, license, language, created_at, pushed_at) VALUES ('github', ?, ?, 1, ?, ?, ?, ?, 0, ?, ?, '2020-01-01T00:00:00Z', ?)`)
    .run(`${OWNER}/${name}`, OWNER, o.fork ? 1 : 0, o.archived ? 1 : 0, o.parent ?? null, o.description ?? null, o.license ?? null, o.language ?? null, o.pushed ?? '2026-01-01T00:00:00Z');
}
export function ext(db: Database, nameWithOwner: string, o: { language?: string; license?: string; stars?: number } = {}) {
  db.prepare(`INSERT INTO repos (source, name_with_owner, owner, is_own, description, stars, license, language) VALUES ('github', ?, ?, 0, NULL, ?, ?, ?)`)
    .run(nameWithOwner, nameWithOwner.split('/')[0], o.stars ?? 0, o.license ?? null, o.language ?? null);
}
export function item(db: Database, kind: string, repo: string, at: string, title = `${kind} ${++n}`) {
  db.prepare(`INSERT INTO items (source, node_id, kind, repo, created_at, title, url) VALUES ('github', ?, ?, ?, ?, ?, ?)`).run(`N${++n}`, kind, repo, at, title, `https://github.com/${repo}/x/${n}`);
}
export function commit(db: Database, repo: string, at: string, message = `commit ${++n}`) {
  db.prepare(`INSERT INTO commits (source, sha, repo, authored_at, message) VALUES ('github', ?, ?, ?, ?)`).run(`sha${++n}`, repo, at, message);
}
export function days(db: Database, ...entries: [string, number][]) {
  for (const [d, c] of entries) db.prepare(`INSERT OR REPLACE INTO calendar (source, date, total) VALUES ('github', ?, ?)`).run(d, c);
}
export const settings = (env: Record<string, string> = {}): Settings => loadSettings({ ACTIVITY_USER: OWNER, ...env });
export const NOW = new Date('2026-11-25T20:00:00Z');   // Wednesday; 12:00 in Los Angeles
