// Trips module (0.12.0): trips, legs and day-by-day activities with their rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-trips-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';

const trips = await import('../src/trips/trips.js');
const { db } = await import('../src/db.js');
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const sardegna = () => trips.createTrip({ name: 'Sardegna', startDate: '2026-11-02', endDate: '2026-11-06' });
const local = (s) => new Date(s).toISOString(); // "2026-11-02T10:30" read as local time

test('crea un viaggio con valori di default', () => {
  const t = sardegna();
  assert.equal(t.name, 'Sardegna');
  assert.equal(t.bag, 'cabin');
  assert.equal(t.canWash, false);
  assert.equal(t.quietAlexa, false);
  assert.equal(t.source, 'manual');
  assert.equal(t.place, null);
  assert.deepEqual(t.legs, []);
  assert.deepEqual(t.activities, []);
  assert.equal(trips.getTrip(t.id).id, t.id);
  assert.ok(trips.listTrips().some((x) => x.id === t.id));
});

test('date al contrario o mancanti → 400', () => {
  assert.throws(() => trips.createTrip({ name: 'X', startDate: '2026-11-06', endDate: '2026-11-02' }), (e) => e.statusCode === 400 && /ritorno è prima/.test(e.message));
  assert.throws(() => trips.createTrip({ name: 'X', startDate: '2026-11-06' }), (e) => e.statusCode === 400 && /date/.test(e.message));
  assert.throws(() => trips.createTrip({ startDate: '2026-11-02', endDate: '2026-11-03' }), (e) => e.statusCode === 400 && /nome/.test(e.message));
  assert.throws(() => trips.getTrip('nope'), (e) => e.statusCode === 404 && /Viaggio non trovato/.test(e.message));
});

test('destinazione, bagaglio e spunte', () => {
  const t = trips.createTrip({
    name: 'Cagliari', startDate: '2026-11-02', endDate: '2026-11-06', bag: 'backpack_l', canWash: true, quietAlexa: true,
    place: { name: 'Cagliari', country: 'Italia', lat: 39.22, lon: 9.11 },
  });
  assert.deepEqual(t.place, { name: 'Cagliari', country: 'Italia', lat: 39.22, lon: 9.11 });
  assert.equal(t.bag, 'backpack_l');
  assert.equal(t.canWash, true);
  assert.equal(t.quietAlexa, true);
  assert.throws(() => trips.updateTrip(t.id, { bag: 'carriola' }), (e) => e.statusCode === 400);
  assert.equal(trips.updateTrip(t.id, { notes: 'Portare la maschera' }).notes, 'Portare la maschera');
});

test('tratte: check-in, mezzi, orari e date', () => {
  const t = sardegna();
  const out = trips.addLeg(t.id, { mode: 'plane', from: 'Pisa', to: 'Cagliari', departAt: local('2026-11-02T10:30'), arriveAt: local('2026-11-02T11:40'), code: 'FR1234', booking: 'ABC123' });
  assert.equal(out.checkinHours, 24);
  assert.equal(out.direction, 'out');
  assert.equal(out.code, 'FR1234');
  const back = trips.addLeg(t.id, { mode: 'plane', from: 'Cagliari', to: 'Pisa', departAt: local('2026-11-06T19:00'), arriveAt: local('2026-11-06T20:10') });
  assert.equal(back.direction, 'back');
  const mid = trips.addLeg(t.id, { mode: 'ferry', from: 'Cagliari', to: 'Carloforte', departAt: local('2026-11-04T09:00'), arriveAt: local('2026-11-04T10:00') });
  assert.equal(mid.direction, 'other');
  assert.equal(mid.checkinHours, null);
  assert.throws(() => trips.addLeg(t.id, { mode: 'mongolfiera', from: 'A', to: 'B', departAt: local('2026-11-02T10:00'), arriveAt: local('2026-11-02T11:00') }), (e) => e.statusCode === 400);
  assert.throws(() => trips.addLeg(t.id, { mode: 'train', from: 'A', to: 'B', departAt: local('2026-11-02T10:00'), arriveAt: local('2026-11-02T09:00') }), (e) => e.statusCode === 400);
  assert.throws(() => trips.addLeg(t.id, { mode: 'train', from: 'A', to: 'B', departAt: local('2026-10-31T22:00'), arriveAt: local('2026-11-01T07:00') }), (e) => e.statusCode === 400 && /fuori dalle date/.test(e.message));
  // the outbound leg may leave the day before (night train), the return arrive the day after
  trips.addLeg(t.id, { mode: 'train', from: 'Roma', to: 'Civitavecchia', departAt: local('2026-11-01T22:00'), arriveAt: local('2026-11-01T23:30') });
  trips.addLeg(t.id, { mode: 'ferry', from: 'Olbia', to: 'Livorno', departAt: local('2026-11-06T22:00'), arriveAt: local('2026-11-07T07:00') });
  assert.equal(trips.getTrip(t.id).legs.length, 5);
  assert.equal(trips.getTrip(t.id).legs[0].from, 'Roma'); // in departure order
  assert.equal(trips.updateLeg(out.id, { checkinHours: 48 }).checkinHours, 48);
  trips.deleteLeg(mid.id);
  assert.equal(trips.getTrip(t.id).legs.length, 4);
});

