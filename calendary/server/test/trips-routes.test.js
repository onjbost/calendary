// Trips module: HTTP API (bare Fastify with the module's routes under /api, like index.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-trips-routes-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';

const store = await import('../src/store.js');
const { registerTripRoutes, installTripCalendar } = await import('../src/trips/index.js');
const { db } = await import('../src/db.js');
store.ensureDefaultCalendars();
installTripCalendar();

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.host === 'geocoding-api.open-meteo.com') {
    return new Response(JSON.stringify({ results: [{ name: 'Cagliari', admin1: 'Sardegna', country: 'Italia', latitude: 39.22, longitude: 9.11 }] }), { status: 200 });
  }
  throw new TypeError('fetch failed'); // no weather in these tests
};

const app = Fastify();
app.setErrorHandler((err, req, reply) => reply.code(err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message }));
await app.register(registerTripRoutes, { prefix: '/api' });
after(async () => { globalThis.fetch = realFetch; await app.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = async (method, url, payload) => {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const local = (s) => new Date(s).toISOString();

test('giro completo: crea, tratta, attività, strisce, elimina', async () => {
  const c = await call('POST', '/api/trips', { name: 'Sardegna', startDate: '2026-11-02', endDate: '2026-11-06', place: { name: 'Cagliari', country: 'Italia', lat: 39.22, lon: 9.11 } });
  assert.equal(c.status, 200);
  const id = c.body.id;
  const leg = await call('POST', `/api/trips/${id}/legs`, { mode: 'plane', from: 'Pisa', to: 'Cagliari', departAt: local('2026-11-02T10:30'), arriveAt: local('2026-11-02T11:40') });
  assert.equal(leg.status, 200);
  const act = await call('POST', `/api/trips/${id}/activities`, { day: '2026-11-03', tag: 'beach', title: 'Poetto', time: '10:00' });
  assert.equal(act.status, 200);
  const got = await call('GET', `/api/trips/${id}`);
  assert.equal(got.body.legs.length, 1);
  assert.equal(got.body.activities.length, 1);
  assert.equal((await call('PATCH', `/api/trips/legs/${leg.body.id}`, { notes: 'finestrino' })).body.notes, 'finestrino');
  assert.equal((await call('PATCH', `/api/trips/activities/${act.body.id}`, { title: 'Spiaggia' })).body.title, 'Spiaggia');
  const days = await call('GET', '/api/trips/days?from=2026-11-01&to=2026-11-07');
  assert.equal(days.body.length, 5);
  assert.equal(days.body[2].label, 'In viaggio · Cagliari · 3/5');
  assert.ok((await call('GET', '/api/trips')).body.some((t) => t.id === id));
  assert.equal((await call('DELETE', `/api/trips/activities/${act.body.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/trips/legs/${leg.body.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/trips/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/trips/${id}`)).status, 404);
});

test('errori: 404, date errate, strisce e geocode senza parametri', async () => {
  const nf = await call('GET', '/api/trips/sconosciuto');
  assert.equal(nf.status, 404);
  assert.match(nf.body.error, /Viaggio non trovato/);
  const bad = await call('POST', '/api/trips', { name: 'X', startDate: '2026-11-06', endDate: '2026-11-02' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /ritorno è prima/);
  assert.equal((await call('GET', '/api/trips/days?from=ieri&to=domani')).status, 400);
  assert.equal((await call('GET', '/api/trips/geocode')).status, 400);
  assert.equal((await call('GET', '/api/trips/geocode?q=Cagliari')).body[0].name, 'Cagliari');
});

test('trasforma in viaggio: evento locale di più giorni', async () => {
  const ev = store.createEvent({ title: 'Vacanza in Sardegna', start: local('2026-11-02T00:00'), end: local('2026-11-07T00:00'), allDay: true, location: 'Cagliari' });
  const r = await call('POST', '/api/trips/from-event', { eventId: ev.id, title: ev.title, start: ev.start, end: ev.end, allDay: true, location: ev.location });
  assert.equal(r.status, 200);
  assert.equal(r.body.eventDeletable, true);
  assert.equal(r.body.trip.name, 'Vacanza in Sardegna');
  assert.equal(r.body.trip.startDate, '2026-11-02');
  assert.equal(r.body.trip.endDate, '2026-11-06');
  assert.equal(r.body.trip.source, 'event');
  assert.equal(r.body.trip.place.name, 'Cagliari');
  // timed event over several days, from an iCal calendar: the trip is made, the event can't be deleted here
  const ics = await call('POST', '/api/trips/from-event', { eventId: 'ics:abc', title: 'Congresso', start: local('2026-12-01T09:00'), end: local('2026-12-03T18:00'), allDay: false, location: '' });
  assert.equal(ics.body.eventDeletable, false);
  assert.equal(ics.body.trip.endDate, '2026-12-03');
  assert.equal(ics.body.trip.place, null);
  // shorter than two days
  const short = await call('POST', '/api/trips/from-event', { eventId: 'x', title: 'Cena', start: local('2026-12-01T20:00'), end: local('2026-12-01T23:00'), allDay: false });
  assert.equal(short.status, 400);
});

test('impostazioni: calendario e orario della sera prima', async () => {
  const s = await call('GET', '/api/trips/settings');
  assert.equal(s.body.eveningTime, '20:00');
  assert.equal((await call('PUT', '/api/trips/settings', { eveningTime: '25:00' })).status, 400);
  const ok = await call('PUT', '/api/trips/settings', { eveningTime: '19:30', calendarId: store.firstLocalCalendarId() });
  assert.equal(ok.body.eveningTime, '19:30');
  assert.equal(ok.body.calendarId, store.firstLocalCalendarId());
});
