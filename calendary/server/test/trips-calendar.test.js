// Trips module: legs and timed activities as calendar events (planId trip:<id>), edits coming back from the
// calendar, the travel mode ("Alexa in silenzio") bound to the trip.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-trips-cal-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';

const store = await import('../src/store.js');
const travel = await import('../src/travel.js');
const trips = await import('../src/trips/trips.js');
const { installTripCalendar } = await import('../src/trips/calendar-port.js');
const { db } = await import('../src/db.js');
store.ensureDefaultCalendars();
installTripCalendar();
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const local = (s) => new Date(s).toISOString();
const planEvents = (tripId) => db.prepare('SELECT id FROM events WHERE plan_id = ?').all(`trip:${tripId}`).map((r) => store.getEvent(r.id));
const sardegna = (extra = {}) => trips.createTrip({ name: 'Sardegna', startDate: '2026-11-02', endDate: '2026-11-06', ...extra });
const flight = (t, extra = {}) => trips.addLeg(t.id, { mode: 'plane', from: 'Pisa', to: 'Cagliari', departAt: local('2026-11-02T10:30'), arriveAt: local('2026-11-02T11:40'), code: 'FR1234', booking: 'ABC123', ...extra });

test('una tratta diventa un evento', () => {
  const t = sardegna();
  const leg = flight(t);
  const ev = store.getEvent(trips.getLeg(leg.id).eventId);
  assert.equal(ev.title, '✈️ FR1234 Pisa → Cagliari');
  assert.equal(ev.planId, `trip:${t.id}`);
  assert.equal(ev.source, 'trip');
  assert.equal(ev.linkUrl, `/viaggi/${t.id}`);
  assert.equal(ev.linkLabel, 'Apri il viaggio');
  assert.equal(ev.location, 'Pisa');
  assert.equal(ev.start, leg.departAt);
  assert.equal(ev.end, leg.arriveAt);
  assert.match(ev.description, /Prenotazione: ABC123/);
  const noCode = trips.addLeg(t.id, { mode: 'train', from: 'Cagliari', to: 'Oristano', departAt: local('2026-11-04T09:00'), arriveAt: local('2026-11-04T10:00') });
  assert.equal(store.getEvent(trips.getLeg(noCode.id).eventId).title, '🚆 Cagliari → Oristano');
});

test('attività con orario → evento di 120 min; senza orario nessun evento; togliere l\'orario elimina l\'evento', () => {
  const t = sardegna();
  const dinner = trips.addActivity(t.id, { day: '2026-11-03', tag: 'dinner', title: 'Cena da Su Gologone', time: '20:30', place: 'Oliena' });
  const ev = store.getEvent(trips.getActivity(dinner.id).eventId);
  assert.equal(ev.title, '🍽️ Cena da Su Gologone');
  assert.equal(ev.start, local('2026-11-03T20:30'));
  assert.equal(ev.end, local('2026-11-03T22:30'));
  assert.equal(ev.location, 'Oliena');
  const beach = trips.addActivity(t.id, { day: '2026-11-04', tag: 'beach', title: 'Poetto' });
  assert.equal(trips.getActivity(beach.id).eventId, null);
  trips.updateActivity(dinner.id, { time: '' });
  assert.equal(trips.getActivity(dinner.id).eventId, null);
  assert.equal(store.getEvent(ev.id), null);
  assert.equal(planEvents(t.id).length, 0);
});

test('modifiche al viaggio aggiornano l\'evento; eliminare la tratta elimina l\'evento', () => {
  const t = sardegna();
  const leg = flight(t);
  const evId = trips.getLeg(leg.id).eventId;
  trips.updateLeg(leg.id, { departAt: local('2026-11-02T12:00'), arriveAt: local('2026-11-02T13:10') });
  assert.equal(trips.getLeg(leg.id).eventId, evId);
  assert.equal(store.getEvent(evId).start, local('2026-11-02T12:00'));
  trips.deleteLeg(leg.id);
  assert.equal(store.getEvent(evId), null);
});

