// Trips module: check-in, evening-before and welcome-back reminders (push + Alexa), once each.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-trips-rem-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';

const trips = await import('../src/trips/trips.js');
const { checkTripReminders, dueTripReminders } = await import('../src/trips/reminders.js');
const { db, setSetting } = await import('../src/db.js');
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => { db.exec('DELETE FROM trips; DELETE FROM notified; DELETE FROM settings'); });

const at = (s) => new Date(s);
const local = (s) => new Date(s).toISOString();
const cagliari = { name: 'Cagliari', country: 'Italia', lat: 39.2, lon: 9.1 };
const trip = (extra = {}) => trips.createTrip({ name: 'Sardegna', place: cagliari, startDate: '2026-11-02', endDate: '2026-11-06', ...extra });
const flight = (t, extra = {}) => trips.addLeg(t.id, { mode: 'plane', from: 'Pisa', to: 'Cagliari', departAt: local('2026-11-02T10:30'), arriveAt: local('2026-11-02T11:40'), code: 'FR1234', booking: 'ABC123', ...extra });
const titles = (now) => dueTripReminders(now).map((r) => r.title);

test('check-in: all\'apertura (24 h prima), mai dopo la partenza', () => {
  const t = trip();
  flight(t);
  assert.ok(!titles(at('2026-11-01T10:29')).includes('✈️ Check-in aperto'));
  const r = dueTripReminders(at('2026-11-01T10:30')).find((x) => x.title === '✈️ Check-in aperto');
  assert.equal(r.body, 'FR1234 Pisa → Cagliari domani alle 10:30 · prenotazione ABC123');
  assert.equal(r.url, `/viaggi/${t.id}`);
  assert.ok(!titles(at('2026-11-02T10:31')).includes('✈️ Check-in aperto'));
});

test('check-in che si apre di notte arriva alle 8', () => {
  const t = trip();
  flight(t, { departAt: local('2026-11-03T06:00'), arriveAt: local('2026-11-03T07:10'), checkinHours: 30 });
  assert.ok(!titles(at('2026-11-02T07:59')).includes('✈️ Check-in aperto'));
  const r = dueTripReminders(at('2026-11-02T08:00')).find((x) => x.title === '✈️ Check-in aperto');
  assert.match(r.body, /domani alle 06:00/);
});

test('sera prima: alle 20 del giorno prima, cosa preparare per mezzo; orario configurabile', () => {
  const t = trip();
  flight(t);
  trips.addLeg(t.id, { mode: 'car', from: 'Casa', to: 'Pisa', departAt: local('2026-11-02T07:30'), arriveAt: local('2026-11-02T08:30') });
  assert.ok(!titles(at('2026-11-01T19:59')).includes('🧳 Domani si parte per Cagliari'));
  const r = dueTripReminders(at('2026-11-01T20:00')).find((x) => x.title === '🧳 Domani si parte per Cagliari');
  for (const s of ['documento', "carta d'imbarco", '100 ml', 'pieno', 'pedaggi']) assert.ok(r.body.includes(s), s);
  setSetting('trips_evening_time', '19:30');
  assert.ok(titles(at('2026-11-01T19:30')).includes('🧳 Domani si parte per Cagliari'));
  assert.ok(!titles(at('2026-11-02T00:10')).includes('🧳 Domani si parte per Cagliari')); // that evening is over
});

test('sera prima anche senza tratte, dalla data di partenza', () => {
  trip();
  const r = dueTripReminders(at('2026-11-01T20:00')).find((x) => x.title === '🧳 Domani si parte per Cagliari');
  assert.match(r.body, /documenti/);
});

test('ritorno: un\'ora dopo l\'arrivo dell\'ultima tratta; senza tratte alle 18 del giorno di rientro', () => {
  const t = trip();
  trips.addLeg(t.id, { mode: 'plane', from: 'Cagliari', to: 'Pisa', departAt: local('2026-11-06T19:50'), arriveAt: local('2026-11-06T21:00') });
  assert.ok(!titles(at('2026-11-06T21:59')).includes('🏠 Bentornato!'));
  assert.ok(titles(at('2026-11-06T22:00')).includes('🏠 Bentornato!'));
  db.exec('DELETE FROM trips');
  trip();
  assert.ok(!titles(at('2026-11-06T17:59')).includes('🏠 Bentornato!'));
  assert.ok(titles(at('2026-11-06T18:00')).includes('🏠 Bentornato!'));
  assert.ok(!titles(at('2026-11-07T09:00')).includes('🏠 Bentornato!'));
});

test('una volta sola, anche se il controllo gira due volte; push e Alexa', async () => {
  const t = trip();
  flight(t);
  const sent = [];
  const spoken = [];
  const deps = { send: async (p) => sent.push(p), speak: async (s) => spoken.push(s) };
  await checkTripReminders(at('2026-11-01T10:30'), deps);
  await checkTripReminders(at('2026-11-01T10:31'), deps);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, '✈️ Check-in aperto');
  assert.equal(sent[0].url, `/viaggi/${t.id}`);
  assert.ok(sent[0].tag.startsWith(`trip|${t.id}|checkin|`));
  assert.equal(spoken.length, 1);
  assert.match(spoken[0], /Check-in aperto/);
});

test('riavvio dopo la partenza: niente check-in né sera prima', () => {
  const t = trip();
  flight(t);
  const list = titles(at('2026-11-02T11:00'));
  assert.ok(!list.includes('✈️ Check-in aperto'));
  assert.ok(!list.includes('🧳 Domani si parte per Cagliari'));
});

test('sera prima con il cambio dell\'ora', () => {
  const t = trip({ startDate: '2026-10-25', endDate: '2026-10-27' });
  trips.addLeg(t.id, { mode: 'train', from: 'Pisa', to: 'Roma', departAt: local('2026-10-25T09:00'), arriveAt: local('2026-10-25T12:00') });
  assert.ok(!titles(at('2026-10-24T19:59')).includes('🧳 Domani si parte per Cagliari'));
  const r = dueTripReminders(at('2026-10-24T20:00')).find((x) => x.title === '🧳 Domani si parte per Cagliari');
  assert.match(r.body, /biglietto/);
});
