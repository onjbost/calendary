import crypto from 'node:crypto';
import { db } from './db.js';
import { httpError, isYmd, nowIso, str, ymd } from './util.js';

// Travel mode: scheduled periods (whole days, start and end included) in which nothing rings or speaks on Alexa.
// Push notifications on the phone keep working.

db.exec(`
  CREATE TABLE IF NOT EXISTS travel_periods (
    id TEXT PRIMARY KEY,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
`);
// 0.12.0: a period can belong to a trip of the trips module ("Alexa in silenzio durante il viaggio")
if (!db.prepare('PRAGMA table_info(travel_periods)').all().some((c) => c.name === 'trip_id')) {
  db.exec('ALTER TABLE travel_periods ADD COLUMN trip_id TEXT');
}

const map = (r) => ({ id: r.id, startDate: r.start_date, endDate: r.end_date, note: r.note || '', tripId: r.trip_id || null });

/** Current and future periods (past ones are dropped after a week). */
export function listTravelPeriods() {
  const keepFrom = ymd(new Date(Date.now() - 7 * 86400e3));
  db.prepare('DELETE FROM travel_periods WHERE end_date < ?').run(keepFrom);
  return db.prepare('SELECT * FROM travel_periods ORDER BY start_date').all().map(map);
}

export function createTravelPeriod(input = {}) {
  const { startDate, endDate } = input;
  if (!isYmd(startDate) || !isYmd(endDate)) throw httpError(400, 'Indica le date di partenza e di ritorno');
  if (endDate < startDate) throw httpError(400, 'Il ritorno è prima della partenza');
  if (endDate < ymd(new Date())) throw httpError(400, 'Il periodo è già passato');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO travel_periods (id, start_date, end_date, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, startDate, endDate, str(input.note, 200) || '', nowIso());
  return map(db.prepare('SELECT * FROM travel_periods WHERE id = ?').get(id));
}

export function deleteTravelPeriod(id) {
  if (!db.prepare('DELETE FROM travel_periods WHERE id = ?').run(id).changes) throw httpError(404, 'Periodo non trovato');
}

/** The travel period covering this moment (Date, ISO string or ms), or null. */
export function travelPeriodAt(when = new Date()) {
  const day = ymd(new Date(when));
  const row = db.prepare('SELECT * FROM travel_periods WHERE start_date <= ? AND end_date >= ? LIMIT 1').get(day, day);
  return row ? map(row) : null;
}

/** The period of a trip: created, moved or removed (null) with the trip. Past dates are fine here. */
export function setTripPeriod(tripId, period) {
  db.prepare('DELETE FROM travel_periods WHERE trip_id = ?').run(String(tripId));
  if (!period) return null;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO travel_periods (id, start_date, end_date, note, trip_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, period.startDate, period.endDate, str(period.note, 200) || '', String(tripId), nowIso());
  return map(db.prepare('SELECT * FROM travel_periods WHERE id = ?').get(id));
}
