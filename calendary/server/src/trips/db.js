// Tables of the trips module (all prefixed trip_ or named trips): they move with the module to its own app one day.
import { db } from '../db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    place_name TEXT,
    place_country TEXT,
    lat REAL,
    lon REAL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    bag TEXT NOT NULL DEFAULT 'cabin',
    can_wash INTEGER NOT NULL DEFAULT 0,
    quiet_alexa INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    weather TEXT,
    weather_at TEXT,
    weather_kind TEXT,
    weather_changed INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trips_dates ON trips(start_date, end_date);

  CREATE TABLE IF NOT EXISTS trip_legs (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    from_place TEXT NOT NULL DEFAULT '',
    to_place TEXT NOT NULL DEFAULT '',
    depart_at TEXT NOT NULL,
    arrive_at TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    booking TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    checkin_hours INTEGER,
    direction TEXT NOT NULL DEFAULT 'other',
    event_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trip_legs_trip ON trip_legs(trip_id);

  CREATE TABLE IF NOT EXISTS trip_activities (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    day TEXT NOT NULL DEFAULT '',
    tag TEXT NOT NULL DEFAULT 'other',
    title TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT '',
    minutes INTEGER NOT NULL DEFAULT 120,
    place TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    event_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trip_activities_trip ON trip_activities(trip_id);
`);

export { db };
