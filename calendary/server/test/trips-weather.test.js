// Trips module: destination weather from Open-Meteo (fake fetch: no network in tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-trips-weather-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';

const trips = await import('../src/trips/trips.js');
const weather = await import('../src/trips/weather.js');
const { db } = await import('../src/db.js');

const realFetch = globalThis.fetch;
let urls = [];
let reply = () => { throw new Error('no reply set'); };
globalThis.fetch = async (url) => { urls.push(String(url)); return reply(String(url)); };
after(() => { globalThis.fetch = realFetch; db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => { urls = []; db.exec('DELETE FROM trips'); });

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const NOW = new Date('2026-10-28T12:00').getTime();
const cagliari = { name: 'Cagliari', country: 'Italia', lat: 39.22, lon: 9.11 };
const forecast = (max = [22, 21, 20, 19, 18], prob = [10, 20, 30, 70, 0]) => () => json({
  daily: {
    time: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'],
    temperature_2m_max: max, temperature_2m_min: max.map((x) => x - 8), precipitation_probability_max: prob, weather_code: [0, 1, 2, 61, 3],
  },
});

test('geocode: nome codificato, italiano, 5 risultati', async () => {
  reply = () => json({ results: [{ name: "L'Aquila", admin1: 'Abruzzo', country: 'Italia', latitude: 42.35, longitude: 13.4 }] });
  const r = await weather.geocode("L'Aquila");
  assert.deepEqual(r, [{ name: "L'Aquila", region: 'Abruzzo', country: 'Italia', lat: 42.35, lon: 13.4 }]);
  const u = new URL(urls[0]);
  assert.equal(u.host, 'geocoding-api.open-meteo.com');
  assert.equal(u.searchParams.get('name'), "L'Aquila");
  assert.equal(u.searchParams.get('language'), 'it');
  assert.equal(u.searchParams.get('count'), '5');
  reply = () => json({});
  assert.deepEqual(await weather.geocode('Nessunluogo'), []);
});

test('viaggio tra 5 giorni: previsioni', async () => {
  const t = trips.createTrip({ name: 'Sardegna', place: cagliari, startDate: '2026-11-02', endDate: '2026-11-06' });
  reply = forecast();
  const r = await weather.refreshWeather(t.id, { now: NOW });
  const u = new URL(urls[0]);
  assert.equal(u.host, 'api.open-meteo.com');
  assert.equal(u.pathname, '/v1/forecast');
  assert.equal(u.searchParams.get('latitude'), '39.22');
  assert.equal(u.searchParams.get('longitude'), '9.11');
  assert.equal(u.searchParams.get('start_date'), '2026-11-02');
  assert.equal(u.searchParams.get('end_date'), '2026-11-06');
  assert.equal(u.searchParams.get('daily'), 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code');
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.equal(r.weatherKind, 'forecast');
  assert.equal(r.weather.length, 5);
  assert.deepEqual(r.weather[3], { date: '2026-11-05', min: 11, max: 19, rain: 70, rainy: true, code: 61 });
  assert.equal(r.weatherChanged, false);
});

test('viaggio tra 40 giorni: come l\'anno scorso', async () => {
  const t = trips.createTrip({ name: 'Inverno', place: cagliari, startDate: '2026-12-07', endDate: '2026-12-08' });
  reply = () => json({ daily: { time: ['2025-12-07', '2025-12-08'], temperature_2m_max: [15, 14], temperature_2m_min: [8, 7], precipitation_sum: [0.2, 3.4], weather_code: [2, 63] } });
  const r = await weather.refreshWeather(t.id, { now: NOW });
  const u = new URL(urls[0]);
  assert.equal(u.host, 'archive-api.open-meteo.com');
  assert.equal(u.searchParams.get('start_date'), '2025-12-07');
  assert.equal(u.searchParams.get('end_date'), '2025-12-08');
  assert.match(u.searchParams.get('daily'), /precipitation_sum/);
  assert.equal(r.weatherKind, 'last_year');
  assert.deepEqual(r.weather.map((d) => [d.date, d.rainy, d.rain]), [['2026-12-07', false, null], ['2026-12-08', true, null]]);
});

test('meteo cambiato: dall\'anno scorso alle previsioni, ±4°, pioggia', async () => {
  const t = trips.createTrip({ name: 'Sardegna', place: cagliari, startDate: '2026-11-02', endDate: '2026-11-06' });
  // saved as "last year" first (refreshed when the trip was far away)
  reply = () => json({ daily: { time: ['2025-11-02', '2025-11-03', '2025-11-04', '2025-11-05', '2025-11-06'], temperature_2m_max: [22, 21, 20, 19, 18], temperature_2m_min: [14, 13, 12, 11, 10], precipitation_sum: [0, 0, 0, 0, 0], weather_code: [0, 0, 0, 0, 0] } });
  await weather.refreshWeather(t.id, { now: new Date('2026-10-01T12:00').getTime() });
  reply = forecast();
  assert.equal((await weather.refreshWeather(t.id, { now: NOW, force: true })).weatherChanged, true);
  db.prepare('UPDATE trips SET weather_changed = 0').run();
  reply = forecast([20, 21, 20, 19, 18]); // -2°
  assert.equal((await weather.refreshWeather(t.id, { now: NOW, force: true })).weatherChanged, false);
  reply = forecast([15, 21, 20, 19, 18]); // -5°
  assert.equal((await weather.refreshWeather(t.id, { now: NOW, force: true })).weatherChanged, true);
  db.prepare('UPDATE trips SET weather_changed = 0').run();
  reply = forecast([15, 21, 20, 19, 18], [60, 20, 30, 70, 0]); // rain 10 → 60
  assert.equal((await weather.refreshWeather(t.id, { now: NOW, force: true })).weatherChanged, true);
});

test('non riaggiorna prima di 6 ore; senza rete tiene il meteo; senza destinazione non chiama', async () => {
  const t = trips.createTrip({ name: 'Sardegna', place: cagliari, startDate: '2026-11-02', endDate: '2026-11-06' });
  reply = forecast();
  await weather.refreshWeather(t.id, { now: NOW });
  urls = [];
  await weather.refreshWeather(t.id, { now: NOW });
  assert.equal(urls.length, 0);
  reply = () => { throw new TypeError('fetch failed'); };
  const r = await weather.refreshWeather(t.id, { now: NOW, force: true });
  assert.equal(r.weather.length, 5);
  const nowhere = trips.createTrip({ name: 'Boh', startDate: '2026-11-02', endDate: '2026-11-03' });
  urls = [];
  assert.equal((await weather.refreshWeather(nowhere.id, { now: NOW })).weather, null);
  assert.equal(urls.length, 0);
});

test('aggiornamento notturno: solo i viaggi entro 16 giorni o in corso', async () => {
  const near = trips.createTrip({ name: 'Vicino', place: cagliari, startDate: '2026-11-02', endDate: '2026-11-06' });
  trips.createTrip({ name: 'Lontano', place: cagliari, startDate: '2027-03-01', endDate: '2027-03-03' });
  trips.createTrip({ name: 'Passato', place: cagliari, startDate: '2026-09-01', endDate: '2026-09-03' });
  reply = forecast();
  await weather.refreshUpcoming(NOW);
  assert.equal(urls.length, 1);
  assert.equal(trips.getTrip(near.id).weatherKind, 'forecast');
});
