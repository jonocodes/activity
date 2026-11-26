import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../src/db.ts';

const tables = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map(r => r.name);
const columns = (db: ReturnType<typeof openDatabase>, table: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];

test('a fresh database has every table in the schema', () => {
  const db = openDatabase(':memory:');
  assert.deepEqual(tables(db), ['calendar', 'commits', 'items', 'meta', 'orgs', 'profile', 'repos', 'runs', 'year_totals']);
});

test('every data table records its source', () => {
  const db = openDatabase(':memory:');
  for (const t of tables(db).filter(t => t !== 'meta' && t !== 'runs')) {
    const source = columns(db, t).find(c => c.name === 'source');
    assert.ok(source, `${t} has a source column`);
    assert.equal(source.notnull, 1, `${t}.source is NOT NULL`);
  }
});

test('timestamps must be UTC', () => {
  const db = openDatabase(':memory:');
  const insert = db.prepare(`INSERT INTO items (source, node_id, kind, repo, created_at, title, url) VALUES ('github', ?, 'issue', 'o/r', ?, 't', 'u')`);
  insert.run('a', '2026-11-23T18:04:00Z');
  insert.run('b', '2026-11-23T18:04:00.123Z');
  assert.throws(() => insert.run('c', '2026-11-23T10:04:00-08:00'), /CHECK constraint/);
  assert.throws(() => insert.run('d', '2026-11-23'), /CHECK constraint/);
});

test('items only take known kinds', () => {
  const db = openDatabase(':memory:');
  const insert = db.prepare(`INSERT INTO items (source, node_id, kind, repo, created_at, title, url) VALUES ('github', ?, ?, 'o/r', '2026-11-23T18:04:00Z', 't', 'u')`);
  for (const kind of ['pr', 'issue', 'issue_comment', 'commit_comment', 'discussion', 'discussion_reply', 'review', 'new_repo', 'fork']) insert.run(kind, kind);
  assert.throws(() => insert.run('x', 'push'), /CHECK constraint/);
});

test('a commit is stored once per sha', () => {
  const db = openDatabase(':memory:');
  const insert = db.prepare(`INSERT INTO commits (source, sha, repo, authored_at, message) VALUES ('github', 'abc', ?, '2026-11-23T18:04:00Z', 'm')`);
  insert.run('o/r');
  assert.throws(() => insert.run('me/fork-of-r'), /UNIQUE constraint/);
});

test('a database file keeps its data when reopened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-db-'));
  try {
    const path = join(dir, 'state.db');
    const first = openDatabase(path);
    first.prepare(`INSERT INTO orgs (source, login, name) VALUES ('github', 'acme', 'Acme')`).run();
    first.close();
    const second = openDatabase(path);
    assert.deepEqual((second.prepare(`SELECT login FROM orgs`).all() as { login: string }[]).map(r => r.login), ['acme']);
    second.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a database from another schema version is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-db-'));
  try {
    const path = join(dir, 'state.db');
    const db = openDatabase(path);
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run(String(SCHEMA_VERSION + 1));
    db.close();
    assert.throws(() => openDatabase(path), /schema version/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
