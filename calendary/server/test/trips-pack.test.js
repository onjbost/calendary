// Trips module, 0.12.1: the suitcase comes from WardApp (fake WardApp: fetch is replaced).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-trips-pack-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';
process.env.CALENDARY_API_TOKEN = 's'.repeat(24);
process.env.WARDAPP_URL = 'http://wardapp.test';

const store = await import('../src/store.js');
const { registerTripRoutes, installTripCalendar } = await import('../src/trips/index.js');
const trips = await import('../src/trips/trips.js');
const { dueTripReminders } = await import('../src/trips/reminders.js');
const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
store.ensureDefaultCalendars();
installTripCalendar();

const realFetch = globalThis.fetch;
let calls = [];
let wardapp = () => new Response('{}', { status: 200 });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.host !== 'wardapp.test') throw new TypeError('fetch failed'); // Open-Meteo: offline in these tests
  calls.push({ method: init.method || 'GET', path: u.pathname + u.search, auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
  return wardapp(u, init);
};
const app = Fastify();
app.setErrorHandler((err, req, reply) => reply.code(err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message }));
await app.register(registerTripRoutes, { prefix: '/api' });
after(async () => { globalThis.fetch = realFetch; await app.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => { calls = []; db.exec('DELETE FROM trips; DELETE FROM notified'); });

const call = async (method, url, payload) => {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const PACK = {
  tripId: 'x', generatedAt: '2026-10-06T10:00:00.000Z', ai: false, worn: [], tips: ['2 costumi: stendili la sera'], warnings: [],
  capacity: { used: 20, max: 32, fits: true, suggestBag: null },
  lines: Array.from({ length: 24 }, (_, i) => ({ key: `k${i}`, itemId: `i${i}`, name: `Capo ${i}`, group: 'top', qty: 1, reasons: [], worn: false, manual: false, dirty: false, bulk: 1, checked: i < 18, thumbUrl: null })),
  counts: { total: 24, checked: 18 },
};
const local = (s) => new Date(s).toISOString();
const sardegna = () => {
  const t = trips.createTrip({ name: 'Sardegna', place: { name: 'Cagliari', country: 'Italia', lat: 39.2, lon: 9.1 }, startDate: '2026-11-02', endDate: '2026-11-04', bag: 'cabin', canWash: true });
  trips.addActivity(t.id, { day: '2026-11-03', tag: 'beach', title: 'Poetto' });
  trips.addActivity(t.id, { day: '2026-11-03', tag: 'dinner', title: 'Cena', time: '20:30' });
  db.prepare('UPDATE trips SET weather = ?, weather_kind = ?, weather_changed = 1 WHERE id = ?')
    .run(JSON.stringify([{ date: '2026-11-03', min: 18, max: 24, rain: 60, rainy: true, code: 61 }]), 'forecast', t.id);
  return t;
};

test('WardApp non collegato: la scheda lo dice', async () => {
  const saved = config.wardapp.url;
  config.wardapp.url = '';
  const t = sardegna();
  assert.deepEqual((await call('GET', `/api/trips/${t.id}/pack`)).body, { enabled: false, pack: null, stale: false, error: null });
  config.wardapp.url = saved;
});

test('prepara: manda a WardApp i giorni con attività e meteo, salva la cache, azzera il meteo cambiato', async () => {
  const t = sardegna();
  wardapp = () => json({ ...PACK, tripId: t.id });
  const r = await call('POST', `/api/trips/${t.id}/pack`);
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.stale, false);
  assert.equal(r.body.pack.counts.total, 24);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.path, `/api/suite/packs/${t.id}`);
  assert.equal(put.auth, `Bearer ${'s'.repeat(24)}`);
  assert.equal(put.body.bag, 'cabin');
  assert.equal(put.body.canWash, true);
  assert.equal(typeof put.body.departsInDays, 'number');
  assert.deepEqual(put.body.days.map((d) => d.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepEqual(put.body.days[1].tags, ['beach', 'dinner']);
  assert.deepEqual(put.body.days[1].weather, { min: 18, max: 24, rainy: true });
  assert.equal(put.body.days[0].weather, null);
  assert.equal(trips.getTrip(t.id).weatherChanged, false);
});

test('WardApp giù o in errore: l\'ultima lista ricevuta, in sola lettura', async () => {
  const t = sardegna();
  wardapp = () => json({ ...PACK, tripId: t.id });
  await call('POST', `/api/trips/${t.id}/pack`);
  wardapp = () => json({ error: 'boom' }, 500);
  const r = (await call('GET', `/api/trips/${t.id}/pack`)).body;
  assert.equal(r.stale, true);
  assert.equal(r.pack.counts.total, 24);
  assert.match(r.error, /WardApp/);
  wardapp = () => { throw new TypeError('fetch failed'); };
  const down = (await call('GET', `/api/trips/${t.id}/pack`)).body;
  assert.equal(down.stale, true);
  // a write needs WardApp
  assert.equal((await call('PATCH', `/api/trips/${t.id}/pack/items/k1`, { checked: true })).status, 502);
});

test('nessuna lista ancora: pack null senza errore', async () => {
  const t = sardegna();
  wardapp = () => json({ error: 'Valigia non ancora preparata' }, 404);
  const r = (await call('GET', `/api/trips/${t.id}/pack`)).body;
  assert.deepEqual(r, { enabled: true, pack: null, stale: false, error: null });
});

test('spunta, aggiungi, cerca, rientro passano a WardApp', async () => {
  const t = sardegna();
  wardapp = (u) => (u.pathname === '/api/suite/items' ? json([{ id: 'i9', name: 'Cappello', category: 'accessory', thumbUrl: null }])
    : u.pathname.endsWith('/return') ? json({ count: 3 }) : json({ ...PACK, tripId: t.id }));
  assert.equal((await call('PATCH', `/api/trips/${t.id}/pack/items/k1`, { checked: true })).body.pack.counts.checked, 18);
  assert.equal(calls.at(-1).method, 'PATCH');
  assert.equal(calls.at(-1).path, `/api/suite/packs/${t.id}/items/k1`);
  await call('POST', `/api/trips/${t.id}/pack/items`, { itemId: 'i9' });
  assert.deepEqual(calls.at(-1).body, { itemId: 'i9' });
  assert.equal((await call('GET', '/api/trips/pack/wardrobe?q=capp')).body[0].name, 'Cappello');
  assert.equal(calls.at(-1).path, '/api/suite/items?q=capp');
  assert.equal((await call('POST', `/api/trips/${t.id}/pack/return`, { itemIds: ['i1', 'i2', 'i3'] })).body.count, 3);
});

test('sera prima: quanti capi mancano in valigia', async () => {
  const t = sardegna();
  trips.addLeg(t.id, { mode: 'plane', from: 'Pisa', to: 'Cagliari', departAt: local('2026-11-02T10:30'), arriveAt: local('2026-11-02T11:40') });
  wardapp = () => json({ ...PACK, tripId: t.id });
  await call('POST', `/api/trips/${t.id}/pack`);
  const r = dueTripReminders(new Date('2026-11-01T20:00')).find((x) => x.title.startsWith('🧳'));
  assert.match(r.body, /Valigia: mancano 6 capi\./);
});

test('eliminare il viaggio elimina anche la valigia, anche se WardApp è giù', async () => {
  const t = sardegna();
  wardapp = () => { throw new TypeError('fetch failed'); };
  assert.equal((await call('DELETE', `/api/trips/${t.id}`)).status, 200);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === `/api/suite/packs/${t.id}`));
});

