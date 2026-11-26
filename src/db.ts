// The SQLite database a run collects into and renders from (`state.db`). See docs/design.md, "SQLite schema".
// v1 creates it fresh on every run; the same file is what a future state store would keep.
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

// Every timestamp is stored in UTC ("…Z"). GitHub's APIs mix UTC and local offsets, so collectors convert on the way in;
// this CHECK makes a missed conversion fail loudly instead of quietly mis-sorting the feed.
const utc = (col: string) => `CHECK (${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z')`;

const ITEM_KINDS = ['pr', 'issue', 'issue_comment', 'commit_comment', 'discussion', 'discussion_reply', 'review', 'new_repo', 'fork'];

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE profile (
  source TEXT NOT NULL, login TEXT NOT NULL, created_at TEXT NOT NULL ${utc('created_at')},
  bio TEXT, location TEXT, company TEXT,
  PRIMARY KEY (source, login));

CREATE TABLE orgs (source TEXT NOT NULL, login TEXT NOT NULL, name TEXT, PRIMARY KEY (source, login));

CREATE TABLE repos (
  source TEXT NOT NULL, name_with_owner TEXT NOT NULL, owner TEXT NOT NULL,
  is_own INTEGER NOT NULL, is_private INTEGER NOT NULL DEFAULT 0, is_fork INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
  parent TEXT, description TEXT, stars INTEGER, licence TEXT, language TEXT,
  created_at TEXT ${utc('created_at')}, pushed_at TEXT ${utc('pushed_at')},
  PRIMARY KEY (source, name_with_owner));

CREATE TABLE items (
  source TEXT NOT NULL, node_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (${ITEM_KINDS.map(k => `'${k}'`).join(', ')})),
  repo TEXT NOT NULL, created_at TEXT NOT NULL ${utc('created_at')},
  title TEXT NOT NULL, url TEXT NOT NULL, state TEXT, merged_at TEXT ${utc('merged_at')},
  PRIMARY KEY (source, node_id));

CREATE TABLE commits (
  source TEXT NOT NULL, sha TEXT NOT NULL, repo TEXT NOT NULL, authored_at TEXT NOT NULL ${utc('authored_at')},
  message TEXT NOT NULL, additions INTEGER, deletions INTEGER,
  PRIMARY KEY (source, sha));

CREATE TABLE calendar (source TEXT NOT NULL, date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), total INTEGER NOT NULL, PRIMARY KEY (source, date));

CREATE TABLE year_totals (
  source TEXT NOT NULL, year INTEGER NOT NULL,
  contributions INTEGER NOT NULL, commits INTEGER NOT NULL, issues INTEGER NOT NULL, prs INTEGER NOT NULL, reviews INTEGER NOT NULL, restricted INTEGER NOT NULL,
  PRIMARY KEY (source, year));

CREATE TABLE runs (
  started_at TEXT NOT NULL ${utc('started_at')}, finished_at TEXT ${utc('finished_at')},
  api_calls INTEGER, items_collected INTEGER, items_dropped_private INTEGER, error TEXT);
`;

export type Database = DatabaseSync;

/** Opens (creating if needed) the database at `path`, or ':memory:'. Refuses a file from another schema version. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  const hasMeta = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).get();
  if (!hasMeta) {
    db.exec('BEGIN');
    db.exec(SCHEMA);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION));
    db.exec('COMMIT');
    return db;
  }
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
  if (Number(row?.value) !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`${path} has schema version ${row?.value ?? 'unknown'}, expected ${SCHEMA_VERSION}; delete it and collect again`);
  }
  return db;
}
