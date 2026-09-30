import crypto from 'node:crypto';
import { db, transaction } from './db.js';
import { addDays, clamp, httpError, isYmd, nowIso, parseYmd, startOfDay, str, ymd } from './util.js';

// Goals ("Obiettivi"): measurable objectives with a deadline, evidence collected over time
// and recurring routines that show up in the calendar (virtual events, like iCal occurrences).

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PALETTE = ['#00e5ff', '#ff2bd6', '#a66bff', '#9dff3a', '#ffb020', '#ff3d6e', '#3d8bff', '#00d5a0'];
const STATUSES = ['not_started', 'in_progress', 'at_risk', 'done'];
const KINDS = ['check', 'number', 'count'];
const PERIODS = ['total', 'week', 'quarter'];
const FREQS = ['weekly', 'monthly', 'quarterly'];
const DAY = 86400e3;

// ------------------------------------------------------------------- periods

export function mondayOf(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const quarterStart = (date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
const periodStart = (date, period) => (period === 'week' ? mondayOf(date) : quarterStart(date));
const nextPeriod = (d, period) => (period === 'week' ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 3, 1));

/** Start dates (YYYY-MM-DD) of every week/quarter touching [from, to]. */
function periodKeys(from, to, period) {
  const keys = [];
  for (let d = periodStart(from, period); d <= to; d = nextPeriod(d, period)) keys.push(ymd(d));
  return keys;
}

// ------------------------------------------------------------------- mapping

const optNum = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function mapGoal(r) {
  return {
    id: r.id,
    title: r.title,
    category: r.category || '',
    description: r.description || '',
    startDate: r.start_date,
    deadline: r.deadline,
    status: r.status,
    color: r.color,
    requiredItems: r.required_items,
    manualProgress: r.manual_progress,
    position: r.position,
  };
}

function mapItem(r) {
  return {
    id: r.id,
    goalId: r.goal_id,
    title: r.title,
    kind: r.kind,
    target: r.target,
    current: r.current,
    unit: r.unit || '',
    period: r.period,
    due: r.due,
    done: !!r.done,
    position: r.position,
    trackingStart: r.tracking_start,
  };
}

function mapRoutine(r) {
  return {
    id: r.id,
    goalId: r.goal_id,
    itemId: r.item_id,
    title: r.title,
    freq: r.freq,
    days: JSON.parse(r.days || '[]'),
    intervalWeeks: r.interval_weeks,
    monthDay: r.month_day,
    time: r.time,
    duration: r.duration,
    startDate: r.start_date,
    endDate: r.end_date,
    reminderMinutes: r.reminder_minutes,
    active: !!r.active,
  };
}

function mapEvidence(r) {
  return { id: r.id, goalId: r.goal_id, itemId: r.item_id, routineId: r.routine_id, date: r.date, text: r.text };
}

// ------------------------------------------------------------------ routines

function occursOn(r, d) {
  if (r.freq === 'weekly') {
    if (!r.days.includes(d.getDay())) return false;
    if (r.intervalWeeks <= 1) return true;
    const weeks = Math.round((mondayOf(d) - mondayOf(parseYmd(r.startDate))) / (7 * DAY));
    return weeks % r.intervalWeeks === 0;
  }
  if (r.freq === 'quarterly' && ![2, 5, 8, 11].includes(d.getMonth())) return false; // last month of each quarter
  return d.getDate() === monthlyDate(d.getFullYear(), d.getMonth(), r.monthDay).getDate();
}

/** Day of the month for monthly/quarterly routines; a Saturday/Sunday moves back to Friday. */
function monthlyDate(year, month, monthDay) {
  const last = new Date(year, month + 1, 0).getDate();
  const d = new Date(year, month, monthDay === -1 || monthDay === null ? last : Math.min(monthDay, last));
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

/** Dates (YYYY-MM-DD) on which the routine happens within [from, to] (Date, inclusive days). */
function routineDates(r, goalDeadline, from, to) {
  const out = [];
  let d = startOfDay(from);
  const first = parseYmd(r.startDate);
  if (d < first) d = first;
  const lastDay = parseYmd(r.endDate || goalDeadline);
  const end = to < lastDay ? startOfDay(to) : lastDay;
  for (; d <= end; d = addDays(d, 1)) if (occursOn(r, d)) out.push(ymd(d));
  return out;
}

function atLocal(dateStr, time) {
  const [h, m] = time.split(':').map(Number);
  const d = parseYmd(dateStr);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Calendar entries produced by goals in [fromIso, toIso):
 * routine occurrences (timed, with reminders) and milestones/deadlines (all-day).
 */
export function goalCalendarEntries(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(Date.parse(toIso) - 1);
  const out = [];

  const routines = db.prepare(`SELECT r.*, g.title AS goal_title, g.color AS goal_color, g.deadline AS goal_deadline
    FROM routines r JOIN goals g ON g.id = r.goal_id WHERE r.active = 1 AND g.status != 'done'`).all();
  if (routines.length) {
    const checks = new Set(db.prepare('SELECT routine_id, date FROM routine_checks WHERE date >= ? AND date <= ?')
      .all(ymd(addDays(from, -1)), ymd(addDays(to, 1))).map((c) => `${c.routine_id}|${c.date}`));
    for (const row of routines) {
      const r = mapRoutine(row);
      for (const date of routineDates(r, row.goal_deadline, addDays(from, -1), to)) {
        const start = atLocal(date, r.time);
        const end = new Date(start.getTime() + r.duration * 60e3);
        if (end <= from || start > to) continue;
        out.push({
          id: `routine:${r.id}:${date}`,
          calendarId: 'goals',
          calendarName: row.goal_title,
          color: row.goal_color,
          title: r.title,
          description: `Routine dell'obiettivo "${row.goal_title}"`,
          location: '',
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: false,
          important: false,
          reminderMinutes: r.reminderMinutes,
          calendarReminder: null,
          readOnly: true,
          busy: true,
          source: 'routine',
          planId: null,
          routineId: r.id,
          goalId: r.goalId,
          occurrenceDate: date,
          done: checks.has(`${r.id}|${date}`),
        });
      }
    }
  }

  // Milestones: measures with a due date.
  const fromDay = ymd(from);
  const toDay = ymd(to);
  const milestones = db.prepare(`SELECT i.*, g.title AS goal_title, g.color AS goal_color FROM goal_items i
    JOIN goals g ON g.id = i.goal_id WHERE i.due IS NOT NULL AND i.due >= ? AND i.due <= ?`).all(fromDay, toDay);
  for (const m of milestones) {
    const start = parseYmd(m.due);
    out.push(allDayEntry(`goalitem:${m.id}`, `🎯 ${m.title}`, start, m.goal_color, m.goal_title, m.goal_id, !!m.done));
  }

  // Deadlines, grouped by date (many yearly goals share the same one).
  const deadlines = db.prepare("SELECT deadline, COUNT(*) AS n, MIN(title) AS title, MIN(color) AS color FROM goals WHERE deadline >= ? AND deadline <= ? AND status != 'done' GROUP BY deadline")
    .all(fromDay, toDay);
  for (const d of deadlines) {
    const title = d.n > 1 ? `🏁 Scadenza di ${d.n} obiettivi` : `🏁 Scadenza: ${d.title}`;
    out.push(allDayEntry(`goaldeadline:${d.deadline}`, title, parseYmd(d.deadline), d.color, 'Obiettivi', null, false));
  }
  return out;
}

function allDayEntry(id, title, start, color, calendarName, goalId, done) {
  return {
    id,
    calendarId: 'goals',
    calendarName,
    color,
    title,
    description: '',
    location: '',
    start: start.toISOString(),
    end: addDays(start, 1).toISOString(),
    allDay: true,
    important: false,
    reminderMinutes: null,
    calendarReminder: null,
    readOnly: true,
    busy: false,
    source: 'milestone',
    planId: null,
    goalId,
    done,
  };
}

// ------------------------------------------------------------------ progress

/** Share of the goal's time already elapsed (0..1). */
function timeElapsed(goal) {
  const start = parseYmd(goal.startDate).getTime();
  const end = parseYmd(goal.deadline).getTime() + DAY;
  return clamp((Date.now() - start) / (end - start), 0, 1);
}

// Each measure reports its progress and the progress "expected by now", so the goal pace compares like with like.
function itemProgress(item, evidence, goal, today) {
  const timeShare = timeElapsed(goal);
  if (item.kind === 'check') return { progress: item.done ? 1 : 0, expected: timeShare };
  if (item.kind === 'number') {
    return { progress: item.target > 0 ? clamp((item.current || 0) / item.target, 0, 1) : null, expected: timeShare };
  }
  // count: evidence tagged with this measure
  if (item.period === 'total') {
    const count = evidence.length;
    return { count, progress: item.target > 0 ? clamp(count / item.target, 0, 1) : null, expected: timeShare };
  }
  const target = item.target > 0 ? item.target : 1;
  const counts = new Map();
  for (const e of evidence) {
    const key = ymd(periodStart(parseYmd(e.date), item.period));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Count periods only since the measure has been tracked here: weeks before it can't be recovered.
  const since = item.trackingStart && item.trackingStart > goal.startDate ? item.trackingStart : goal.startDate;
  const keys = periodKeys(parseYmd(since), parseYmd(goal.deadline), item.period);
  const currentKey = ymd(periodStart(today, item.period));
  const elapsed = keys.filter((k) => k <= currentKey);
  const met = elapsed.filter((k) => (counts.get(k) || 0) >= target);
  return {
    count: counts.get(currentKey) || 0,
    periodsMet: met.length,
    periodsElapsed: elapsed.length,
    periodsTotal: keys.length,
    // yearly view: share of all periods in which the target was reached
    progress: keys.length ? met.length / keys.length : null,
    // the current period isn't over yet: it only counts as expected once it has passed
    expected: keys.length ? Math.max(0, elapsed.length - 1) / keys.length : 0,
  };
}

function routineStats(r, goal, checksByRoutine, today) {
  const until = today < parseYmd(goal.deadline) ? today : parseYmd(goal.deadline);
  const occurred = routineDates(r, goal.deadline, parseYmd(r.startDate), until);
  const done = checksByRoutine.get(r.id) || new Set();
  const last4 = routineDates(r, goal.deadline, addDays(until, -27), until);
  return {
    occurred: occurred.length,
    done: occurred.filter((d) => done.has(d)).length,
    recentOccurred: last4.length,
    recentDone: last4.filter((d) => done.has(d)).length,
  };
}

/** Every goal with measures, evidence, routines and computed progress / pace. */
export function listGoals() {
  const today = startOfDay(new Date());
  const goals = db.prepare('SELECT * FROM goals ORDER BY position, created_at').all().map(mapGoal);
  const items = db.prepare('SELECT * FROM goal_items ORDER BY position, rowid').all().map(mapItem);
  const evidence = db.prepare('SELECT * FROM goal_evidence ORDER BY date DESC, created_at DESC').all().map(mapEvidence);
  const routines = db.prepare('SELECT * FROM routines ORDER BY created_at').all().map(mapRoutine);
  const checksByRoutine = new Map();
  for (const c of db.prepare('SELECT routine_id, date FROM routine_checks').all()) {
    if (!checksByRoutine.has(c.routine_id)) checksByRoutine.set(c.routine_id, new Set());
    checksByRoutine.get(c.routine_id).add(c.date);
  }

  return goals.map((g) => {
    const gItems = items.filter((i) => i.goalId === g.id).map((i) => ({
      ...i,
      ...itemProgress(i, evidence.filter((e) => e.itemId === i.id), g, today),
    }));
    const measurable = gItems.filter((i) => i.progress !== null && i.progress !== undefined);
    let progress;
    if (measurable.length) {
      const denom = g.requiredItems && g.requiredItems > 0 ? g.requiredItems : measurable.length;
      progress = clamp(measurable.reduce((s, i) => s + i.progress, 0) / denom, 0, 1);
    } else {
      progress = clamp((g.manualProgress || 0) / 100, 0, 1);
    }
    if (g.status === 'done') progress = 1;
    const expected = measurable.length && !g.requiredItems
      ? clamp(measurable.reduce((s, i) => s + i.expected, 0) / measurable.length, 0, 1)
      : timeElapsed(g);
    // Nothing recorded yet: "behind" would only mean "not filled in", say so instead.
    const tracked = g.status === 'done' || (g.manualProgress || 0) > 0 || evidence.some((e) => e.goalId === g.id)
      || gItems.some((i) => (i.kind === 'check' && i.done) || (i.kind === 'number' && (i.current || 0) > 0));
    const pace = progress >= 0.999 ? 'done' : !tracked ? 'untracked' : progress + 0.1 < expected ? 'behind' : 'on_track';
    return {
      ...g,
      items: gItems,
      evidence: evidence.filter((e) => e.goalId === g.id),
      routines: routines.filter((r) => r.goalId === g.id).map((r) => ({ ...r, stats: routineStats(r, g, checksByRoutine, today) })),
      progress,
      expected,
      pace,
      daysLeft: Math.ceil((parseYmd(g.deadline).getTime() - today.getTime()) / DAY),
    };
  });
}

// ---------------------------------------------------------------- validation

function normGoal(input, base = {}) {
  const m = { ...base, ...input };
  const title = str(m.title, 160);
  if (!title) throw httpError(400, "L'obiettivo deve avere un titolo");
  if (!isYmd(m.startDate)) throw httpError(400, "Data d'inizio non valida");
  if (!isYmd(m.deadline)) throw httpError(400, 'Scadenza non valida');
  if (m.deadline < m.startDate) throw httpError(400, "La scadenza è prima dell'inizio");
  return {
    title,
    category: str(m.category, 200) || '',
    description: str(m.description, 20000) || '',
    startDate: m.startDate,
    deadline: m.deadline,
    status: STATUSES.includes(m.status) ? m.status : 'in_progress',
    color: COLOR_RE.test(m.color || '') ? m.color : PALETTE[Math.floor(Math.random() * PALETTE.length)],
    requiredItems: optNum(m.requiredItems) && m.requiredItems > 0 ? Math.round(m.requiredItems) : null,
    manualProgress: optNum(m.manualProgress) === null ? null : clamp(Number(m.manualProgress), 0, 100),
  };
}

function normItem(input) {
  const title = str(input.title, 300);
  if (!title) throw httpError(400, 'Ogni misura deve avere un titolo');
  const kind = KINDS.includes(input.kind) ? input.kind : 'check';
  return {
    title,
    kind,
    target: kind === 'check' ? null : optNum(input.target),
    current: kind === 'number' ? optNum(input.current) ?? 0 : null,
    unit: str(input.unit, 30) || '',
    period: kind === 'count' && PERIODS.includes(input.period) ? input.period : 'total',
    due: isYmd(input.due) ? input.due : null,
    done: input.done ? 1 : 0,
  };
}

function normRoutine(input, base = {}) {
  const m = { ...base, ...input };
  const title = str(m.title, 200);
  if (!title) throw httpError(400, 'La routine deve avere un titolo');
  const freq = FREQS.includes(m.freq) ? m.freq : 'weekly';
  const days = [...new Set((Array.isArray(m.days) ? m.days : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  if (freq === 'weekly' && !days.length) throw httpError(400, 'Scegli almeno un giorno della settimana');
  if (!TIME_RE.test(m.time || '')) throw httpError(400, 'Orario non valido (HH:mm)');
  const monthDay = optNum(m.monthDay);
  return {
    title,
    freq,
    days,
    intervalWeeks: freq === 'weekly' ? clamp(Math.round(Number(m.intervalWeeks) || 1), 1, 8) : 1,
    monthDay: freq === 'weekly' ? null : monthDay === -1 ? -1 : clamp(Math.round(monthDay || 1), 1, 28),
    time: m.time,
    duration: clamp(Math.round(Number(m.duration) || 30), 5, 600),
    startDate: isYmd(m.startDate) ? m.startDate : ymd(new Date()),
    endDate: isYmd(m.endDate) ? m.endDate : null,
    reminderMinutes: optNum(m.reminderMinutes) === null ? null : clamp(Math.round(m.reminderMinutes), 0, 1440),
    active: m.active === undefined ? 1 : m.active ? 1 : 0,
    itemId: m.itemId || null,
  };
}

function goalExists(id) {
  if (!db.prepare('SELECT 1 FROM goals WHERE id = ?').get(id)) throw httpError(404, 'Obiettivo non trovato');
}

function itemBelongs(itemId, goalId) {
  if (!itemId) return null;
  return db.prepare('SELECT 1 FROM goal_items WHERE id = ? AND goal_id = ?').get(itemId, goalId) ? itemId : null;
}

// ---------------------------------------------------------------------- CRUD

function writeItems(goalId, items) {
  const keep = new Set();
  items.forEach((input, idx) => {
    const it = normItem(input);
    const existing = input.id && db.prepare('SELECT id FROM goal_items WHERE id = ? AND goal_id = ?').get(input.id, goalId);
    if (existing) {
      db.prepare('UPDATE goal_items SET title = ?, kind = ?, target = ?, current = ?, unit = ?, period = ?, due = ?, done = ?, position = ? WHERE id = ?')
        .run(it.title, it.kind, it.target, it.current, it.unit, it.period, it.due, it.done, idx, input.id);
      keep.add(input.id);
    } else {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO goal_items (id, goal_id, title, kind, target, current, unit, period, due, done, position, tracking_start) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, goalId, it.title, it.kind, it.target, it.current, it.unit, it.period, it.due, it.done, idx,
          isYmd(input.trackingStart) ? input.trackingStart : ymd(new Date()));
      keep.add(id);
      if (input.key) input.__id = id; // used by import to link routines to measures
    }
  });
  for (const { id } of db.prepare('SELECT id FROM goal_items WHERE goal_id = ?').all(goalId)) {
    if (!keep.has(id)) db.prepare('DELETE FROM goal_items WHERE id = ?').run(id);
  }
}

export function createGoal(input) {
  const g = normGoal({ startDate: ymd(new Date()), ...input });
  const id = crypto.randomUUID();
  const now = nowIso();
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM goals').get().p;
  transaction(() => {
    db.prepare(`INSERT INTO goals (id, title, category, description, start_date, deadline, status, color, required_items, manual_progress, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, g.title, g.category, g.description, g.startDate, g.deadline, g.status, g.color, g.requiredItems, g.manualProgress, pos, now, now,
    );
    if (Array.isArray(input.items)) writeItems(id, input.items);
  });
  return id;
}

export function updateGoal(id, patch) {
  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  if (!row) throw httpError(404, 'Obiettivo non trovato');
  const g = normGoal(patch, mapGoal(row));
  transaction(() => {
    db.prepare(`UPDATE goals SET title = ?, category = ?, description = ?, start_date = ?, deadline = ?, status = ?, color = ?,
        required_items = ?, manual_progress = ?, updated_at = ? WHERE id = ?`).run(
      g.title, g.category, g.description, g.startDate, g.deadline, g.status, g.color, g.requiredItems, g.manualProgress, nowIso(), id,
    );
    if (Array.isArray(patch.items)) writeItems(id, patch.items);
  });
}

export function deleteGoal(id) {
  if (!db.prepare('DELETE FROM goals WHERE id = ?').run(id).changes) throw httpError(404, 'Obiettivo non trovato');
}

/** Quick update of a single measure (tick, value) without opening the goal editor. */
export function updateItem(id, patch) {
  const row = db.prepare('SELECT * FROM goal_items WHERE id = ?').get(id);
  if (!row) throw httpError(404, 'Misura non trovata');
  const it = normItem({ ...mapItem(row), ...patch });
  db.prepare('UPDATE goal_items SET title = ?, kind = ?, target = ?, current = ?, unit = ?, period = ?, due = ?, done = ? WHERE id = ?')
    .run(it.title, it.kind, it.target, it.current, it.unit, it.period, it.due, it.done, id);
}

export function addEvidence(goalId, input) {
  goalExists(goalId);
  const text = str(input.text, 4000);
  if (!text) throw httpError(400, "Descrivi l'evidenza");
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO goal_evidence (id, goal_id, item_id, routine_id, date, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, goalId, itemBelongs(input.itemId, goalId), input.routineId || null, isYmd(input.date) ? input.date : ymd(new Date()), text, nowIso());
  return id;
}

export function deleteEvidence(id) {
  if (!db.prepare('DELETE FROM goal_evidence WHERE id = ?').run(id).changes) throw httpError(404, 'Evidenza non trovata');
}

export function createRoutine(input) {
  if (!input.goalId) throw httpError(400, 'Scegli un obiettivo per la routine');
  goalExists(input.goalId);
  const r = normRoutine(input);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO routines (id, goal_id, item_id, title, freq, days, interval_weeks, month_day, time, duration, start_date, end_date,
      reminder_minutes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.goalId, itemBelongs(r.itemId, input.goalId), r.title, r.freq, JSON.stringify(r.days), r.intervalWeeks, r.monthDay, r.time,
    r.duration, r.startDate, r.endDate, r.reminderMinutes, r.active, now, now,
  );
  return id;
}

export function createRoutines(list) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'Nessuna routine da creare');
  return transaction(() => list.map(createRoutine));
}

export function updateRoutine(id, patch) {
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(id);
  if (!row) throw httpError(404, 'Routine non trovata');
  const base = mapRoutine(row);
  const goalId = patch.goalId || base.goalId;
  goalExists(goalId);
  const r = normRoutine(patch, base);
  db.prepare(`UPDATE routines SET goal_id = ?, item_id = ?, title = ?, freq = ?, days = ?, interval_weeks = ?, month_day = ?, time = ?, duration = ?,
      start_date = ?, end_date = ?, reminder_minutes = ?, active = ?, updated_at = ? WHERE id = ?`).run(
    goalId, itemBelongs(r.itemId, goalId), r.title, r.freq, JSON.stringify(r.days), r.intervalWeeks, r.monthDay, r.time, r.duration,
    r.startDate, r.endDate, r.reminderMinutes, r.active, nowIso(), id,
  );
}

export function deleteRoutine(id) {
  if (!db.prepare('DELETE FROM routines WHERE id = ?').run(id).changes) throw httpError(404, 'Routine non trovata');
}

/**
 * Tick / untick one occurrence. A tick also records evidence when the routine feeds a
 * measure (so "timesheet every week" counts automatically) or when a note is given.
 */
export function setRoutineCheck(routineId, date, done, note) {
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
  if (!row) throw httpError(404, 'Routine non trovata');
  if (!isYmd(date)) throw httpError(400, 'Data non valida');
  const existing = db.prepare('SELECT * FROM routine_checks WHERE routine_id = ? AND date = ?').get(routineId, date);
  transaction(() => {
    if (done && !existing) {
      let evidenceId = null;
      const text = str(note, 4000);
      if (row.item_id || text) {
        evidenceId = crypto.randomUUID();
        db.prepare('INSERT INTO goal_evidence (id, goal_id, item_id, routine_id, date, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(evidenceId, row.goal_id, row.item_id, routineId, date, text || `Routine completata: ${row.title}`, nowIso());
      }
      db.prepare('INSERT INTO routine_checks (routine_id, date, evidence_id, done_at) VALUES (?, ?, ?, ?)').run(routineId, date, evidenceId, nowIso());
    } else if (!done && existing) {
      if (existing.evidence_id) db.prepare('DELETE FROM goal_evidence WHERE id = ?').run(existing.evidence_id);
      db.prepare('DELETE FROM routine_checks WHERE routine_id = ? AND date = ?').run(routineId, date);
    }
  });
}

// ------------------------------------------------------------ import/export

/**
 * Import format (also what export produces):
 * { version: 1, goals: [{ title, category, description, startDate, deadline, status, color, requiredItems,
 *   items: [{ key?, title, kind, target, current, unit, period, due, done }],
 *   routines: [{ title, freq, days, intervalWeeks, monthDay, time, duration, startDate, endDate, reminderMinutes, itemKey? }],
 *   evidence: [{ date, text, itemKey? }] }] }
 * Goals whose title already exists are skipped, so importing twice doesn't duplicate.
 */
export function importGoals(data) {
  const list = Array.isArray(data?.goals) ? data.goals : null;
  if (!list) throw httpError(400, 'File non valido: manca la lista "goals"');
  const existing = new Set(db.prepare('SELECT title FROM goals').all().map((r) => r.title.trim().toLowerCase()));
  const result = { created: 0, skipped: [], routines: 0 };
  transaction(() => {
    for (const g of list) {
      const title = str(g?.title, 160);
      if (!title) continue;
      if (existing.has(title.toLowerCase())) {
        result.skipped.push(title);
        continue;
      }
      const items = (Array.isArray(g.items) ? g.items : []).map((i) => ({ ...i }));
      const goalId = createGoal({ ...g, items });
      result.created += 1;
      const keyToId = new Map(items.filter((i) => i.key && i.__id).map((i) => [i.key, i.__id]));
      for (const r of Array.isArray(g.routines) ? g.routines : []) {
        createRoutine({ ...r, goalId, itemId: r.itemKey ? keyToId.get(r.itemKey) : null });
        result.routines += 1;
      }
      for (const e of Array.isArray(g.evidence) ? g.evidence : []) {
        addEvidence(goalId, { ...e, itemId: e.itemKey ? keyToId.get(e.itemKey) : null });
      }
    }
  });
  return result;
}

export function exportGoals() {
  return {
    version: 1,
    exportedAt: nowIso(),
    goals: listGoals().map((g) => ({
      title: g.title,
      category: g.category,
      description: g.description,
      startDate: g.startDate,
      deadline: g.deadline,
      status: g.status,
      color: g.color,
      requiredItems: g.requiredItems,
      manualProgress: g.manualProgress,
      items: g.items.map((i) => ({ key: i.id, title: i.title, kind: i.kind, target: i.target, current: i.current, unit: i.unit, period: i.period, due: i.due, done: i.done, trackingStart: i.trackingStart })),
      routines: g.routines.map((r) => ({
        title: r.title, freq: r.freq, days: r.days, intervalWeeks: r.intervalWeeks, monthDay: r.monthDay, time: r.time, duration: r.duration,
        startDate: r.startDate, endDate: r.endDate, reminderMinutes: r.reminderMinutes, itemKey: r.itemId || undefined,
      })),
      evidence: g.evidence.map((e) => ({ date: e.date, text: e.text, itemKey: e.itemId || undefined })),
    })),
  };
}

// -------------------------------------------------------------- review report

const pct = (v) => `${Math.round(v * 100)}%`;
const itDate = (s) => parseYmd(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DAY_NAMES = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

export function describeRoutine(r) {
  if (r.freq === 'weekly') {
    const days = r.days.map((d) => DAY_NAMES[d]).join(', ');
    return `${r.intervalWeeks > 1 ? `ogni ${r.intervalWeeks} settimane` : 'ogni settimana'} (${days}) alle ${r.time}, ${r.duration} min`;
  }
  const day = r.monthDay === -1 ? "l'ultimo giorno lavorativo" : `il giorno ${r.monthDay} (o il venerdì prima, se cade nel weekend)`;
  return `${r.freq === 'monthly' ? 'ogni mese' : "ogni trimestre (mar, giu, set, dic)"} ${day} alle ${r.time}, ${r.duration} min`;
}

function describeItem(i) {
  if (i.kind === 'check') return `${i.done ? '[x]' : '[ ]'} ${i.title}`;
  if (i.kind === 'number') return `${i.title}: ${i.current ?? 0}${i.unit ? ' ' + i.unit : ''}${i.target !== null ? ` / ${i.target}${i.unit ? ' ' + i.unit : ''}` : ''}`;
  if (i.period === 'total') return `${i.title}: ${i.count}${i.target ? ` / ${i.target}` : ''} evidenze`;
  const label = i.period === 'week' ? 'settimane' : 'trimestri';
  return `${i.title}: target raggiunto in ${i.periodsMet}/${i.periodsElapsed} ${label} trascorsi (${i.periodsTotal} in totale)`;
}

/** Markdown summary to bring to MidYear / Year-End reviews. */
export function goalsReport() {
  const goals = listGoals();
  const lines = [`# Report obiettivi`, '', `Generato il ${new Date().toLocaleDateString('it-IT')} da Calendary.`, ''];
  lines.push('| Obiettivo | Avanzamento | Atteso a oggi | Stato | Scadenza |', '|---|---|---|---|---|');
  for (const g of goals) {
    const state = { done: 'completato', behind: 'in ritardo', untracked: 'da aggiornare', on_track: 'in linea' }[g.pace];
    lines.push(`| ${g.title} | ${pct(g.progress)} | ${pct(g.expected)} | ${state} | ${itDate(g.deadline)} |`);
  }
  for (const g of goals) {
    lines.push('', `## ${g.title}`, '');
    if (g.category) lines.push(`- **Categoria:** ${g.category}`);
    lines.push(`- **Periodo:** ${itDate(g.startDate)} → ${itDate(g.deadline)}`, `- **Avanzamento:** ${pct(g.progress)} (atteso ${pct(g.expected)})`);
    if (g.requiredItems) lines.push(`- **Soglia:** almeno ${g.requiredItems} misure su ${g.items.length}`);
    if (g.items.length) {
      lines.push('', '### Misure', '');
      for (const i of g.items) lines.push(`- ${describeItem(i)}`);
    }
    if (g.routines.length) {
      lines.push('', '### Routine', '');
      for (const r of g.routines) {
        lines.push(`- ${r.title} — ${describeRoutine(r)}; completata ${r.stats.done}/${r.stats.occurred} volte`);
      }
    }
    if (g.evidence.length) {
      lines.push('', '### Evidenze', '');
      const byItem = new Map(g.items.map((i) => [i.id, i.title]));
      for (const e of [...g.evidence].reverse()) {
        const tag = e.itemId && byItem.has(e.itemId) ? ` _(${byItem.get(e.itemId)})_` : '';
        lines.push(`- ${itDate(e.date)} — ${e.text.replace(/\n+/g, ' ')}${tag}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

/** Compact version for the assistant. */
export function goalsForAssistant() {
  return listGoals().map((g) => ({
    id: g.id,
    title: g.title,
    deadline: g.deadline,
    progress: pct(g.progress),
    expected: pct(g.expected),
    pace: g.pace,
    measures: g.items.map((i) => ({ id: i.id, text: describeItem(i) })),
    routines: g.routines.map((r) => `${r.title} — ${describeRoutine(r)}`),
    evidenceCount: g.evidence.length,
  }));
}