test('cambiare luogo o date azzera "meteo cambiato"', () => {
  const t = sardegna();
  assert.equal(trips.getTrip(t.id).weatherChanged, true);
  trips.updateTrip(t.id, { endDate: '2026-11-05' });
  assert.equal(trips.getTrip(t.id).weatherChanged, false);
});

test('il viaggio porta i conteggi dell\'ultima valigia', async () => {
  const t = sardegna();
  assert.equal(trips.getTrip(t.id).pack, null);
  wardapp = () => json({ ...PACK, tripId: t.id });
  await call('POST', `/api/trips/${t.id}/pack`);
  assert.deepEqual(trips.getTrip(t.id).pack, { total: 24, checked: 18 });
});

test('revisione: una preparazione non riuscita non rende la scheda di sola lettura', async () => {
  const t = sardegna();
  wardapp = () => json({ ...PACK, tripId: t.id });
  await call('POST', `/api/trips/${t.id}/pack`);
  wardapp = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  const r = (await call('POST', `/api/trips/${t.id}/pack`)).body;
  assert.equal(r.stale, false);
  assert.equal(r.pack.counts.total, 24);
  assert.match(r.error, /WardApp/);
});

test('revisione: il Bentornato propone il cesto di WardApp quando c\'è la valigia', async () => {
  const t = sardegna();
  wardapp = () => json({ ...PACK, tripId: t.id });
  await call('POST', `/api/trips/${t.id}/pack`);
  const r = dueTripReminders(new Date('2026-11-04T18:00')).find((x) => x.title === '🏠 Bentornato!');
  assert.match(r.body, /metto i capi usati nel cesto di WardApp\?/);
});
