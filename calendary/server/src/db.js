import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'calendary.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('local', 'ics')),
    url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    reminder_minutes INTEGER,
    position INTEGER NOT NULL DEFAULT 0,
    last_sync TEXT,
    last_error TEXT,
    ics_data TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    important INTEGER NOT NULL DEFAULT 0,
    reminder_minutes INTEGER,
    source TEXT NOT NULL DEFAULT 'manual',
    plan_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
  CREATE INDEX IF NOT EXISTS idx_events_plan ON events(plan_id);

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    quadrant INTEGER NOT NULL CHECK (quadrant BETWEEN 1 AND 4),
    title TEXT NOT NULL,
    notes TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notified (
    key TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Goals (e.g. yearly work objectives), their measures, evidence and recurring routines.
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    description TEXT,
    start_date TEXT NOT NULL,
    deadline TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    color TEXT NOT NULL,
    required_items INTEGER,
    manual_progress REAL,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS goal_items (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('check', 'number', 'count')),
    target REAL,
    current REAL,
    unit TEXT,
    period TEXT NOT NULL DEFAULT 'total' CHECK (period IN ('total', 'week', 'quarter')),
    due TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    tracking_start TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_goal_items_goal ON goal_items(goal_id);

  CREATE TABLE IF NOT EXISTS goal_evidence (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES goal_items(id) ON DELETE SET NULL,
    routine_id TEXT,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_goal_evidence_goal ON goal_evidence(goal_id, date);

  CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES goal_items(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    freq TEXT NOT NULL CHECK (freq IN ('weekly', 'monthly', 'quarterly')),
    days TEXT NOT NULL DEFAULT '[]',
    interval_weeks INTEGER NOT NULL DEFAULT 1,
    month_day INTEGER,
    time TEXT NOT NULL,
    duration INTEGER NOT NULL DEFAULT 30,
    start_date TEXT NOT NULL,
    end_date TEXT,
    reminder_minutes INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS routine_checks (
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    evidence_id TEXT,
    done_at TEXT NOT NULL,
    PRIMARY KEY (routine_id, date)
  );

  -- Reminders currently scheduled on the user's Alexa devices (one row per event occurrence).
  CREATE TABLE IF NOT EXISTS alexa_reminders (
    key TEXT PRIMARY KEY,
    alert_token TEXT NOT NULL,
    fire_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Lightweight migrations for columns added after the first release.
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
// 0.3.0: events can carry a link (e.g. "open this workout in Moveo").
addColumn('events', 'link_url', 'link_url TEXT');
addColumn('events', 'link_label', 'link_label TEXT');
// 0.7.0: ring on Alexa N minutes before (NULL = not on Alexa).
addColumn('events', 'alexa_minutes', 'alexa_minutes INTEGER');

db.exec(`
  -- Sticky notes: things to remember without a date.
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Pills: a medicine with its daily times, and the doses actually taken.
  CREATE TABLE IF NOT EXISTS pills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dose TEXT,
    times TEXT NOT NULL DEFAULT '[]',
    days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    start_date TEXT NOT NULL,
    end_date TEXT,
    alexa INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    color TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pill_doses (
    pill_id TEXT NOT NULL REFERENCES pills(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    PRIMARY KEY (pill_id, date, time)
  );
`);
// 0.7.1: day a therapy was paused, so the history stops counting missed doses from then on.
addColumn('pills', 'paused_at', 'paused_at TEXT');

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

export function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function transaction(fn) {
  if (db.isTransaction) return fn(); // nested call: the outer transaction commits
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
