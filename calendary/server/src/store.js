import crypto from 'node:crypto';
import { db, transaction } from './db.js';
import { httpError, isYmd, nowIso, str, toIso } from './util.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const bool = (v) => (v ? 1 : 0);
const optInt = (v, min, max) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `Valore non valido: ${v}`);
  return n;
};

// ---------------------------------------------------------------- calendars

function mapCalendar(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    type: r.type,
    url: r.url,
    enabled: !!r.enabled,
    reminderMinutes: r.reminder_minutes,
    position: r.position,
    lastSync: r.last_sync,
    lastError: r.last_error,
  };
}

const CAL_COLUMNS = 'id, name, color, type, url, enabled, reminder_minutes, position, last_sync, last_error';

export function listCalendars() {
  return db.prepare(`SELECT ${CAL_COLUMNS} FROM calendars ORDER BY position, created_at`).all().map(mapCalendar);
}

export function getCalendar(id) {
  const row = db.prepare(`SELECT ${CAL_COLUMNS} FROM calendars WHERE id = ?`).get(id);
  return row ? mapCalendar(row) : null;
}

export function getIcsData(id) {
  const row = db.prepare('SELECT ics_data FROM calendars WHERE id = ?').get(id);
  return row ? row.ics_data : null;
}

export function firstLocalCalendarId() {
  const row = db.prepare("SELECT id FROM calendars WHERE type = 'local' AND enabled = 1 ORDER BY position, created_at LIMIT 1").get()
    || db.prepare("SELECT id FROM calendars WHERE type = 'local' ORDER BY position, created_at LIMIT 1").get();
  return row ? row.id : null;
}

function normalizeUrl(url) {
  const u = str(url, 2000);
  if (!u) throw httpError(400, "Serve l'URL iCal del calendario");
  const fixed = u.replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(fixed)) throw httpError(400, "L'URL deve iniziare con https:// o webcal://");
  return fixed;
}

