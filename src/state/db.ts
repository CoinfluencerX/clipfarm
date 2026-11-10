import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Append-only list of migrations. Never edit a shipped entry. Add a new one.
 * PRAGMA user_version tracks how many have run.
 */
const MIGRATIONS: readonly string[] = [
  `
  -- One row per source file, ever (sha256 is unique), with the rights record it was ingested under.
  CREATE TABLE media (
    id           INTEGER PRIMARY KEY,
    source_id    TEXT    NOT NULL,
    path         TEXT    NOT NULL,
    sha256       TEXT    NOT NULL UNIQUE,
    duration_ms  INTEGER NOT NULL,
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    rights_json  TEXT    NOT NULL,           -- snapshot of the rights record at ingest
    status       TEXT    NOT NULL CHECK (status IN ('ingested', 'selected')),
    ingested_at  INTEGER NOT NULL            -- unix ms
  );

  CREATE TABLE segments (
    id          INTEGER PRIMARY KEY,
    media_id    INTEGER NOT NULL REFERENCES media(id),
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    score       REAL    NOT NULL,
    confidence  REAL    NOT NULL,
    title       TEXT    NOT NULL,
    caption     TEXT    NOT NULL,
    selector    TEXT    NOT NULL,            -- heuristic | claude:<model>
    created_at  INTEGER NOT NULL,
    UNIQUE (media_id, start_ms, end_ms)
  );

  CREATE TABLE clips (
    id           INTEGER PRIMARY KEY,
    segment_id   INTEGER NOT NULL UNIQUE REFERENCES segments(id),
    path         TEXT    NOT NULL,
    status       TEXT    NOT NULL CHECK (status IN ('rendered', 'approved', 'rejected', 'withdrawn')),
    created_at   INTEGER NOT NULL,
    reviewed_at  INTEGER
  );

  -- One row per clip per account, ever. The row is written BEFORE any upload,
  -- so a restart or a second run can't post the same clip to the same account twice.
  CREATE TABLE posts (
    id            INTEGER PRIMARY KEY,
    clip_id       INTEGER NOT NULL REFERENCES clips(id),
    brand_id      TEXT    NOT NULL,
    platform      TEXT    NOT NULL,
    account       TEXT    NOT NULL,
    caption       TEXT    NOT NULL,
    scheduled_at  INTEGER NOT NULL,
    status        TEXT    NOT NULL CHECK (status IN ('scheduled', 'dry_run', 'published', 'failed', 'removed')),
    external_id   TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    UNIQUE (clip_id, brand_id, platform)
  );

  CREATE TABLE metrics (
    post_id   INTEGER NOT NULL REFERENCES posts(id),
    at        INTEGER NOT NULL,
    views     INTEGER,
    likes     INTEGER,
    comments  INTEGER,
    shares    INTEGER,
    PRIMARY KEY (post_id, at)
  );

  CREATE TABLE audit_log (
    id            INTEGER PRIMARY KEY,
    at            INTEGER NOT NULL,
    kind          TEXT    NOT NULL,
    payload_json  TEXT    NOT NULL           -- redacted
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function userVersion(db: Db): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

export function migrate(db: Db): void {
  const current = userVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema v${current} is newer than this code (v${MIGRATIONS.length}). Refusing to run.`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Opens (creating if needed) the SQLite file and brings the schema up to date. Pass ":memory:" in tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}
