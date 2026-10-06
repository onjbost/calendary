// Trips (0.12.0): a trip with its legs (plane, train…) and its day-by-day programme. Spec §4, §10.
// Every change is reported to the sync hook (calendar-port.js writes the calendar from it).
import crypto from 'node:crypto';
import { db } from './db.js';
import { BAGS, MODES, TAGS } from './vocab.js';
import { addDays, httpError, isYmd, nowIso, parseYmd, str, toIso, ymd } from '../util.js';

let sync = null;
/** The calendar port listens here: ({ type: 'trip:create' | 'leg:update' | …, before, after }) => void. */
export function setTripsSync(fn) {
  sync = fn || null;
}
const emit = (type, before, after) => sync?.({ type, before, after });

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const shift = (day, n) => ymd(addDays(parseYmd(day), n));

// ---------------------------------------------------------------- mapping

const mapLeg = (r) => ({
  id: r.id,
  tripId: r.trip_id,
  mode: r.mode,
  from: r.from_place,
  to: r.to_place,
  departAt: r.depart_at,
  arriveAt: r.arrive_at,
  code: r.code,
  booking: r.booking,
  notes: r.notes,
  checkinHours: r.checkin_hours,
  direction: r.direction,
  eventId: r.event_id,
});

const mapActivity = (r) => ({
  id: r.id,
  tripId: r.trip_id,
  day: r.day,
  tag: r.tag,
  title: r.title,
  time: r.time,
  minutes: r.minutes,
  place: r.place,
  notes: r.notes,
  eventId: r.event_id,
  position: r.position,
});

const parseWeather = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

function mapTrip(r) {
  return {
    id: r.id,
    name: r.name,
    place: r.place_name ? { name: r.place_name, country: r.place_country || '', lat: r.lat, lon: r.lon } : null,
    startDate: r.start_date,
    endDate: r.end_date,
    bag: r.bag,
    canWash: !!r.can_wash,
    quietAlexa: !!r.quiet_alexa,
    notes: r.notes,
    weather: parseWeather(r.weather),
    weatherAt: r.weather_at,
    weatherKind: r.weather_kind,
    weatherChanged: !!r.weather_changed,
    source: r.source,
    legs: db.prepare('SELECT * FROM trip_legs WHERE trip_id = ? ORDER BY depart_at').all(r.id).map(mapLeg),
    // day order; activities "to reschedule" (day '') last; untimed activities after the timed ones of their day
    activities: db.prepare(`SELECT * FROM trip_activities WHERE trip_id = ?
      ORDER BY day = '', day, time = '', time, position, created_at`).all(r.id).map(mapActivity),
  };
}

const tripRow = (id) => db.prepare('SELECT * FROM trips WHERE id = ?').get(String(id));
const legRow = (id) => db.prepare('SELECT * FROM trip_legs WHERE id = ?').get(String(id));
const activityRow = (id) => db.prepare('SELECT * FROM trip_activities WHERE id = ?').get(String(id));

// ---------------------------------------------------------------- trips

export function listTrips() {
  return db.prepare('SELECT * FROM trips ORDER BY start_date, created_at').all().map(mapTrip);
}

export function getTrip(id) {
  const r = tripRow(id);
  if (!r) throw httpError(404, 'Viaggio non trovato');
  return mapTrip(r);
}

function normalizePlace(p) {
  if (p === null) return null;
  if (!p || typeof p !== 'object') return undefined;
  const name = str(p.name, 120);
  if (!name) return null;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  const ok = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return { name, country: str(p.country, 80) || '', lat: ok ? lat : null, lon: ok ? lon : null };
}

function normalizeTrip(input, base = null) {
  const m = { ...(base || {}), ...input };
  const name = str(m.name, 120);
  if (!name) throw httpError(400, 'Dai un nome al viaggio');
  if (!isYmd(m.startDate) || !isYmd(m.endDate)) throw httpError(400, 'Indica le date di partenza e di ritorno');
  if (m.endDate < m.startDate) throw httpError(400, 'Il ritorno è prima della partenza');
  const bag = m.bag ?? 'cabin';
  if (!BAGS.includes(bag)) throw httpError(400, `Bagaglio sconosciuto: ${bag}`);
  const place = 'place' in input ? normalizePlace(input.place) : base?.place ?? null;
  return {
    name,
    place: place === undefined ? base?.place ?? null : place,
    startDate: m.startDate,
    endDate: m.endDate,
    bag,
    canWash: !!m.canWash,
    quietAlexa: !!m.quietAlexa,
    notes: str(m.notes, 20000) ?? '',
  };
}

export function createTrip(input = {}, { source = 'manual' } = {}) {
  const t = normalizeTrip(input);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO trips (id, name, place_name, place_country, lat, lon, start_date, end_date, bag, can_wash,
      quiet_alexa, notes, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, t.name, t.place?.name ?? null, t.place?.country ?? null, t.place?.lat ?? null, t.place?.lon ?? null,
    t.startDate, t.endDate, t.bag, t.canWash ? 1 : 0, t.quietAlexa ? 1 : 0, t.notes, source === 'event' ? 'event' : 'manual', now, now,
  );
  const after = getTrip(id);
  emit('trip:create', null, after);
  return after;
}

