import crypto from 'node:crypto';
import { db } from './db.js';
import { addDays, httpError, isYmd, nowIso, parseYmd, startOfDay, str, ymd } from './util.js';

// Pills: a medicine taken at fixed times on some weekdays. Each scheduled dose rings (push, Alexa)
// and is ticked off with "Presa ✓"; the history shows how regularly it was taken.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PALETTE = ['#ff7ac8', '#5ee7ff', '#a8ff60', '#ffd54a', '#c49bff', '#ffab5c'];

const parseJson = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

function mapPill(r) {
  return {
    id: r.id,
    name: r.name,
    dose: r.dose || '',
    times: parseJson(r.times, []),
    days: parseJson(r.days, [0, 1, 2, 3, 4, 5, 6]),
    startDate: r.start_date,
    endDate: r.end_date,
    alexa: !!r.alexa,
    active: !!r.active,
    color: r.color,
    notes: r.notes || '',
    pausedAt: r.paused_at || null,
    createdAt: r.created_at,
  };
}

export function getPill(id) {
  const row = db.prepare('SELECT * FROM pills WHERE id = ?').get(id);
  return row ? mapPill(row) : null;
}

export function listPills() {
  return db.prepare('SELECT * FROM pills ORDER BY active DESC, name').all().map(mapPill);
}

function normalize(input, base = {}) {
  const m = { ...base, ...input };
  const name = str(m.name, 100);
  if (!name) throw httpError(400, 'La pillola deve avere un nome');
  const times = [...new Set((Array.isArray(m.times) ? m.times : []).map(String))].filter((t) => TIME_RE.test(t)).sort();
  if (!times.length) throw httpError(400, 'Indica almeno un orario (HH:mm)');
  if (times.length > 12) throw httpError(400, 'Troppi orari');
  const days = [...new Set((Array.isArray(m.days) ? m.days : [0, 1, 2, 3, 4, 5, 6]).map(Number))].filter((d) => d >= 0 && d <= 6).sort();
  if (!days.length) throw httpError(400, 'Scegli almeno un giorno');
  const startDate = isYmd(m.startDate) ? m.startDate : ymd(new Date());
  const endDate = isYmd(m.endDate) ? m.endDate : null;
  if (endDate && endDate < startDate) throw httpError(400, 'La fine della terapia è prima dell\'inizio');
  return {
    name,
    dose: str(m.dose, 100) || '',
    times,
    days,
    startDate,
    endDate,
    alexa: m.alexa === undefined ? 1 : (m.alexa ? 1 : 0),
    active: m.active === undefined ? 1 : (m.active ? 1 : 0),
    color: COLOR_RE.test(m.color || '') ? m.color : PALETTE[Math.floor(Math.random() * PALETTE.length)],
    notes: str(m.notes, 1000) || '',
  };
}

export function createPill(input = {}) {
  const p = normalize(input);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO pills (id, name, dose, times, days, start_date, end_date, alexa, active, color, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, p.name, p.dose, JSON.stringify(p.times), JSON.stringify(p.days), p.startDate, p.endDate, p.alexa, p.active, p.color, p.notes, now, now,
  );
  return getPill(id);
}

export function updatePill(id, patch = {}) {
  const cur = getPill(id);
  if (!cur) throw httpError(404, 'Pillola non trovata');
  const p = normalize(patch, cur);
  // Pausing remembers the day (history stops there); resuming clears it.
  const pausedAt = p.active ? null : (cur.active ? ymd(new Date()) : cur.pausedAt);
  db.prepare(`UPDATE pills SET name = ?, dose = ?, times = ?, days = ?, start_date = ?, end_date = ?, alexa = ?, active = ?,
      color = ?, notes = ?, paused_at = ?, updated_at = ? WHERE id = ?`).run(
    p.name, p.dose, JSON.stringify(p.times), JSON.stringify(p.days), p.startDate, p.endDate, p.alexa, p.active, p.color, p.notes,
    pausedAt, nowIso(), id,
  );
  return getPill(id);
}

export function deletePill(id) {
  if (!db.prepare('DELETE FROM pills WHERE id = ?').run(id).changes) throw httpError(404, 'Pillola non trovata');
}

/** Is a dose of `pill` due on `date`? For the history a paused therapy still counts up to the day it was paused. */
const scheduledOn = (pill, date, history = false) => {
  const day = ymd(date);
  if (!pill.days.includes(date.getDay()) || day < pill.startDate || (pill.endDate && day > pill.endDate)) return false;
  if (pill.active) return true;
  return history && !!pill.pausedAt && day < pill.pausedAt;
};

const takenSet = (fromYmd, toYmd) => new Map(
  db.prepare('SELECT pill_id, date, time, taken_at FROM pill_doses WHERE date >= ? AND date <= ?').all(fromYmd, toYmd)
    .map((r) => [`${r.pill_id}|${r.date}|${r.time}`, r.taken_at]),
);

/**
 * Every scheduled dose in [from, to), with its local time and whether it was taken.
 * With `history`, paused therapies count until they were paused, and doses taken at times that are no longer
 * in the schedule (the therapy was edited later) are kept too.
 */
