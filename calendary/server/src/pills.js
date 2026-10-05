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
  db.prepare(`UPDATE pills SET name = ?, dose = ?, times = ?, days = ?, start_date = ?, end_date = ?, alexa = ?, active = ?,
      color = ?, notes = ?, updated_at = ? WHERE id = ?`).run(
    p.name, p.dose, JSON.stringify(p.times), JSON.stringify(p.days), p.startDate, p.endDate, p.alexa, p.active, p.color, p.notes, nowIso(), id,
  );
  return getPill(id);
}

export function deletePill(id) {
  if (!db.prepare('DELETE FROM pills WHERE id = ?').run(id).changes) throw httpError(404, 'Pillola non trovata');
}

const scheduledOn = (pill, date) => {
  const day = ymd(date);
  return pill.active && pill.days.includes(date.getDay()) && day >= pill.startDate && (!pill.endDate || day <= pill.endDate);
};

const takenSet = (fromYmd, toYmd) => new Map(
  db.prepare('SELECT pill_id, date, time, taken_at FROM pill_doses WHERE date >= ? AND date <= ?').all(fromYmd, toYmd)
    .map((r) => [`${r.pill_id}|${r.date}|${r.time}`, r.taken_at]),
);

/** Every scheduled dose in [from, to), with its local time and whether it was taken. */
export function dosesBetween(from, to) {
  const pills = listPills().filter((p) => p.active);
  const first = startOfDay(from);
  const taken = takenSet(ymd(first), ymd(to));
  const out = [];
  for (let d = first; d < to; d = addDays(d, 1)) {
    for (const pill of pills) {
      if (!scheduledOn(pill, d)) continue;
      for (const time of pill.times) {
        const at = new Date(`${ymd(d)}T${time}`);
        if (at < from || at >= to) continue;
        const takenAt = taken.get(`${pill.id}|${ymd(d)}|${time}`) || null;
        out.push({ pillId: pill.id, name: pill.name, dose: pill.dose, color: pill.color, alexa: pill.alexa, date: ymd(d), time, at: at.toISOString(), takenAt });
      }
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

export function setDose(pillId, date, time, taken) {
  const pill = getPill(pillId);
  if (!pill) throw httpError(404, 'Pillola non trovata');
  if (!isYmd(date) || !TIME_RE.test(String(time))) throw httpError(400, 'Dose non valida');
  if (taken) {
    db.prepare('INSERT OR IGNORE INTO pill_doses (pill_id, date, time, taken_at) VALUES (?, ?, ?, ?)').run(pillId, date, time, nowIso());
  } else {
    db.prepare('DELETE FROM pill_doses WHERE pill_id = ? AND date = ? AND time = ?').run(pillId, date, time);
  }
}

/** Last `days` days (today included): taken vs scheduled per pill, and the day-by-day grid. */
export function pillHistory(days = 14) {
  const today = startOfDay(new Date());
  const from = addDays(today, -(days - 1));
  const now = Date.now();
  const doses = dosesBetween(from, addDays(today, 1)).filter((d) => Date.parse(d.at) <= now || d.takenAt);
  const byPill = new Map();
  for (const d of doses) {
    const s = byPill.get(d.pillId) || { pillId: d.pillId, name: d.name, color: d.color, scheduled: 0, taken: 0, days: {} };
    s.scheduled += 1;
    if (d.takenAt) s.taken += 1;
    const day = (s.days[d.date] ||= { scheduled: 0, taken: 0 });
    day.scheduled += 1;
    if (d.takenAt) day.taken += 1;
    byPill.set(d.pillId, s);
  }
  return { from: ymd(from), to: ymd(today), pills: [...byPill.values()] };
}
