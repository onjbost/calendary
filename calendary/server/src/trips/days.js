// Day strips (spec §6): each day of a trip shows "In viaggio · Cagliari · 3/5" in the calendar instead of an event
// as long as the trip. Computed on request, never stored; dates are local calendar days (DST-safe).
import { db } from './db.js';
import { TRIP_COLOR } from './vocab.js';
import { addDays, parseYmd, ymd } from '../util.js';

/** The emoji of the days in between: what the programme says the trip is about. */
function middleEmoji(tripId) {
  const tags = new Set(db.prepare('SELECT DISTINCT tag FROM trip_activities WHERE trip_id = ?').all(tripId).map((r) => r.tag));
  if (tags.has('beach')) return '🏖️';
  if (tags.has('hiking')) return '⛰️';
  if (tags.has('work')) return '💼';
  return '🌴';
}

function daysBetween(from, to) {
  const out = [];
  for (let d = parseYmd(from); ymd(d) <= to; d = addDays(d, 1)) out.push(ymd(d));
  return out;
}

/** Strips for the days from..to (YYYY-MM-DD, both included), ordered by date then by trip start. */
export function tripDays(from, to) {
  const rows = db.prepare(`SELECT id, name, place_name, start_date, end_date FROM trips
    WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, created_at`).all(to, from);
  const out = [];
  for (const t of rows) {
    const all = daysBetween(t.start_date, t.end_date);
    const name = t.place_name || t.name;
    const middle = middleEmoji(t.id);
    all.forEach((date, i) => {
      if (date < from || date > to) return;
      const total = all.length;
      const kind = total === 1 ? 'single' : i === 0 ? 'start' : i === total - 1 ? 'end' : 'middle';
      const label = { single: `Gita · ${name}`, start: `Si parte · ${name}`, end: `Rientro da ${name}`, middle: `In viaggio · ${name} · ${i + 1}/${total}` }[kind];
      const emoji = { single: '🧳', start: '🧳', end: '🏠', middle }[kind];
      out.push({ date, tripId: t.id, name, label, emoji, color: TRIP_COLOR, kind, index: i + 1, total });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)); // stable: trips keep their start order within a date
}

/** One line for the morning summary, or null when no trip touches that day. */
export function tripDaySummary(date) {
  const d = tripDays(date, date)[0];
  if (!d) return null;
  if (d.kind === 'start' || d.kind === 'single') return `Oggi parti per ${d.name}.`;
  if (d.kind === 'end') return `Oggi rientri da ${d.name}.`;
  return `Oggi sei in viaggio a ${d.name}, giorno ${d.index} di ${d.total}.`;
}
