import crypto from 'node:crypto';
import { getAllEvents } from './agenda.js';
import { firstLocalCalendarId, getCalendar } from './store.js';
import { addDays, clamp, fmtDay, httpError, isYmd, parseYmd, startOfDay, str } from './util.js';

const MIN = 60_000;
const SLOT = 15; // minutes granularity

const DEFAULT_WEEKDAY = [{ from: '18:00', to: '21:00' }];
const DEFAULT_WEEKEND = [{ from: '09:30', to: '12:30' }, { from: '15:00', to: '18:00' }];

function hm(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

function normWindows(list, fallback) {
  if (!Array.isArray(list) || !list.length) list = fallback;
  const out = [];
  for (const w of list) {
    const from = hm(w?.from);
    const to = hm(w?.to);
    if (from !== null && to !== null && to - from >= 30) out.push({ from, to });
  }
  return out.length ? out : normWindows(fallback, fallback);
}

function atMinutes(day, minutes) {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return d.getTime();
}

/** Remove [bs, be) from a sorted list of [start, end) intervals. */
function subtract(intervals, bs, be) {
  const out = [];
  for (const [s, e] of intervals) {
    if (be <= s || bs >= e) {
      out.push([s, e]);
      continue;
    }
    if (bs > s) out.push([s, bs]);
    if (be < e) out.push([be, e]);
  }
  return out;
}

const roundUp = (ms) => Math.ceil(ms / (SLOT * MIN)) * SLOT * MIN;
const roundSlot = (minutes) => Math.max(SLOT, Math.round(minutes / SLOT) * SLOT);

function splitChunk(c) {
  const a = roundSlot(c.minutes / 2);
  return [{ ...c, minutes: a }, { ...c, minutes: c.minutes - a }];
}

function place(dayList, chunks, { spread, breakMin, maxPerDay }) {
  const used = dayList.map(() => 0);
  const queue = chunks.map((c) => ({ ...c }));
  const placed = [];
  let prevDay = 0;
  let prevEnd = 0;
  const D = dayList.length;

  for (let j = 0; j < queue.length; j++) {
    const c = queue[j];
    // Spread mode: chunk j ideally lands around day j * D / N, so sessions are evenly distributed.
    const ideal = spread ? Math.floor((j * D) / queue.length) : 0;
    let slot = null;
    let dayIndex = -1;
    for (let di = Math.max(ideal, prevDay); di < D && !slot; di++) {
      if (used[di] + c.minutes > maxPerDay) continue;
      const minStart = di === prevDay && prevEnd ? prevEnd + breakMin * MIN : 0;
      for (const [s, e] of dayList[di].free) {
        const st = Math.max(s, minStart);
        if (e - st >= c.minutes * MIN) {
          slot = [st, st + c.minutes * MIN];
          dayIndex = di;
          break;
        }
      }
    }
    if (!slot) {
      // Too long for any free window: split it in two and retry.
      if (c.minutes >= 60) {
        queue.splice(j, 1, ...splitChunk(c));
        j -= 1;
        continue;
      }
      break; // keep module order: nothing after this can be placed either
    }
    used[dayIndex] += c.minutes;
    placed.push({ ...c, start: slot[0], end: slot[1] });
    prevDay = dayIndex;
    prevEnd = slot[1];
  }
  return { placed, total: queue.reduce((s, c) => s + c.minutes, 0) };
}

/**
 * Build a study plan: split modules into sessions and place them in free time windows
 * before the deadline, avoiding everything already in the calendar.
 * Returns a proposal (nothing is written until the user approves it).
 */
export function planStudy(input = {}) {
  const title = str(input.title, 120) || 'Studio';
  const modules = (Array.isArray(input.modules) ? input.modules : [])
    .map((m, i) => ({ name: str(m?.name, 120) || `Modulo ${i + 1}`, hours: Number(m?.hours) }))
    .filter((m) => Number.isFinite(m.hours) && m.hours > 0);
  if (!modules.length) throw httpError(400, 'Serve almeno un modulo con un numero di ore maggiore di zero');
  if (!isYmd(input.deadline)) throw httpError(400, 'Serve la data di scadenza (AAAA-MM-GG)');

  const sessionMax = roundSlot(clamp(Number(input.sessionMaxHours) || 2, 0.5, 8) * 60);
  const maxPerDay = roundSlot(clamp(Number(input.maxHoursPerDay) || 3, 0.5, 12) * 60);
  const breakMin = clamp(Number(input.breakMinutes ?? 15) || 0, 0, 120);
  const bufferDays = clamp(Math.round(Number(input.bufferDays ?? 1)), 0, 60);
  const days = Array.isArray(input.days) && input.days.length
    ? input.days.map(Number).filter((d) => d >= 0 && d <= 6)
    : [1, 2, 3, 4, 5, 6];
  const weekdayWindows = normWindows(input.weekdayWindows, DEFAULT_WEEKDAY);
  const weekendWindows = normWindows(input.weekendWindows, DEFAULT_WEEKEND);
  const calendarId = input.calendarId && getCalendar(input.calendarId)?.type === 'local' ? input.calendarId : firstLocalCalendarId();
  const reminderMinutes = input.reminderMinutes === null ? null : clamp(Number(input.reminderMinutes ?? 15) || 0, 0, 1440);
  const important = !!input.important;

  const now = new Date();
  const today = startOfDay(now);
  const deadline = parseYmd(input.deadline);
  let first = isYmd(input.startDate) ? parseYmd(input.startDate) : today;
  if (first < today) first = today;
  const lastDay = addDays(deadline, -bufferDays);
  if (lastDay < first) {
    throw httpError(400, bufferDays
      ? `La scadenza è troppo vicina: con ${bufferDays} giorno/i di margine non resta tempo. Riduci il margine o sposta la scadenza.`
      : 'La scadenza è già passata.');
  }

  // Sessions: every module is split into sessions of at most sessionMax minutes.
  const chunks = [];
  modules.forEach((m, mi) => {
    const total = roundSlot(m.hours * 60);
    const n = Math.ceil(total / sessionMax);
    const base = Math.floor(total / n / SLOT) * SLOT;
    let rest = total - base * n;
    for (let k = 0; k < n; k++) {
      const extra = rest > 0 ? Math.min(SLOT, rest) : 0;
      rest -= extra;
      chunks.push({ mi, minutes: base + extra });
    }
  });
  if (input.finalReview) chunks.push({ mi: -1, minutes: Math.min(sessionMax, 60) });

  // Free time per day = study windows - busy events (all calendars).
  const busy = getAllEvents(first, addDays(lastDay, 1))
    .filter((e) => !e.allDay && e.busy !== false)
    .map((e) => [Date.parse(e.start), Date.parse(e.end)]);
  const earliestToday = roundUp(now.getTime() + 30 * MIN);

  const dayList = [];
  for (let d = new Date(first); d <= lastDay; d = addDays(d, 1)) {
    if (!days.includes(d.getDay())) continue;
    const wins = d.getDay() === 0 || d.getDay() === 6 ? weekendWindows : weekdayWindows;
    let free = [];
    for (const w of wins) {
      let s = atMinutes(d, w.from);
      const e = atMinutes(d, w.to);
      if (d.getTime() === today.getTime()) s = Math.max(s, earliestToday);
      if (e - s >= 30 * MIN) free.push([s, e]);
    }
    for (const [bs, be] of busy) free = subtract(free, bs, be);
    free = free.filter(([s, e]) => e - s >= 30 * MIN).sort((a, b) => a[0] - b[0]);
    const freeMin = free.reduce((sum, [s, e]) => sum + (e - s) / MIN, 0);
    if (freeMin >= 30) dayList.push({ date: d, free, capacity: Math.min(freeMin, maxPerDay) });
  }

  const opts = { breakMin, maxPerDay };
  const spread = place(dayList, chunks, { ...opts, spread: true });
  const greedy = spread.placed.length < spread.total ? place(dayList, chunks, { ...opts, spread: false }) : null;
  const best = greedy && sumMinutes(greedy.placed) > sumMinutes(spread.placed) ? greedy : spread;

  const neededMin = chunks.reduce((s, c) => s + c.minutes, 0);
  const placedMin = sumMinutes(best.placed);
  const capacityMin = dayList.reduce((s, d) => s + d.capacity, 0);
  const warnings = [];
  if (placedMin < neededMin) {
    const missing = (neededMin - placedMin) / 60;
    warnings.push(`Non c'è abbastanza tempo libero: mancano ${fmtHours(missing)} di studio. Amplia le fasce orarie, aumenta le ore massime al giorno, aggiungi giorni o anticipa l'inizio.`);
  } else if (capacityMin && neededMin / capacityMin > 0.85) {
    warnings.push('Il piano è molto denso: quasi tutto il tempo libero disponibile è occupato dallo studio.');
  }

  // Titles: number sessions per module ("parte 2/3").
  const perModule = new Map();
  for (const p of best.placed) perModule.set(p.mi, (perModule.get(p.mi) || 0) + 1);
  const counter = new Map();
  const deadlineLabel = deadline.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const planId = crypto.randomUUID();

  const items = best.placed.map((p) => {
    const idx = (counter.get(p.mi) || 0) + 1;
    counter.set(p.mi, idx);
    const n = perModule.get(p.mi);
    const moduleName = p.mi === -1 ? 'Ripasso finale' : modules[p.mi].name;
    const part = n > 1 ? ` (${idx}/${n})` : '';
    return {
      title: `${title} · ${moduleName}${part}`,
      start: new Date(p.start).toISOString(),
      end: new Date(p.end).toISOString(),
      allDay: false,
      calendarId,
      important,
      reminderMinutes,
      description: `Piano di studio "${title}"\n${moduleName}${part} — ${p.minutes} minuti\nScadenza: ${deadlineLabel}`,
      location: '',
    };
  });

  const summary = items.length
    ? `${items.length} sessioni per ${fmtHours(placedMin / 60)} totali, dal ${fmtDay(items[0].start)} al ${fmtDay(items.at(-1).start)} (scadenza ${deadlineLabel}).`
    : 'Nessuna sessione pianificabile con questi vincoli.';

  return {
    id: crypto.randomUUID(),
    kind: 'events',
    planId,
    title: `Piano di studio: ${title}`,
    summary,
    warnings,
    items,
  };
}

function sumMinutes(placed) {
  return placed.reduce((s, p) => s + p.minutes, 0);
}

function fmtHours(h) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  if (!whole) return `${min} min`;
  return min ? `${whole} h ${min} min` : `${whole} ${whole === 1 ? 'ora' : 'ore'}`;
}
