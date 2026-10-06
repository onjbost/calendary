// Pure helpers of the trips pages (no React): dates, grouping, weather icons, day strips by date.
import type { Activity, Leg, Trip, TripDay } from './api';

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

export const parseDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDaysYmd = (ymd: string, n: number) => {
  const d = parseDay(ymd);
  d.setDate(d.getDate() + n);
  return toYmd(d);
};
export const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "2–6 nov", "30 ott – 3 nov", "28 dic 2026 – 2 gen 2027" */
export function dateRange(start: string, end: string) {
  const a = parseDay(start);
  const b = parseDay(end);
  const yearA = a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : '';
  const yearB = yearA ? ` ${b.getFullYear()}` : '';
  if (start === end) return `${a.getDate()} ${MONTHS[a.getMonth()]}`;
  if (a.getMonth() === b.getMonth() && !yearA) return `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]}${yearA} – ${b.getDate()} ${MONTHS[b.getMonth()]}${yearB}`;
}

/** "Lun 2 nov" */
export function dayLabel(ymd: string) {
  const d = parseDay(ymd);
  const w = WEEKDAYS[d.getDay()];
  return `${w[0].toUpperCase()}${w.slice(1)} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function tripDates(trip: Pick<Trip, 'startDate' | 'endDate'>) {
  const out: string[] = [];
  for (let d = trip.startDate; d <= trip.endDate; d = addDaysYmd(d, 1)) out.push(d);
  return out;
}

export type TripPhase = 'now' | 'next' | 'past';
export const phaseOf = (trip: Pick<Trip, 'startDate' | 'endDate'>, today: string): TripPhase =>
  trip.endDate < today ? 'past' : trip.startDate <= today ? 'now' : 'next';

/** In progress first, then upcoming (soonest first), then past (most recent first). */
export function groupTrips(trips: Trip[], today: string) {
  const now = trips.filter((t) => phaseOf(t, today) === 'now');
  const next = trips.filter((t) => phaseOf(t, today) === 'next').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = trips.filter((t) => phaseOf(t, today) === 'past').sort((a, b) => b.startDate.localeCompare(a.startDate));
  return { now, next, past };
}

export const daysUntil = (ymd: string, today: string) => Math.round((parseDay(ymd).getTime() - parseDay(today).getTime()) / 86400e3);

export function whenText(trip: Trip, today: string) {
  const phase = phaseOf(trip, today);
  if (phase === 'now') return `Giorno ${daysUntil(today, trip.startDate) + 1} di ${tripDates(trip).length}`;
  if (phase === 'past') return 'Concluso';
  const n = daysUntil(trip.startDate, today);
  return n === 1 ? 'Domani' : `Tra ${n} giorni`;
}

/** WMO weather code → emoji. */
export function weatherIcon(code: number | null, rainy = false) {
  if (code === null) return rainy ? '🌧️' : '🌡️';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  if (code >= 51) return '🌧️';
  return '🌡️';
}

export type ProgrammeItem = { kind: 'leg'; at: string; leg: Leg } | { kind: 'activity'; at: string; activity: Activity };

/** A day of the programme: legs leaving that day and the day's activities, timed ones in order, untimed at the end. */
export function programmeOf(trip: Trip, day: string): ProgrammeItem[] {
  const legs: ProgrammeItem[] = trip.legs.filter((l) => toYmd(new Date(l.departAt)) === day).map((leg) => ({ kind: 'leg', at: hhmm(leg.departAt), leg }));
  const acts: ProgrammeItem[] = trip.activities.filter((a) => a.day === day).map((activity) => ({ kind: 'activity', at: activity.time || '99:99', activity }));
  return [...legs, ...acts].sort((a, b) => a.at.localeCompare(b.at));
}

/** Legs leaving before the first day or after the last one (night trains, late returns): shown on the nearest day. */
export function outsideLegs(trip: Trip) {
  return {
    before: trip.legs.filter((l) => toYmd(new Date(l.departAt)) < trip.startDate),
    after: trip.legs.filter((l) => toYmd(new Date(l.departAt)) > trip.endDate),
  };
}

/** Day strips by date, each date's strips in the server's order (trip start). */
export function groupDaysByDate(days: TripDay[]) {
  const map = new Map<string, TripDay[]>();
  for (const d of days) map.set(d.date, [...(map.get(d.date) || []), d]);
  return map;
}

/** An event long enough to become a trip: at least two calendar days (all-day ends are exclusive). */
export function spansDays(e: { start: string; end: string; allDay: boolean }) {
  const first = toYmd(new Date(e.start));
  const last = toYmd(new Date(Date.parse(e.end) - (e.allDay ? 1 : 0)));
  return last > first;
}