test('attività: giorno, orario, etichetta, durata, ordine', () => {
  const t = sardegna();
  assert.throws(() => trips.addActivity(t.id, { day: '2026-11-07', tag: 'beach', title: 'Mare' }), (e) => e.statusCode === 400);
  assert.throws(() => trips.addActivity(t.id, { day: '2026-11-03', tag: 'beach', title: 'Mare', time: '25:00' }), (e) => e.statusCode === 400);
  assert.throws(() => trips.addActivity(t.id, { day: '2026-11-03', tag: 'beach' }), (e) => e.statusCode === 400);
  const a = trips.addActivity(t.id, { day: '2026-11-03', tag: 'beach', title: 'Poetto' });
  const b = trips.addActivity(t.id, { day: '2026-11-03', tag: 'dinner', title: 'Cena', time: '20:30' });
  const c = trips.addActivity(t.id, { day: '2026-11-03', tag: 'gelato', title: 'Giro', time: '10:00' });
  const d = trips.addActivity(t.id, { day: '2026-11-02', tag: 'city', title: 'Centro' });
  assert.equal(c.tag, 'other');
  assert.equal(a.minutes, 120);
  assert.equal(a.time, '');
  assert.deepEqual(trips.getTrip(t.id).activities.map((x) => x.id), [d.id, c.id, b.id, a.id]);
  assert.equal(trips.updateActivity(a.id, { time: '09:00' }).time, '09:00');
  trips.deleteActivity(b.id);
  assert.equal(trips.getTrip(t.id).activities.length, 3);
});

test('cambio date: attività fuori vanno in Da riprogrammare', () => {
  const t = sardegna();
  const a = trips.addActivity(t.id, { day: '2026-11-06', tag: 'city', title: 'Ultimo giro' });
  trips.updateTrip(t.id, { endDate: '2026-11-05' });
  const moved = trips.getTrip(t.id).activities.find((x) => x.id === a.id);
  assert.equal(moved.day, '');
  // an activity "to reschedule" can be given a day again
  assert.equal(trips.updateActivity(a.id, { day: '2026-11-05' }).day, '2026-11-05');
});

test('eliminare il viaggio elimina tratte e attività', () => {
  const t = sardegna();
  const leg = trips.addLeg(t.id, { mode: 'car', from: 'Casa', to: 'Porto', departAt: local('2026-11-02T06:00'), arriveAt: local('2026-11-02T08:00') });
  const act = trips.addActivity(t.id, { day: '2026-11-03', tag: 'beach', title: 'Mare' });
  trips.deleteTrip(t.id);
  assert.throws(() => trips.getTrip(t.id), (e) => e.statusCode === 404);
  assert.equal(trips.findByEvent('none'), null);
  assert.throws(() => trips.updateLeg(leg.id, { notes: 'x' }), (e) => e.statusCode === 404);
  assert.throws(() => trips.updateActivity(act.id, { notes: 'x' }), (e) => e.statusCode === 404);
});

test('collegamento agli eventi e sync', () => {
  const calls = [];
  trips.setTripsSync((change) => calls.push(change.type));
  const t = sardegna();
  const act = trips.addActivity(t.id, { day: '2026-11-03', tag: 'beach', title: 'Mare', time: '10:00' });
  trips.setEventId('activity', act.id, 'ev-1');
  assert.deepEqual(trips.findByEvent('ev-1').kind, 'activity');
  assert.equal(trips.findByEvent('ev-1').row.id, act.id);
  trips.deleteTrip(t.id);
  assert.deepEqual(calls, ['trip:create', 'activity:create', 'trip:delete']);
  trips.setTripsSync(null);
});