export function dosesBetween(from, to, { history = false } = {}) {
  const pills = listPills().filter((p) => p.active || history);
  const first = startOfDay(from);
  const taken = takenSet(ymd(first), ymd(to));
  const out = [];
  const seen = new Set();
  const byId = new Map(pills.map((p) => [p.id, p]));
  for (let d = first; d < to; d = addDays(d, 1)) {
    for (const pill of pills) {
      if (!scheduledOn(pill, d, history)) continue;
      for (const time of pill.times) {
        const at = new Date(`${ymd(d)}T${time}`);
        if (at < from || at >= to) continue;
        const key = `${pill.id}|${ymd(d)}|${time}`;
        seen.add(key);
        out.push({ pillId: pill.id, name: pill.name, dose: pill.dose, color: pill.color, alexa: pill.alexa, date: ymd(d), time, at: at.toISOString(), takenAt: taken.get(key) || null });
      }
    }
  }
  if (history) {
    for (const [key, takenAt] of taken) {
      if (seen.has(key)) continue;
      const [pillId, date, time] = key.split('|');
      const pill = byId.get(pillId);
      const at = new Date(`${date}T${time}`);
      if (!pill || at < from || at >= to) continue;
      out.push({ pillId, name: pill.name, dose: pill.dose, color: pill.color, alexa: pill.alexa, date, time, at: at.toISOString(), takenAt });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.name.localeCompare(b.name));
}

/** Doses of one day (for the dashboard card). */
export function dosesOn(dateYmd) {
  if (!isYmd(dateYmd)) throw httpError(400, 'Data non valida');
  const day = parseYmd(dateYmd);
  return dosesBetween(day, addDays(day, 1));
}

/**
 * Marks a dose taken (at `takenAt`, default now: it can be corrected later) or not taken.
 * The time can't be in the future, nor more than 2 days away from the dose.
 */
export function setDose(pillId, date, time, taken, takenAt = null) {
  const pill = getPill(pillId);
  if (!pill) throw httpError(404, 'Pillola non trovata');
  if (!isYmd(date) || !TIME_RE.test(String(time))) throw httpError(400, 'Dose non valida');
  if (taken) {
    let at = new Date();
    if (takenAt) {
      at = new Date(takenAt);
      if (Number.isNaN(at.getTime())) throw httpError(400, 'Orario non valido');
      if (at.getTime() > Date.now() + 60e3) throw httpError(400, 'L\'orario è nel futuro');
      if (Math.abs(at.getTime() - Date.parse(new Date(`${date}T${time}`).toISOString())) > 2 * 86400e3) {
        throw httpError(400, 'L\'orario è troppo lontano dalla dose');
      }
    }
    db.prepare(`INSERT INTO pill_doses (pill_id, date, time, taken_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(pill_id, date, time) DO UPDATE SET taken_at = excluded.taken_at`).run(pillId, date, time, at.toISOString());
  } else {
    db.prepare('DELETE FROM pill_doses WHERE pill_id = ? AND date = ? AND time = ?').run(pillId, date, time);
  }
}

const MAX_HISTORY_DAYS = 3660;

/** First day with something to show: the earliest therapy start (or taken dose). */
function historyStart() {
  const row = db.prepare('SELECT MIN(d) AS d FROM (SELECT MIN(start_date) AS d FROM pills UNION ALL SELECT MIN(date) FROM pill_doses)').get();
  return row?.d && isYmd(row.d) ? row.d : ymd(new Date());
}

/**
 * History from `days` days ago (today included) or, with `all`, since the first therapy started.
 * Per pill: doses due vs taken, percentage, current streak of complete days, and the day-by-day map.
 */
export function pillHistory({ days = 14, all = false } = {}) {
  const today = startOfDay(new Date());
  let from = all ? parseYmd(historyStart()) : addDays(today, -(days - 1));
  if (from > today) from = today;
  const oldest = addDays(today, -(MAX_HISTORY_DAYS - 1));
  if (from < oldest) from = oldest;
  const now = Date.now();
  // Today counts as a whole day (1 of 2 doses taken = 50%, not 100% because the evening one isn't due yet);
  // its doses still to come are "pending", not missed.
  const todayYmd = ymd(today);
  const doses = dosesBetween(from, addDays(today, 1), { history: true });
  const byPill = new Map();
  for (const d of doses) {
    const s = byPill.get(d.pillId) || { pillId: d.pillId, name: d.name, color: d.color, scheduled: 0, taken: 0, pending: 0, firstDate: d.date, days: {} };
    s.scheduled += 1;
    if (d.takenAt) s.taken += 1;
    else if (d.date === todayYmd && Date.parse(d.at) > now) s.pending += 1;
    const day = (s.days[d.date] ||= { scheduled: 0, taken: 0 });
    day.scheduled += 1;
    if (d.takenAt) day.taken += 1;
    byPill.set(d.pillId, s);
  }
  for (const s of byPill.values()) {
    // streak: consecutive complete days going back from today (today counts only once complete)
    let streak = 0;
    const dates = Object.keys(s.days).sort().reverse();
    for (const date of dates) {
      const day = s.days[date];
      if (day.taken >= day.scheduled) streak += 1;
      else if (date === ymd(today)) continue;
      else break;
    }
    s.streak = streak;
    s.percent = s.scheduled ? Math.round((s.taken / s.scheduled) * 100) : 0;
  }
  return { from: ymd(from), to: ymd(today), pills: [...byPill.values()] };
}

/** Day-by-day register of one month (YYYY-MM): every dose with when it was taken. */
export function pillLog(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw httpError(400, 'Mese non valido (YYYY-MM)');
  const [y, m] = month.split('-').map(Number);
  const from = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const today = addDays(startOfDay(new Date()), 1);
  // today's doses still to come are listed too (shown as "da prendere")
  return dosesBetween(from, end < today ? end : today, { history: true });
}
