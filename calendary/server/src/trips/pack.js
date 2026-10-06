// The suitcase (0.12.1, spec §9): WardApp prepares it with the real wardrobe; Hubitat sends the trip (days, activity
// tags, weather, bag) over the suite API and keeps the last list it got, shown read-only when WardApp doesn't answer.
import { config } from '../config.js';
import { wardappEnabled } from '../suite.js';
import { addDays, httpError, parseYmd, ymd } from '../util.js';
import { db } from './db.js';
import { getTrip } from './trips.js';

const TIMEOUT_MS = 15_000;
const GENERATE_TIMEOUT_MS = 70_000; // WardApp may ask its AI

if (!db.prepare('PRAGMA table_info(trips)').all().some((c) => c.name === 'pack_cache')) {
  db.exec('ALTER TABLE trips ADD COLUMN pack_cache TEXT');
}

class WardappError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function wardapp(method, path, body, timeoutMs = TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(`${config.wardapp.url}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${config.apiToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new WardappError(0, `WardApp non raggiungibile (${err.cause?.code || err.message})`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* empty or not JSON */ }
  if (!res.ok) throw new WardappError(res.status, `WardApp: ${data?.error || `errore ${res.status}`}`);
  return data;
}

const cacheOf = (tripId) => {
  const r = db.prepare('SELECT pack_cache FROM trips WHERE id = ?').get(String(tripId));
  try {
    return r?.pack_cache ? JSON.parse(r.pack_cache) : null;
  } catch {
    return null;
  }
};
const saveCache = (tripId, pack) => db.prepare('UPDATE trips SET pack_cache = ? WHERE id = ?').run(pack ? JSON.stringify(pack) : null, String(tripId));

const ok = (pack) => ({ enabled: true, pack, stale: false, error: null });
const off = () => ({ enabled: false, pack: null, stale: false, error: null });
/** WardApp failed on a read: the last list, read-only. */
const fallback = (tripId, err) => {
  const pack = cacheOf(tripId);
  return { enabled: true, pack, stale: !!pack, error: err.message };
};
/** Writes need WardApp: a clear 502 for the page. */
const writeError = (err) => httpError(err.status === 404 ? 404 : 502, err.message);

/** What WardApp needs to know about the trip. */
export function packInput(trip, now = new Date()) {
  const weather = new Map((trip.weather || []).map((w) => [w.date, w]));
  const days = [];
  for (let d = parseYmd(trip.startDate); ymd(d) <= trip.endDate; d = addDays(d, 1)) {
    const date = ymd(d);
    const w = weather.get(date);
    days.push({
      date,
      tags: [...new Set(trip.activities.filter((a) => a.day === date).map((a) => a.tag))].sort(),
      weather: w && w.min !== null && w.max !== null ? { min: w.min, max: w.max, rainy: !!w.rainy } : null,
    });
  }
  const departsInDays = Math.max(0, Math.round((parseYmd(trip.startDate) - parseYmd(ymd(now))) / 86400e3));
  return { startDate: trip.startDate, endDate: trip.endDate, bag: trip.bag, canWash: trip.canWash, departsInDays, days };
}

export async function getPack(tripId) {
  getTrip(tripId);
  if (!wardappEnabled()) return off();
  try {
    const pack = await wardapp('GET', `/suite/packs/${encodeURIComponent(tripId)}`);
    saveCache(tripId, pack);
    return ok(pack);
  } catch (err) {
    if (err.status === 404) {
      saveCache(tripId, null);
      return ok(null);
    }
    return fallback(tripId, err);
  }
}

/** Prepares or regenerates the list (the user's choices are kept by WardApp); clears "the weather changed". */
export async function preparePack(tripId) {
  const trip = getTrip(tripId);
  if (!wardappEnabled()) return off();
  try {
    const pack = await wardapp('PUT', `/suite/packs/${encodeURIComponent(trip.id)}`, packInput(trip), GENERATE_TIMEOUT_MS);
    saveCache(trip.id, pack);
    db.prepare('UPDATE trips SET weather_changed = 0 WHERE id = ?').run(trip.id);
    return ok(pack);
  } catch (err) {
    return fallback(trip.id, err);
  }
}

async function write(tripId, method, path, body) {
  getTrip(tripId);
  if (!wardappEnabled()) throw httpError(400, 'Collega WardApp per preparare la valigia');
  try {
    const pack = await wardapp(method, path, body);
    saveCache(tripId, pack);
    return ok(pack);
  } catch (err) {
    throw writeError(err);
  }
}

export const markPackItem = (tripId, key, body = {}) =>
  write(tripId, 'PATCH', `/suite/packs/${encodeURIComponent(tripId)}/items/${encodeURIComponent(key)}`, { checked: body.checked, removed: body.removed });

export const addPackItem = (tripId, itemId) => write(tripId, 'POST', `/suite/packs/${encodeURIComponent(tripId)}/items`, { itemId });

export async function searchWardrobe(q) {
  if (!wardappEnabled()) return [];
  try {
    return await wardapp('GET', `/suite/items?q=${encodeURIComponent(String(q || '').slice(0, 60))}`);
  } catch (err) {
    throw writeError(err);
  }
}

/** Back home: the chosen items go to WardApp's laundry basket. */
export async function returnFromTrip(tripId, itemIds) {
  getTrip(tripId);
  if (!wardappEnabled()) throw httpError(400, 'Collega WardApp per mandare i capi nel cesto');
  try {
    return await wardapp('POST', `/suite/packs/${encodeURIComponent(tripId)}/return`, { itemIds: Array.isArray(itemIds) ? itemIds : [] });
  } catch (err) {
    throw writeError(err);
  }
}

/** Best effort, when the trip is deleted. Never throws. */
export async function forgetPack(tripId) {
  if (!wardappEnabled()) return;
  try {
    await wardapp('DELETE', `/suite/packs/${encodeURIComponent(tripId)}`);
  } catch (err) {
    console.warn(`Valigia del viaggio ${tripId}: ${err.message}`);
  }
}

/** { total, checked } of the last list received (reminders, cards), or null. */
export function packCounts(tripId) {
  return cacheOf(tripId)?.counts || null;
}
