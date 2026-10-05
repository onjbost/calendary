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

const map = (r) => ({ id: r.id, startDate: r.start_date, endDate: r.end_date, note: r.note || '' });

/** Current and future periods (past ones are dropped after a week). */
export function listTrips() {
  const keepFrom = ymd(new Date(Date.now() - 7 * 86400e3));
  db.prepare('DELETE FROM travel_periods WHERE end_date < ?').run(keepFrom);
  return db.prepare('SELECT * FROM travel_periods ORDER BY start_date').all().map(map);
}

export function createTrip(input = {}) {
  const { startDate, endDate } = input;
  if (!isYmd(startDate) || !isYmd(endDate)) throw httpError(400, 'Indica le date di partenza e di ritorno');
  if (endDate < startDate) throw httpError(400, 'Il ritorno è prima della partenza');
  if (endDate < ymd(new Date())) throw httpError(400, 'Il periodo è già passato');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO travel_periods (id, start_date, end_date, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, startDate, endDate, str(input.note, 200) || '', nowIso());
  return map(db.prepare('SELECT * FROM travel_periods WHERE id = ?').get(id));
}

export function deleteTrip(id) {
  if (!db.prepare('DELETE FROM travel_periods WHERE id = ?').run(id).changes) throw httpError(404, 'Periodo non trovato');
}

/** The travel period covering this moment (Date, ISO string or ms), or null. */
export function tripAt(when = new Date()) {
  const day = ymd(new Date(when));
  const row = db.prepare('SELECT * FROM travel_periods WHERE start_date <= ? AND end_date >= ? LIMIT 1').get(day, day);
  return row ? map(row) : null;
}