test('modifica dal calendario torna al viaggio, senza cicli', () => {
  const t = sardegna();
  const dinner = trips.addActivity(t.id, { day: '2026-11-03', tag: 'dinner', title: 'Cena', time: '20:30' });
  const evId = trips.getActivity(dinner.id).eventId;
  store.updateEvent(evId, { title: '🍽️ Cena al porto', start: local('2026-11-04T20:00'), end: local('2026-11-04T21:30'), location: 'Porto' });
  const a = trips.getActivity(dinner.id);
  assert.equal(a.title, 'Cena al porto');
  assert.equal(a.day, '2026-11-04');
  assert.equal(a.time, '20:00');
  assert.equal(a.minutes, 90);
  assert.equal(a.place, 'Porto');
  assert.equal(a.eventId, evId);
  assert.equal(planEvents(t.id).length, 1);
  assert.equal(store.getEvent(evId).title, '🍽️ Cena al porto');
  // a leg moved in the calendar keeps its route, takes the new times
  const leg = flight(t);
  const legEv = trips.getLeg(leg.id).eventId;
  store.updateEvent(legEv, { start: local('2026-11-02T11:00'), end: local('2026-11-02T12:10') });
  assert.equal(trips.getLeg(leg.id).departAt, local('2026-11-02T11:00'));
  assert.equal(store.getEvent(legEv).title, '✈️ FR1234 Pisa → Cagliari');
  // moved outside the trip: the event goes back where the trip says
  store.updateEvent(evId, { start: local('2026-12-01T20:00'), end: local('2026-12-01T21:00') });
  assert.equal(trips.getActivity(dinner.id).day, '2026-11-04');
  assert.equal(store.getEvent(evId).start, local('2026-11-04T20:00'));
  // deleted in the calendar: the activity goes too
  store.deleteEvent(evId);
  assert.throws(() => trips.getActivity(dinner.id), (e) => e.statusCode === 404);
});

test('cambio date → attività da riprogrammare perde l\'evento', () => {
  const t = sardegna();
  const act = trips.addActivity(t.id, { day: '2026-11-06', tag: 'city', title: 'Ultimo giro', time: '10:00' });
  const evId = trips.getActivity(act.id).eventId;
  trips.updateTrip(t.id, { endDate: '2026-11-05' });
  assert.equal(trips.getActivity(act.id).eventId, null);
  assert.equal(store.getEvent(evId), null);
});

test('un evento scomparso viene ricreato al salvataggio successivo', () => {
  const t = sardegna();
  const leg = flight(t);
  store.deletePlan(`trip:${t.id}`); // bulk delete: no listener
  trips.updateLeg(leg.id, { notes: 'posto finestrino' });
  const ev = store.getEvent(trips.getLeg(leg.id).eventId);
  assert.ok(ev);
  assert.match(ev.description, /posto finestrino/);
});

test('Alexa in silenzio: periodo di modalità viaggio legato al viaggio; eliminare il viaggio pulisce tutto', () => {
  const t = sardegna({ quietAlexa: true });
  flight(t);
  trips.addActivity(t.id, { day: '2026-11-03', tag: 'dinner', title: 'Cena', time: '20:30' });
  const p = travel.travelPeriodAt(local('2026-11-03T12:00'));
  assert.ok(p);
  assert.equal(p.tripId, t.id);
  assert.equal(p.startDate, '2026-11-02');
  trips.updateTrip(t.id, { endDate: '2026-11-08' });
  assert.ok(travel.travelPeriodAt(local('2026-11-08T12:00')));
  trips.updateTrip(t.id, { quietAlexa: false });
  assert.equal(travel.travelPeriodAt(local('2026-11-03T12:00')), null);
  trips.updateTrip(t.id, { quietAlexa: true });
  trips.deleteTrip(t.id);
  assert.equal(travel.travelPeriodAt(local('2026-11-03T12:00')), null);
  assert.equal(planEvents(t.id).length, 0);
});

test('i periodi di modalità viaggio manuali funzionano ancora', () => {
  const p = travel.createTravelPeriod({ startDate: '2099-01-01', endDate: '2099-01-03', note: 'x' });
  assert.equal(p.tripId, null);
  assert.ok(travel.listTravelPeriods().some((x) => x.id === p.id));
  travel.deleteTravelPeriod(p.id);
});

test('il calendario dei viaggi si può scegliere', () => {
  const cal = store.createCalendar({ name: 'Viaggi', color: '#38bdf8', type: 'local' });
  const { setSetting } = { setSetting: (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v) };
  setSetting('trips_calendar_id', cal.id);
  const t = sardegna();
  const leg = flight(t);
  assert.equal(store.getEvent(trips.getLeg(leg.id).eventId).calendarId, cal.id);
  setSetting('trips_calendar_id', 'sparito');
  const leg2 = trips.addLeg(t.id, { mode: 'bus', from: 'A', to: 'B', departAt: local('2026-11-03T09:00'), arriveAt: local('2026-11-03T10:00') });
  assert.equal(store.getEvent(trips.getLeg(leg2.id).eventId).calendarId, store.firstLocalCalendarId());
});