export function updateTrip(id, patch = {}) {
  const before = getTrip(id);
  const t = normalizeTrip(patch, before);
  const placeChanged = JSON.stringify(t.place) !== JSON.stringify(before.place);
  db.prepare(`UPDATE trips SET name = ?, place_name = ?, place_country = ?, lat = ?, lon = ?, start_date = ?, end_date = ?,
      bag = ?, can_wash = ?, quiet_alexa = ?, notes = ?, updated_at = ? WHERE id = ?`).run(
    t.name, t.place?.name ?? null, t.place?.country ?? null, t.place?.lat ?? null, t.place?.lon ?? null,
    t.startDate, t.endDate, t.bag, t.canWash ? 1 : 0, t.quietAlexa ? 1 : 0, t.notes, nowIso(), before.id,
  );
  // new place or new dates: the saved weather no longer applies
  if (placeChanged || t.startDate !== before.startDate || t.endDate !== before.endDate) {
    db.prepare('UPDATE trips SET weather = NULL, weather_at = NULL, weather_kind = NULL WHERE id = ?').run(before.id);
  }
  // activities outside the new dates are kept, "to reschedule"
  db.prepare("UPDATE trip_activities SET day = '', updated_at = ? WHERE trip_id = ? AND day != '' AND (day < ? OR day > ?)")
    .run(nowIso(), before.id, t.startDate, t.endDate);
  recomputeDirections(before.id);
  const after = getTrip(before.id);
  emit('trip:update', before, after);
  return after;
}

export function deleteTrip(id) {
  const before = getTrip(id);
  db.prepare('DELETE FROM trips WHERE id = ?').run(before.id);
  emit('trip:delete', before, null);
}

/** Stores the destination weather (trips/weather.js). */
export function saveWeather(id, { weather, kind, changed, at = nowIso() }) {
  db.prepare('UPDATE trips SET weather = ?, weather_at = ?, weather_kind = ?, weather_changed = ? WHERE id = ?')
    .run(weather ? JSON.stringify(weather) : null, at, kind ?? null, changed ? 1 : 0, String(id));
}

// ---------------------------------------------------------------- legs

function normalizeLeg(input, trip, base = null) {
  const m = { ...(base || {}), ...input };
  if (!MODES[m.mode]) throw httpError(400, `Mezzo sconosciuto: ${m.mode}`);
  const departAt = toIso(m.departAt, 'partenza');
  const arriveAt = toIso(m.arriveAt, 'arrivo');
  if (Date.parse(arriveAt) < Date.parse(departAt)) throw httpError(400, "L'arrivo è prima della partenza");
  // the outbound leg may leave the day before (night train), the return arrive the day after
  if (ymd(departAt) < shift(trip.startDate, -1) || ymd(arriveAt) > shift(trip.endDate, 1)) {
    throw httpError(400, 'La tratta è fuori dalle date del viaggio');
  }
  let checkinHours = null;
  if (m.mode === 'plane') {
    const n = m.checkinHours === undefined || m.checkinHours === null || m.checkinHours === '' ? 24 : Math.round(Number(m.checkinHours));
    if (!Number.isFinite(n) || n < 1 || n > 24 * 30) throw httpError(400, 'Apertura del check-in non valida (ore prima della partenza)');
    checkinHours = n;
  }
  return {
    mode: m.mode,
    from: str(m.from, 120) || '',
    to: str(m.to, 120) || '',
    departAt,
    arriveAt,
    code: str(m.code, 40) || '',
    booking: str(m.booking, 80) || '',
    notes: str(m.notes, 2000) || '',
    checkinHours,
  };
}

/**
 * Outbound / return / other for every leg of a trip, from the dates and the order of the legs: a leg leaving on the
 * first day is "out", one landing on the last day is "back"; when both (day trips, an overnight ferry on a two-day
 * trip) it is "back" only if an earlier leg already left. Recomputed on every change, so the order of entry is moot.
 */
function recomputeDirections(tripId) {
  const trip = tripRow(tripId);
  if (!trip) return;
  const legs = db.prepare('SELECT id, depart_at, arrive_at FROM trip_legs WHERE trip_id = ? ORDER BY depart_at').all(trip.id);
  const set = db.prepare('UPDATE trip_legs SET direction = ? WHERE id = ?');
  let earlierOut = false;
  for (const l of legs) {
    const out = ymd(l.depart_at) <= trip.start_date;
    const back = ymd(l.arrive_at) >= trip.end_date;
    const direction = out && back ? (earlierOut ? 'back' : 'out') : out ? 'out' : back ? 'back' : 'other';
    if (out) earlierOut = true;
    set.run(direction, l.id);
  }
}

