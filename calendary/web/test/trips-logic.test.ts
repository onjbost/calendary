// Pure helpers of the trips pages. Run: node --test test/
import assert from 'node:assert/strict';
import test from 'node:test';
import { dateRange, groupDaysByDate, groupTrips, programmeOf, tripDates, weatherIcon, whenText } from '../src/trips/logic.ts';

const trip = (id: string, startDate: string, endDate: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, place: null, startDate, endDate, bag: 'cabin', canWash: false, quietAlexa: false, notes: '',
  weather: null, weatherAt: null, weatherKind: null, weatherChanged: false, source: 'manual', legs: [], activities: [], ...extra,
}) as any;

test('strisce raggruppate per data, in ordine', () => {
  const day = (date: string, tripId: string, index: number) => ({ date, tripId, index, name: tripId, label: '', emoji: '', color: '', kind: 'middle', total: 5 }) as any;
  const map = groupDaysByDate([day('2026-12-04', 'A', 4), day('2026-12-04', 'B', 1), day('2026-12-05', 'A', 5)]);
  assert.deepEqual(map.get('2026-12-04')!.map((d) => d.tripId), ['A', 'B']);
  assert.equal(map.get('2026-12-05')!.length, 1);
  assert.equal(map.has('2026-12-06'), false);
});

test('date, gruppi e quando', () => {
  assert.equal(dateRange('2026-11-02', '2026-11-06'), '2–6 nov');
  assert.equal(dateRange('2026-10-30', '2026-11-03'), '30 ott – 3 nov');
  assert.equal(dateRange('2026-12-28', '2027-01-02'), '28 dic 2026 – 2 gen 2027');
  assert.equal(dateRange('2026-11-10', '2026-11-10'), '10 nov');
  assert.deepEqual(tripDates({ startDate: '2026-10-24', endDate: '2026-10-27' }), ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  const g = groupTrips([trip('past', '2026-09-01', '2026-09-03'), trip('far', '2026-12-01', '2026-12-03'), trip('now', '2026-10-05', '2026-10-08'), trip('soon', '2026-10-10', '2026-10-12')], '2026-10-06');
  assert.deepEqual([g.now, g.next, g.past].map((l) => l.map((t) => t.id)), [['now'], ['soon', 'far'], ['past']]);
  assert.equal(whenText(trip('now', '2026-10-05', '2026-10-08'), '2026-10-06'), 'Giorno 2 di 4');
  assert.equal(whenText(trip('soon', '2026-10-07', '2026-10-08'), '2026-10-06'), 'Domani');
  assert.equal(whenText(trip('soon', '2026-10-10', '2026-10-12'), '2026-10-06'), 'Tra 4 giorni');
  assert.equal(weatherIcon(0), '☀️');
  assert.equal(weatherIcon(61), '🌧️');
  assert.equal(weatherIcon(null, true), '🌧️');
});

test('programma del giorno: tratte e attività con orario in ordine, senza orario in fondo', () => {
  const t = trip('x', '2026-11-02', '2026-11-03', {
    legs: [{ id: 'l1', departAt: new Date('2026-11-02T10:30').toISOString(), arriveAt: new Date('2026-11-02T11:40').toISOString() }],
    activities: [
      { id: 'a1', day: '2026-11-02', time: '', title: 'Giro' },
      { id: 'a2', day: '2026-11-02', time: '20:30', title: 'Cena' },
      { id: 'a3', day: '2026-11-02', time: '08:00', title: 'Colazione' },
      { id: 'a4', day: '2026-11-03', time: '09:00', title: 'Altro giorno' },
    ],
  });
  const items = programmeOf(t, '2026-11-02');
  assert.deepEqual(items.map((i) => (i.kind === 'leg' ? i.leg.id : i.activity.id)), ['a3', 'l1', 'a2', 'a1']);
});

test('trasforma in viaggio: almeno due giorni (la fine degli eventi giornata intera è esclusa)', async () => {
  const { spansDays } = await import('../src/trips/logic.ts');
  const iso = (s: string) => new Date(s).toISOString();
  assert.equal(spansDays({ start: iso('2026-11-02T00:00'), end: iso('2026-11-03T00:00'), allDay: true }), false);
  assert.equal(spansDays({ start: iso('2026-11-02T00:00'), end: iso('2026-11-04T00:00'), allDay: true }), true);
  assert.equal(spansDays({ start: iso('2026-11-02T09:00'), end: iso('2026-11-03T18:00'), allDay: false }), true);
  assert.equal(spansDays({ start: iso('2026-11-02T20:00'), end: iso('2026-11-02T23:00'), allDay: false }), false);
});
