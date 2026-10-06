import ICAL from 'ical.js';
import IcalExpander from 'ical-expander';
import { db } from './db.js';
import { config } from './config.js';
import { getCalendar, getIcsData } from './store.js';
import { broadcast } from './stream.js';
import { nowIso, stripHtml } from './util.js';

/** Parsed calendars, keyed by calendar id. Invalidated on every sync. */
const expanders = new Map();

function parse(ics) {
  // maxIterations 0 = unlimited; between() always gets an upper bound so iteration stops there.
  const expander = new IcalExpander({ ics, maxIterations: 0 });
  // ical-expander only knows IANA zones: register the VTIMEZONEs shipped inside the file
  // (Outlook uses Windows names like "W. Europe Standard Time") before any date is decoded.
  for (const vtz of expander.component.getAllSubcomponents('vtimezone')) {
    const tzid = vtz.getFirstPropertyValue('tzid');
    if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tzid, new ICAL.Timezone(vtz));
  }
  expander.events = expander.events.filter((evt) => {
    try {
      evt.startDate.toJSDate();
      evt.endDate.toJSDate();
      return true;
    } catch {
      return false;
    }
  });
  return expander;
}

function getExpander(calendarId) {
  if (expanders.has(calendarId)) return expanders.get(calendarId);
  const ics = getIcsData(calendarId);
  let expander = null;
  if (ics) {
    try {
      expander = parse(ics);
    } catch (err) {
      console.error(`Calendario ${calendarId}: parsing fallito`, err.message);
    }
  }
  expanders.set(calendarId, expander);
  return expander;
}

export async function syncCalendar(id) {
  const cal = getCalendar(id);
  if (!cal || cal.type !== 'ics') return { changed: false };
  try {
    const res = await fetch(cal.url, {
      headers: { 'user-agent': 'Hubitat/0.11 (+ical sync)', accept: 'text/calendar, text/plain, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Il server ha risposto HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Il link non restituisce un calendario iCal (.ics) valido');
    const expander = parse(text);
    const previous = getIcsData(id);
    db.prepare('UPDATE calendars SET ics_data = ?, last_sync = ?, last_error = NULL WHERE id = ?').run(text, nowIso(), id);
    expanders.set(id, expander);
    return { changed: previous !== text };
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'Timeout durante il download del calendario' : String(err.message || err);
    db.prepare('UPDATE calendars SET last_error = ?, last_sync = ? WHERE id = ?').run(message, nowIso(), id);
    return { changed: false, error: message };
  }
}

export function forgetCalendar(id) {
  expanders.delete(id);
}

export async function syncAll() {
  const rows = db.prepare("SELECT id FROM calendars WHERE type = 'ics' AND enabled = 1").all();
  let changed = false;
  for (const { id } of rows) {
    const r = await syncCalendar(id);
    changed = changed || r.changed;
  }
  if (changed) broadcast('events');
}

export function startIcsSync() {
  setTimeout(() => syncAll().catch((e) => console.error('Sync iCal fallita', e)), 5_000);
  setInterval(() => syncAll().catch((e) => console.error('Sync iCal fallita', e)), config.icsSyncMinutes * 60_000);
}

function toEvent(cal, item, startDate, endDate) {
  const status = item.component.getFirstPropertyValue('status');
  if (status && String(status).toUpperCase() === 'CANCELLED') return null;
  const allDay = !!startDate.isDate;
  const start = startDate.toJSDate();
  let end = endDate ? endDate.toJSDate() : null;
  if (!end || end < start) end = new Date(start.getTime() + (allDay ? 86400e3 : 0));
  if (allDay && end.getTime() === start.getTime()) end = new Date(start.getTime() + 86400e3);
  const transp = item.component.getFirstPropertyValue('transp');
  return {
    id: `ics:${cal.id}:${item.uid}:${start.toISOString()}`,
    calendarId: cal.id,
    calendarName: cal.name,
    color: cal.color,
    title: item.summary || '(senza titolo)',
    description: stripHtml(item.description),
    location: item.location || '',
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    important: false,
    reminderMinutes: null,
    calendarReminder: cal.reminder_minutes,
    readOnly: true,
    busy: !transp || String(transp).toUpperCase() !== 'TRANSPARENT',
    source: 'ics',
    planId: null,
  };
}

export function expandCalendar(cal, fromIso, toIso) {
  const expander = getExpander(cal.id);
  if (!expander) return [];
  let result;
  try {
    result = expander.between(new Date(fromIso), new Date(toIso));
  } catch (err) {
    console.error(`Calendario ${cal.name}: espansione fallita`, err.message);
    return [];
  }
  const out = [];
  for (const ev of result.events) {
    const e = toEvent(cal, ev, ev.startDate, ev.endDate);
    if (e) out.push(e);
  }
  for (const occ of result.occurrences) {
    const e = toEvent(cal, occ.item, occ.startDate, occ.endDate);
    if (e) out.push(e);
  }
  return out;
}
