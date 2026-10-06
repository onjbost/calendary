// Trips module: the day strips the calendar draws ("In viaggio · Cagliari · 3/5"), computed, never stored.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-trips-days-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';

const trips = await import('../src/trips/trips.js');
const { tripDays, tripDaySummary } = await import('../src/trips/days.js');
const { db } = await import('../src/db.js');
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => db.exec('DELETE FROM trips'));

const cagliari = { name: 'Cagliari', country: 'Italia', lat: 39.2, lon: 9.1 };

test('viaggio di 5 giorni a cavallo del cambio dell\'ora: partenza, in mezzo, rientro', () => {
  const t = trips.createTrip({ name: 'Sardegna', place: cagliari, startDate: '2026-10-24', endDate: '2026-10-28' });
  const days = tripDays('2026-10-20', '2026-10-31');
  assert.deepEqual(days.map((d) => d.date), ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  assert.deepEqual(days.map((d) => d.kind), ['start', 'middle', 'middle', 'middle', 'end']);
  assert.deepEqual(days.map((d) => d.index), [1, 2, 3, 4, 5]);
  assert.ok(days.every((d) => d.total === 5 && d.tripId === t.id && d.color === '#38bdf8' && d.name === 'Cagliari'));
  assert.equal(days[0].label, 'Si parte · Cagliari');
  assert.equal(days[2].label, 'In viaggio · Cagliari · 3/5');
  assert.equal(days[4].label, 'Rientro da Cagliari');
  assert.deepEqual(days.map((d) => d.emoji), ['🧳', '🌴', '🌴', '🌴', '🏠']);
});

test('gita di un giorno', () => {
  trips.createTrip({ name: 'Gita', place: cagliari, startDate: '2026-11-10', endDate: '2026-11-10' });
  const [d] = tripDays('2026-11-10', '2026-11-10');
  assert.equal(d.kind, 'single');
  assert.equal(d.label, 'Gita · Cagliari');
  assert.equal(d.emoji, '🧳');
});

test('l\'emoji dei giorni in mezzo segue il programma; senza destinazione si usa il nome del viaggio', () => {
  const t = trips.createTrip({ name: 'Ponte in montagna', startDate: '2026-11-10', endDate: '2026-11-12' });
  assert.equal(tripDays('2026-11-11', '2026-11-11')[0].label, 'In viaggio · Ponte in montagna · 2/3');
  trips.addActivity(t.id, { day: '2026-11-11', tag: 'work', title: 'Riunione' });
  assert.equal(tripDays('2026-11-11', '2026-11-11')[0].emoji, '💼');
  trips.addActivity(t.id, { day: '2026-11-11', tag: 'hiking', title: 'Sentiero' });
  assert.equal(tripDays('2026-11-11', '2026-11-11')[0].emoji, '⛰️');
  trips.addActivity(t.id, { day: '2026-11-12', tag: 'beach', title: 'Lago' });
  assert.equal(tripDays('2026-11-11', '2026-11-11')[0].emoji, '🏖️');
});

test('viaggi sovrapposti: due righe nella stessa data, in ordine di partenza; l\'intervallo taglia', () => {
  const a = trips.createTrip({ name: 'A', startDate: '2026-12-01', endDate: '2026-12-05' });
  const b = trips.createTrip({ name: 'B', startDate: '2026-12-04', endDate: '2026-12-08' });
  const days = tripDays('2026-12-04', '2026-12-05');
  assert.deepEqual(days.map((d) => [d.date, d.tripId]), [['2026-12-04', a.id], ['2026-12-04', b.id], ['2026-12-05', a.id], ['2026-12-05', b.id]]);
  assert.equal(tripDays('2026-12-09', '2026-12-10').length, 0);
});

test('riga del riepilogo del mattino', () => {
  trips.createTrip({ name: 'Sardegna', place: cagliari, startDate: '2026-10-24', endDate: '2026-10-28' });
  assert.equal(tripDaySummary('2026-10-24'), 'Oggi parti per Cagliari.');
  assert.equal(tripDaySummary('2026-10-26'), 'Oggi sei in viaggio a Cagliari, giorno 3 di 5.');
  assert.equal(tripDaySummary('2026-10-28'), 'Oggi rientri da Cagliari.');
  assert.equal(tripDaySummary('2026-10-29'), null);
});