export function createCalendar(input) {
  const type = input.type === 'ics' ? 'ics' : 'local';
  const name = str(input.name, 80);
  if (!name) throw httpError(400, 'Il calendario deve avere un nome');
  const color = COLOR_RE.test(input.color || '') ? input.color : '#22d3ee';
  const id = crypto.randomUUID();
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM calendars').get().p;
  db.prepare(`INSERT INTO calendars (id, name, color, type, url, enabled, reminder_minutes, position, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(
    id, name, color, type, type === 'ics' ? normalizeUrl(input.url) : null,
    optInt(input.reminderMinutes, 0, 10080), pos, nowIso(),
  );
  return getCalendar(id);
}

export function updateCalendar(id, patch) {
  const cal = getCalendar(id);
  if (!cal) throw httpError(404, 'Calendario non trovato');
  const next = {
    name: patch.name !== undefined ? str(patch.name, 80) : cal.name,
    color: patch.color !== undefined && COLOR_RE.test(patch.color) ? patch.color : cal.color,
    enabled: patch.enabled !== undefined ? bool(patch.enabled) : bool(cal.enabled),
    reminder: patch.reminderMinutes !== undefined ? optInt(patch.reminderMinutes, 0, 10080) : cal.reminderMinutes,
    url: cal.type === 'ics' && patch.url !== undefined ? normalizeUrl(patch.url) : cal.url,
  };
  if (!next.name) throw httpError(400, 'Il calendario deve avere un nome');
  db.prepare('UPDATE calendars SET name = ?, color = ?, enabled = ?, reminder_minutes = ?, url = ? WHERE id = ?')
    .run(next.name, next.color, next.enabled, next.reminder, next.url, id);
  return getCalendar(id);
}

export function deleteCalendar(id) {
  const cal = getCalendar(id);
  if (!cal) throw httpError(404, 'Calendario non trovato');
  if (cal.type === 'local') {
    const n = db.prepare("SELECT COUNT(*) AS n FROM calendars WHERE type = 'local'").get().n;
    if (n <= 1) throw httpError(400, 'Deve rimanere almeno un calendario interno');
  }
  db.prepare('DELETE FROM calendars WHERE id = ?').run(id);
}

export function ensureDefaultCalendars() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM calendars WHERE type = 'local'").get().n;
  if (!n) {
    createCalendar({ name: 'Personale', color: '#22d3ee', type: 'local' });
    createCalendar({ name: 'Studio', color: '#a66bff', type: 'local' });
  }
}

// ------------------------------------------------------------------- events

function mapEvent(r) {
  return {
    id: r.id,
    calendarId: r.calendar_id,
    calendarName: r.calendar_name,
    color: r.color,
    title: r.title,
    description: r.description || '',
    location: r.location || '',
    start: r.start_at,
    end: r.end_at,
    allDay: !!r.all_day,
    important: !!r.important,
    reminderMinutes: r.reminder_minutes,
    calendarReminder: r.cal_reminder,
    readOnly: false,
    busy: true,
    source: r.source,
    planId: r.plan_id,
    linkUrl: r.link_url || null,
    linkLabel: r.link_label || null,
  };
}

const EVENT_SELECT = `SELECT e.*, c.color AS color, c.name AS calendar_name, c.reminder_minutes AS cal_reminder
  FROM events e JOIN calendars c ON c.id = e.calendar_id`;

export function listLocalEvents(fromIso, toIso) {
  return db.prepare(`${EVENT_SELECT}
    WHERE c.enabled = 1 AND e.start_at < ? AND (e.end_at > ? OR e.start_at >= ?)
    ORDER BY e.start_at`).all(toIso, fromIso, fromIso).map(mapEvent);
}

export function getEvent(id) {
  const row = db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id);
  return row ? mapEvent(row) : null;
}

function normalizeEvent(input, base = null) {
  const merged = { ...(base || {}), ...input };
  const title = str(merged.title, 200);
  if (!title) throw httpError(400, "L'evento deve avere un titolo");
  const calendarId = merged.calendarId || firstLocalCalendarId();
  const cal = calendarId ? getCalendar(calendarId) : null;
  if (!cal) throw httpError(400, 'Calendario non trovato');
  if (cal.type !== 'local') throw httpError(400, 'I calendari iCal importati sono in sola lettura');
  const start = toIso(merged.start, 'inizio');
  let end = merged.end ? toIso(merged.end, 'fine') : new Date(Date.parse(start) + 3600e3).toISOString();
  if (Date.parse(end) < Date.parse(start)) throw httpError(400, "La fine dell'evento è prima dell'inizio");
  const allDay = !!merged.allDay;
  if (allDay && end === start) end = new Date(Date.parse(start) + 86400e3).toISOString();
  return {
    calendarId,
    title,
    description: str(merged.description, 5000) || '',
    location: str(merged.location, 300) || '',
    start,
    end,
    allDay: bool(allDay),
    important: bool(merged.important),
    reminderMinutes: optInt(merged.reminderMinutes, 0, 10080),
    linkUrl: normalizeLink(merged.linkUrl),
    linkLabel: str(merged.linkLabel, 60) || null,
  };
}

/** Only http(s) links or same-origin paths: never javascript: or data: URLs. */
function normalizeLink(url) {
  const u = str(url, 2000);
  if (!u) return null;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  if (!/^https?:\/\//i.test(u)) throw httpError(400, 'Il link deve iniziare con https:// o http://');
  return u;
}

export function createEvent(input, { source = 'manual', planId = null } = {}) {
  const e = normalizeEvent(input);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO events (id, calendar_id, title, description, location, start_at, end_at, all_day, important,
      reminder_minutes, source, plan_id, link_url, link_label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, e.calendarId, e.title, e.description, e.location, e.start, e.end, e.allDay, e.important,
    e.reminderMinutes, str(source, 20) || 'manual', str(planId, 120) || null, e.linkUrl, e.linkLabel, now, now,
  );
  return getEvent(id);
}

export function createEvents(list, opts) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'Nessun evento da creare');
  if (list.length > 500) throw httpError(400, 'Troppi eventi in una volta');
  return transaction(() => list.map((item) => createEvent(item, opts)));
}

export function updateEvent(id, patch) {
  const current = getEvent(id);
  if (!current) throw httpError(404, 'Evento non trovato');
  const e = normalizeEvent(patch, current);
  db.prepare(`UPDATE events SET calendar_id = ?, title = ?, description = ?, location = ?, start_at = ?, end_at = ?,
      all_day = ?, important = ?, reminder_minutes = ?, link_url = ?, link_label = ?, updated_at = ? WHERE id = ?`).run(
    e.calendarId, e.title, e.description, e.location, e.start, e.end, e.allDay, e.important, e.reminderMinutes,
    e.linkUrl, e.linkLabel, nowIso(), id,
  );
  return getEvent(id);
}

export function deleteEvent(id) {
  if (String(id).startsWith('ics:')) throw httpError(400, 'Gli eventi importati da iCal vanno eliminati dal calendario di origine');
  const res = db.prepare('DELETE FROM events WHERE id = ?').run(id);
  if (!res.changes) throw httpError(404, 'Evento non trovato');
}

export function deletePlan(planId) {
  return db.prepare('DELETE FROM events WHERE plan_id = ?').run(planId).changes;
}

// -------------------------------------------------------- eisenhower tasks

function mapTask(r) {
  return {
    id: r.id,
    date: r.date,
    quadrant: r.quadrant,
    title: r.title,
    notes: r.notes || '',
    done: !!r.done,
    position: r.position,
  };
}

export function listTasks(date) {
  if (!isYmd(date)) throw httpError(400, 'Data non valida');
  return db.prepare('SELECT * FROM tasks WHERE date = ? ORDER BY quadrant, done, position, created_at').all(date).map(mapTask);
}

export function countPendingBefore(date) {
  if (!isYmd(date)) throw httpError(400, 'Data non valida');
  return db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE date < ? AND done = 0').get(date).n;
}

function getTask(id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? mapTask(row) : null;
}

function quadrantOf(v) {
  const q = Number(v);
  if (![1, 2, 3, 4].includes(q)) throw httpError(400, 'Quadrante non valido (1-4)');
  return q;
}

export function createTask(input) {
  if (!isYmd(input.date)) throw httpError(400, 'Data non valida');
  const title = str(input.title, 200);
  if (!title) throw httpError(400, "L'attività deve avere un titolo");
  const quadrant = quadrantOf(input.quadrant);
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE date = ? AND quadrant = ?').get(input.date, quadrant).p;
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare('INSERT INTO tasks (id, date, quadrant, title, notes, done, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)')
    .run(id, input.date, quadrant, title, str(input.notes, 2000) || '', pos, now, now);
  return getTask(id);
}

export function createTasks(list) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'Nessuna attività da creare');
  return transaction(() => list.map(createTask));
}

export function updateTask(id, patch) {
  const t = getTask(id);
  if (!t) throw httpError(404, 'Attività non trovata');
  const next = {
    title: patch.title !== undefined ? str(patch.title, 200) : t.title,
    notes: patch.notes !== undefined ? str(patch.notes, 2000) || '' : t.notes,
    quadrant: patch.quadrant !== undefined ? quadrantOf(patch.quadrant) : t.quadrant,
    done: patch.done !== undefined ? bool(patch.done) : bool(t.done),
    date: patch.date !== undefined ? patch.date : t.date,
    position: patch.position !== undefined ? Number(patch.position) : t.position,
  };
  if (!next.title) throw httpError(400, "L'attività deve avere un titolo");
  if (!isYmd(next.date)) throw httpError(400, 'Data non valida');
  if (!Number.isFinite(next.position)) next.position = t.position;
  db.prepare('UPDATE tasks SET title = ?, notes = ?, quadrant = ?, done = ?, date = ?, position = ?, updated_at = ? WHERE id = ?')
    .run(next.title, next.notes, next.quadrant, next.done, next.date, next.position, nowIso(), id);
  return getTask(id);
}

export function deleteTask(id) {
  const res = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (!res.changes) throw httpError(404, 'Attività non trovata');
}

export function carryOverTasks(toDate) {
  if (!isYmd(toDate)) throw httpError(400, 'Data non valida');
  return db.prepare('UPDATE tasks SET date = ?, updated_at = ? WHERE date < ? AND done = 0').run(toDate, nowIso(), toDate).changes;
}
