// The only place where the trips module touches the calendar (spec §3, §6): legs and timed activities become events
// with planId "trip:<id>"; edits of those events in the calendar come back to the trip; "Alexa in silenzio" keeps a
// travel-mode period. When trips become their own app this file turns into a client of the suite API (like Moveo).
import { getSetting } from '../db.js';
import * as store from '../store.js';
import { setTripPeriod } from '../travel.js';
import { localStamp } from '../util.js';
import * as trips from './trips.js';
import { MODES, TAGS } from './vocab.js';

let writing = false; // true while this module writes events: their change notifications are ours, not the user's

const planId = (tripId) => `trip:${tripId}`;

export const legTitle = (leg) => {
  const route = [leg.from, leg.to].filter(Boolean).join(' → ');
  return [MODES[leg.mode]?.emoji, leg.code, route].filter(Boolean).join(' ');
};

export const activityTitle = (a) => `${TAGS[a.tag]?.emoji || TAGS.other.emoji} ${a.title}`;

/** "🍽️ Cena al porto" → "Cena al porto" (any leading emoji, as the user may have typed another one). Digits stay:
 * Emoji_Component would also match "3" in "3 musei". */
const stripEmoji = (title) => String(title || '').replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍|\s)+/u, '').trim();

function calendarId() {
  const id = getSetting('trips_calendar_id');
  const cal = id ? store.getCalendar(id) : null;
  return cal && cal.type === 'local' ? cal.id : store.firstLocalCalendarId();
}

const link = (tripId) => ({ linkUrl: `/viaggi/${tripId}`, linkLabel: 'Apri il viaggio' });

function legEvent(leg) {
  const description = [leg.booking && `Prenotazione: ${leg.booking}`, leg.notes].filter(Boolean).join('\n');
  return { title: legTitle(leg), start: leg.departAt, end: leg.arriveAt, location: leg.from, description, allDay: false, ...link(leg.tripId) };
}

function activityEvent(a) {
  const start = new Date(`${a.day}T${a.time}`); // local time (TZ is the configured timezone)
  const end = new Date(start.getTime() + a.minutes * 60e3);
  return { title: activityTitle(a), start: start.toISOString(), end: end.toISOString(), location: a.place, description: a.notes, allDay: false, ...link(a.tripId) };
}

function write(fn) {
  const was = writing; // re-entrant: a trip update inside a calendar edit writes events too
  writing = true;
  try {
    return fn();
  } finally {
    writing = was;
  }
}

/** Creates or updates the event of a leg/activity, or removes it when `data` is null. */
function upsert(kind, row, data) {
  write(() => {
    const existing = row.eventId ? store.getEvent(row.eventId) : null;
    if (!data) {
      if (existing) store.deleteEvent(existing.id);
      if (row.eventId) trips.setEventId(kind, row.id, null);
      return;
    }
    if (existing) {
      store.updateEvent(existing.id, data);
      return;
    }
    const ev = store.createEvent({ ...data, calendarId: calendarId() }, { source: 'trip', planId: planId(row.tripId) });
    trips.setEventId(kind, row.id, ev.id);
  });
}

const syncLeg = (leg) => upsert('leg', leg, legEvent(leg));
const syncActivity = (a) => upsert('activity', a, a.day && a.time ? activityEvent(a) : null);

function syncPeriod(trip) {
  setTripPeriod(trip.id, trip.quietAlexa ? { startDate: trip.startDate, endDate: trip.endDate, note: `Viaggio: ${trip.name}` } : null);
}

function onTripsChange({ type, before, after }) {
  switch (type) {
    case 'trip:create':
      syncPeriod(after);
      break;
    case 'trip:update':
      syncPeriod(after);
      for (const leg of after.legs) syncLeg(leg);
      for (const a of after.activities) syncActivity(a);
      break;
    case 'trip:delete':
      write(() => store.deletePlan(planId(before.id)));
      setTripPeriod(before.id, null);
      break;
    case 'leg:create':
    case 'leg:update':
      syncLeg(after);
      break;
    case 'leg:delete':
      upsert('leg', before, null);
      break;
    case 'activity:create':
    case 'activity:update':
      syncActivity(after);
      break;
    case 'activity:delete':
      upsert('activity', before, null);
      break;
    default:
  }
}

/** An event of a trip changed in the calendar: the trip follows; if the change can't apply, the event goes back. */
function onCalendarChange({ type, before, after }) {
  if (writing || !before?.planId?.startsWith('trip:')) return;
  const found = trips.findByEvent(before.id);
  if (!found) return;
  const { kind, row } = found;
  if (type === 'delete') {
    write(() => (kind === 'leg' ? trips.deleteLeg(row.id) : trips.deleteActivity(row.id)));
    return;
  }
  try {
    write(() => {
      if (kind === 'leg') {
        trips.updateLeg(row.id, { departAt: after.start, arriveAt: after.end });
      } else {
        const stamp = localStamp(after.start);
        trips.updateActivity(row.id, {
          title: stripEmoji(after.title) || row.title,
          day: stamp.slice(0, 10),
          time: stamp.slice(11, 16),
          minutes: Math.max(5, Math.round((Date.parse(after.end) - Date.parse(after.start)) / 60e3)),
          place: after.location || '',
        });
      }
    });
  } catch {
    // e.g. moved outside the trip's dates: the trip wins
  }
  // the event shows what the trip now says (the user's emoji is replaced by the tag's, times follow the rules)
  if (kind === 'leg') syncLeg(trips.getLeg(row.id));
  else syncActivity(trips.getActivity(row.id));
}

let installed = false;
export function installTripCalendar() {
  if (installed) return;
  installed = true;
  trips.setTripsSync(onTripsChange);
  store.onEventChange(onCalendarChange);
}