export function addLeg(tripId, input = {}) {
  const trip = getTrip(tripId);
  const l = normalizeLeg(input, trip);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO trip_legs (id, trip_id, mode, from_place, to_place, depart_at, arrive_at, code, booking, notes,
      checkin_hours, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, trip.id, l.mode, l.from, l.to, l.departAt, l.arriveAt, l.code, l.booking, l.notes, l.checkinHours, now, now,
  );
  recomputeDirections(trip.id);
  const after = mapLeg(legRow(id));
  emit('leg:create', null, after);
  return after;
}

export function getLeg(legId) {
  const r = legRow(legId);
  if (!r) throw httpError(404, 'Tratta non trovata');
  return mapLeg(r);
}

export function updateLeg(legId, patch = {}) {
  const before = getLeg(legId);
  const l = normalizeLeg(patch, getTrip(before.tripId), before);
  db.prepare(`UPDATE trip_legs SET mode = ?, from_place = ?, to_place = ?, depart_at = ?, arrive_at = ?, code = ?, booking = ?,
      notes = ?, checkin_hours = ?, updated_at = ? WHERE id = ?`).run(
    l.mode, l.from, l.to, l.departAt, l.arriveAt, l.code, l.booking, l.notes, l.checkinHours, nowIso(), before.id,
  );
  recomputeDirections(before.tripId);
  const after = getLeg(before.id);
  emit('leg:update', before, after);
  return after;
}

export function deleteLeg(legId) {
  const before = getLeg(legId);
  db.prepare('DELETE FROM trip_legs WHERE id = ?').run(before.id);
  recomputeDirections(before.tripId);
  emit('leg:delete', before, null);
}

// ---------------------------------------------------------------- activities

function normalizeActivity(input, trip, base = null) {
  const m = { ...(base || {}), ...input };
  const title = str(m.title, 160);
  if (!title) throw httpError(400, "Dai un titolo all'attività");
  const day = m.day ?? '';
  if (day !== '' && (!isYmd(day) || day < trip.startDate || day > trip.endDate)) throw httpError(400, "Il giorno dell'attività è fuori dalle date del viaggio");
  const time = m.time ?? '';
  if (time !== '' && !HHMM.test(time)) throw httpError(400, 'Orario non valido (HH:mm)');
  const minutes = m.minutes === undefined || m.minutes === null || m.minutes === '' ? 120 : Math.round(Number(m.minutes));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 24 * 60) throw httpError(400, 'Durata non valida');
  return {
    day,
    tag: TAGS[m.tag] ? m.tag : 'other',
    title,
    time,
    minutes,
    place: str(m.place, 160) || '',
    notes: str(m.notes, 2000) || '',
    position: Number.isFinite(Number(m.position)) ? Math.round(Number(m.position)) : 0,
  };
}

export function addActivity(tripId, input = {}) {
  const trip = getTrip(tripId);
  const a = normalizeActivity(input, trip);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO trip_activities (id, trip_id, day, tag, title, time, minutes, place, notes, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, trip.id, a.day, a.tag, a.title, a.time, a.minutes, a.place, a.notes, a.position, now, now);
  const after = mapActivity(activityRow(id));
  emit('activity:create', null, after);
  return after;
}

export function getActivity(id) {
  const r = activityRow(id);
  if (!r) throw httpError(404, 'Attività non trovata');
  return mapActivity(r);
}

export function updateActivity(id, patch = {}) {
  const before = getActivity(id);
  const a = normalizeActivity(patch, getTrip(before.tripId), before);
  db.prepare(`UPDATE trip_activities SET day = ?, tag = ?, title = ?, time = ?, minutes = ?, place = ?, notes = ?, position = ?,
      updated_at = ? WHERE id = ?`).run(a.day, a.tag, a.title, a.time, a.minutes, a.place, a.notes, a.position, nowIso(), before.id);
  const after = getActivity(before.id);
  emit('activity:update', before, after);
  return after;
}

export function deleteActivity(id) {
  const before = getActivity(id);
  db.prepare('DELETE FROM trip_activities WHERE id = ?').run(before.id);
  emit('activity:delete', before, null);
}

// ---------------------------------------------------------------- calendar links

/** Remembers the calendar event of a leg or an activity (null when it has none). No sync is emitted. */
export function setEventId(kind, id, eventId) {
  const table = kind === 'leg' ? 'trip_legs' : 'trip_activities';
  db.prepare(`UPDATE ${table} SET event_id = ? WHERE id = ?`).run(eventId || null, String(id));
}

/** The leg or activity a calendar event belongs to. */
export function findByEvent(eventId) {
  if (!eventId) return null;
  const leg = db.prepare('SELECT * FROM trip_legs WHERE event_id = ?').get(String(eventId));
  if (leg) return { kind: 'leg', row: mapLeg(leg) };
  const act = db.prepare('SELECT * FROM trip_activities WHERE event_id = ?').get(String(eventId));
  if (act) return { kind: 'activity', row: mapActivity(act) };
  return null;
}
