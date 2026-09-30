import { db } from './db.js';
import { goalCalendarEntries } from './goals.js';
import { expandCalendar } from './ics.js';
import { listLocalEvents } from './store.js';
import { httpError, toIso } from './util.js';

const MAX_RANGE_MS = 400 * 86400e3;

/** Merged agenda: internal events + every enabled iCal calendar + goal routines/milestones, sorted by start. */
export function getAllEvents(from, to) {
  const fromIso = toIso(from, 'from');
  const toIsoStr = toIso(to, 'to');
  if (Date.parse(toIsoStr) - Date.parse(fromIso) > MAX_RANGE_MS) throw httpError(400, 'Intervallo troppo ampio');
  const local = listLocalEvents(fromIso, toIsoStr);
  const icsCals = db.prepare("SELECT id, name, color, reminder_minutes FROM calendars WHERE type = 'ics' AND enabled = 1").all();
  const external = icsCals.flatMap((cal) => expandCalendar(cal, fromIso, toIsoStr));
  const goals = goalCalendarEntries(fromIso, toIsoStr);
  return [...local, ...external, ...goals].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/**
 * Minutes before start at which to notify, or null for "no reminder".
 * Explicit event reminder > important flag (30 min default) > calendar default.
 */
export function effectiveReminder(ev) {
  if (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined) return ev.reminderMinutes;
  if (ev.important) return 30;
  if (ev.calendarReminder !== null && ev.calendarReminder !== undefined) return ev.calendarReminder;
  return null;
}
