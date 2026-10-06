// Destination weather (spec §8) from Open-Meteo: free, no key. Forecast when the trip starts within 16 days,
// otherwise the same dates of last year ("Come l'anno scorso"). Never throws: without network the last weather stays.
import { db } from './db.js';
import { getTrip, saveWeather } from './trips.js';
import { addDays, httpError, parseYmd, str, ymd } from '../util.js';

const FORECAST_DAYS = 16;
const MAX_AGE_MS = 6 * 3600e3;
const TIMEOUT_MS = 10_000;
const BIG_CHANGE = 4; // degrees

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}

/** Places matching `q` (max 5), in Italian. */
export async function geocode(q) {
  const name = str(q, 100);
  if (!name) throw httpError(400, 'Scrivi il nome di una città');
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.search = new URLSearchParams({ name, count: '5', language: 'it', format: 'json' }).toString();
  const data = await getJson(u);
  return (data.results || []).map((r) => ({ name: r.name, region: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude }));
}

const lastYear = (day) => {
  const d = parseYmd(day);
  d.setFullYear(d.getFullYear() - 1);
  return ymd(d);
};

function rowsOf(daily, dates, kind) {
  const time = daily?.time || [];
  return dates.map((date, i) => {
    const j = kind === 'forecast' ? time.indexOf(date) : i;
    if (j < 0 || j >= time.length) return null;
    const num = (key) => (Number.isFinite(daily[key]?.[j]) ? daily[key][j] : null);
    const rain = kind === 'forecast' ? num('precipitation_probability_max') : null;
    const sum = num('precipitation_sum');
    return {
      date,
      min: num('temperature_2m_min'),
      max: num('temperature_2m_max'),
      rain,
      rainy: kind === 'forecast' ? (rain ?? 0) >= 50 : (sum ?? 0) >= 1,
      code: num('weather_code'),
    };
  }).filter(Boolean);
}

function changed(before, beforeKind, after, kind) {
  if (!before?.length) return false;
  if (beforeKind === 'last_year' && kind === 'forecast') return true;
  const old = new Map(before.map((d) => [d.date, d]));
  return after.some((d) => {
    const o = old.get(d.date);
    if (!o) return false;
    const far = (a, b) => a !== null && b !== null && Math.abs(a - b) >= BIG_CHANGE;
    return far(d.max, o.max) || far(d.min, o.min) || d.rainy !== o.rainy;
  });
}

/** Refreshes the trip's weather when older than 6 hours (or `force`); returns the trip. */
export async function refreshWeather(tripId, { now = Date.now(), force = false } = {}) {
  const trip = getTrip(tripId);
  if (!trip.place || trip.place.lat === null || trip.place.lon === null) return trip;
  if (!force && trip.weatherAt && now - Date.parse(trip.weatherAt) < MAX_AGE_MS) return trip;
  const today = ymd(new Date(now));
  if (trip.endDate < today) return trip; // a past trip keeps what it had
  const horizon = ymd(addDays(parseYmd(today), FORECAST_DAYS - 1));
  const kind = trip.startDate <= horizon ? 'forecast' : 'last_year';
  const from = kind === 'forecast' && trip.startDate < today ? today : trip.startDate;
  const to = kind === 'forecast' && trip.endDate > horizon ? horizon : trip.endDate;
  const dates = [];
  for (let d = parseYmd(from); ymd(d) <= to; d = addDays(d, 1)) dates.push(ymd(d));
  try {
    const params = {
      latitude: String(trip.place.lat),
      longitude: String(trip.place.lon),
      start_date: kind === 'forecast' ? from : lastYear(from),
      end_date: kind === 'forecast' ? to : lastYear(to),
      daily: kind === 'forecast'
        ? 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
        : 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
      timezone: 'auto',
    };
    const base = kind === 'forecast' ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
    const u = new URL(base);
    u.search = new URLSearchParams(params).toString();
    const data = await getJson(u);
    const rows = rowsOf(data.daily, dates, kind);
    if (!rows.length) return trip;
    saveWeather(trip.id, { at: new Date(now).toISOString(), weather: rows, kind, changed: trip.weatherChanged || changed(trip.weather, trip.weatherKind, rows, kind) });
  } catch (err) {
    console.warn(`Meteo del viaggio ${trip.name}: ${err.message}`);
  }
  return getTrip(trip.id);
}

/** Nightly: trips in progress or starting within 16 days. */
export async function refreshUpcoming(now = Date.now()) {
  const today = ymd(new Date(now));
  const horizon = ymd(addDays(parseYmd(today), FORECAST_DAYS - 1));
  const ids = db.prepare('SELECT id FROM trips WHERE end_date >= ? AND start_date <= ? AND lat IS NOT NULL').all(today, horizon).map((r) => r.id);
  for (const id of ids) await refreshWeather(id, { now, force: true });
}
