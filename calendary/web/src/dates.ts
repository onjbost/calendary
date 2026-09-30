import {
  addDays,
  differenceInMinutes,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { it } from 'date-fns/locale';
import type { CalEvent } from './api';

export const WEEK = { weekStartsOn: 1 as const, locale: it };

export const fmt = (d: Date | string | number, pattern: string) => format(new Date(d), pattern, { locale: it });
export const ymd = (d: Date | string | number) => format(new Date(d), 'yyyy-MM-dd');
export const hm = (d: Date | string | number) => format(new Date(d), 'HH:mm');

export function parseYmd(s: string | null | undefined): Date {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return startOfDay(new Date());
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function monthGrid(anchor: Date) {
  const start = startOfWeek(startOfMonth(anchor), WEEK);
  const end = endOfWeek(endOfMonth(anchor), WEEK);
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  while (days.length < 42) days.push(addDays(days[days.length - 1], 1));
  return days;
}

export function weekDays(anchor: Date) {
  const start = startOfWeek(anchor, WEEK);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Events touching the given local day. All-day events use [start, end) semantics. */
export function eventsOnDay(events: CalEvent[], day: Date) {
  const s = startOfDay(day).getTime();
  const e = addDays(startOfDay(day), 1).getTime();
  return events.filter((ev) => {
    const es = Date.parse(ev.start);
    const ee = Date.parse(ev.end);
    if (ee === es) return es >= s && es < e;
    return es < e && ee > s;
  });
}

export interface PositionedEvent {
  ev: CalEvent;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
}

/** Lay out timed events of one day in side-by-side columns when they overlap. */
export function layoutDay(events: CalEvent[], day: Date): PositionedEvent[] {
  const dayStart = startOfDay(day);
  const items = events
    .filter((ev) => !ev.allDay)
    .map((ev) => {
      const startMin = Math.max(0, differenceInMinutes(new Date(ev.start), dayStart));
      const endMin = Math.min(24 * 60, Math.max(startMin + 20, differenceInMinutes(new Date(ev.end), dayStart)));
      return { ev, startMin, endMin, col: 0, cols: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let cluster: PositionedEvent[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    for (const item of cluster) {
      let c = colEnds.findIndex((end) => end <= item.startMin);
      if (c === -1) {
        c = colEnds.length;
        colEnds.push(item.endMin);
      } else colEnds[c] = item.endMin;
      item.col = c;
    }
    for (const item of cluster) item.cols = colEnds.length;
    cluster = [];
  };
  for (const item of items) {
    if (item.startMin >= clusterEnd && cluster.length) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return items;
}

export function timeRange(ev: CalEvent) {
  if (ev.allDay) return 'Tutto il giorno';
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  return isSameDay(s, e) ? `${hm(s)} – ${hm(e)}` : `${fmt(s, 'd MMM HH:mm')} – ${fmt(e, 'd MMM HH:mm')}`;
}

export function countdown(ms: number) {
  if (ms <= 0) return 'ora';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'domani' : `${d} giorni`;
}

export function effectiveReminder(ev: CalEvent) {
  if (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined) return ev.reminderMinutes;
  if (ev.important) return 30;
  return ev.calendarReminder ?? null;
}

export function greeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return 'Buonanotte';
  if (h < 13) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}
