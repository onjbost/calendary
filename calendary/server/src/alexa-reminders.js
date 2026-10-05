import crypto from 'node:crypto';
import { config } from './config.js';
import { effectiveReminder, getAllEvents } from './agenda.js';
import { atTime, dayLabel, inMinutes } from './alexa-speech.js';
import { db, deleteSetting, getSetting, setSetting } from './db.js';
import { dosesBetween } from './pills.js';
import { localStamp, nowIso } from './util.js';

// Calendary → Alexa: upcoming reminders are mirrored as Alexa reminders, so the Echo devices
// chime and read them aloud (Amazon gives third-party skills reminders, not alarms).
//
// The Reminders API needs a token that Alexa only hands to the skill inside a request. When the
// user talks to the skill we use that one; otherwise the server sends itself a Skill Message
// (Skill Messaging API, LWA client credentials) and Alexa calls /api/alexa back with a fresh token.

export const REMINDERS_SCOPE = 'alexa::alerts:reminders:skill:readwrite';
const HORIZON_MS = 3 * 86400e3; // keep the next 3 days scheduled on Alexa
const MAX_REMINDERS = 40;
const MIN_LEAD_MS = 90e3; // Alexa refuses reminders in the past; leave room for the round trip
const KEEP_FIRING_MS = 120e3; // a reminder about to fire is left alone even if it fell out of the plan

// ------------------------------------------------------------------ account

export function rememberAlexaUser(system) {
  const userId = system?.user?.userId;
  if (!userId) return;
  if (getSetting('alexa_user_id') !== userId) {
    // A new user id means the skill was re-enabled: Alexa already dropped the old reminders.
    db.prepare('DELETE FROM alexa_reminders').run();
    setSetting('alexa_user_id', userId);
  }
  if (system.apiEndpoint) setSetting('alexa_api_endpoint', system.apiEndpoint);
  // Alexa reports the status per scope; older payloads only carry a consent token, which for this skill
  // (it asks for reminders only) means the same thing.
  const perms = system.user.permissions;
  const permission = perms?.scopes?.[REMINDERS_SCOPE]?.status || (perms?.consentToken ? 'GRANTED' : null);
  if (permission) setSetting('alexa_permission', permission);
  setSetting('alexa_last_seen', nowIso());
}

export function setPermission(status) {
  setSetting('alexa_permission', status);
}

export function forgetAlexaUser() {
  for (const k of ['alexa_user_id', 'alexa_permission', 'alexa_api_endpoint']) deleteSetting(k);
  db.prepare('DELETE FROM alexa_reminders').run();
}

export const remindersGranted = () => getSetting('alexa_permission') === 'GRANTED';
// Without skill events we may not know yet: worth a try, Amazon answers 401 if it is really missing.
export const remindersAllowed = () => getSetting('alexa_permission') !== 'DENIED';

// --------------------------------------------------------------- the plan

const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

/**
 * Minutes before the start at which the event rings on Alexa, or null.
 * The "🔊 Alexa" option of the event wins; what you dictated to Alexa rings at its time;
 * with alexa_reminders = all every event with a reminder rings too.
 */
export function alexaMinutesFor(ev) {
  if (ev.alexaMinutes !== null && ev.alexaMinutes !== undefined) return ev.alexaMinutes;
  if (ev.source === 'alexa') return effectiveReminder(ev);
  if (config.alexa.reminders === 'all') return effectiveReminder(ev);
  return null;
}

export const pillText = (d) => `È ora della pillola: ${d.name}${d.dose ? `, ${d.dose}` : ''}`.slice(0, 140);

/** What Alexa says when the reminder rings (day words are relative to that moment, not to now). */
export function reminderText(ev, minutes) {
  const where = ev.location ? `, ${ev.location}` : '';
  const firesAt = new Date(Date.parse(ev.start) - minutes * 60e3);
  const day = dayLabel(ev.start, firesAt);
  let text;
  if (minutes === 0) text = `È ora: ${ev.title}${where}`;
  else if (minutes < 360 && day === 'oggi') text = `${inMinutes(minutes)}, ${atTime(ev.start)}: ${ev.title}${where}`;
  else text = `Promemoria: ${day} ${atTime(ev.start)}, ${ev.title}${where}`;
  return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 140);
}

/** Reminders that should exist on Alexa right now, soonest first. */
export function desiredReminders(now = Date.now()) {
  if (config.alexa.reminders === 'off') return [];
  const events = getAllEvents(new Date(now), new Date(now + HORIZON_MS + 7 * 86400e3));
  const list = [];
  for (const ev of events) {
    if (ev.allDay || ev.done) continue;
    const minutes = alexaMinutesFor(ev);
    if (minutes === null) continue;
    const fireAt = Date.parse(ev.start) - minutes * 60e3;
    if (fireAt < now + MIN_LEAD_MS || fireAt > now + HORIZON_MS) continue;
    const text = reminderText(ev, minutes);
    list.push({ key: `${ev.id}|${ev.start}|${minutes}|${shortHash(text)}`, fireAt, text });
  }
  // Pills: every dose not taken yet rings at its time (taking it early removes the reminder).
  for (const d of dosesBetween(new Date(now + MIN_LEAD_MS), new Date(now + HORIZON_MS))) {
    if (!d.alexa || d.takenAt) continue;
    const text = pillText(d);
    list.push({ key: `pill:${d.pillId}|${d.date}|${d.time}|${shortHash(text)}`, fireAt: Date.parse(d.at), text });
  }
  // "Prova promemoria" button: a one-off reminder a couple of minutes from now.
  const test = testReminder();
  if (test && test.fireAt >= now + MIN_LEAD_MS) list.push(test);
  return list.sort((a, b) => a.fireAt - b.fireAt).slice(0, MAX_REMINDERS);
}

export function planDiff(now = Date.now()) {
  const want = desiredReminders(now);
  const have = db.prepare('SELECT key, alert_token, fire_at FROM alexa_reminders').all();
  const wantKeys = new Set(want.map((w) => w.key));
  const haveKeys = new Set(have.map((h) => h.key));
  const stale = have.filter((h) => !wantKeys.has(h.key));
  return {
    create: want.filter((w) => !haveKeys.has(w.key)),
    remove: stale.filter((h) => Date.parse(h.fire_at) > now + KEEP_FIRING_MS),
    // already rung on Alexa: forget the row (kept a while so the notifier knows Alexa handled it)
    expired: stale.filter((h) => Date.parse(h.fire_at) < now - 15 * 60e3),
  };
}

// ---------------------------------------------------------------- the sync

const status = { lastSync: null, lastError: null };
export const syncStatus = () => ({
  ...status,
  scheduled: db.prepare('SELECT COUNT(*) AS n FROM alexa_reminders').get().n,
});

function fail(message) {
  status.lastError = message;
  console.error('Promemoria Alexa:', message);
  return { ok: false, error: message };
}

/** Amazon's explanation of a 401/403 from the Reminders API. */
async function amazonRefusal(res) {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = j.message || j.code || body;
    } catch {
      detail = body;
    }
  } catch { /* no body */ }
  if (/in session/i.test(String(detail))) {
    // Amazon no longer lets the skill create reminders on its own: stop sending Skill Messages that can't work.
    setSetting('alexa_session_only', '1');
    return 'Amazon permette di creare i promemoria solo mentre parli con la skill: di\' "Alexa, chiedi ad AiCal di aggiornare i promemoria" '
      + '(o usa qualsiasi comando di AiCal) e Calendary programma quelli dei prossimi 3 giorni. Per avvisi del tutto automatici usa gli annunci di Home Assistant.';
  }
  return `Amazon ha rifiutato il promemoria (${res.status}${detail ? `: ${String(detail).slice(0, 160)}` : ''}). `
    + 'Se il permesso Promemoria è concesso nell\'app Alexa, prova da un Echo vero: il simulatore della console non gestisce i promemoria.';
}

// One sync at a time: a voice request and a Skill Message may arrive together.
let queue = Promise.resolve();

/** Applies the plan with an Alexa API token (only valid inside an Alexa request). */
export function syncWithToken(apiAccessToken, apiEndpoint) {
  const run = queue.then(() => applyPlan(apiAccessToken, apiEndpoint)).catch((err) => fail(err.message));
  queue = run;
  return run;
}

async function applyPlan(apiAccessToken, apiEndpoint) {
  const now = Date.now();
  const { create, remove, expired } = planDiff(now);
  const forget = db.prepare('DELETE FROM alexa_reminders WHERE key = ?');
  for (const row of expired) forget.run(row.key);
  const headers = { authorization: `Bearer ${apiAccessToken}`, 'content-type': 'application/json' };
  let created = 0;
  let removed = 0;
  let error = null;

  for (const row of remove) {
    const res = await fetch(`${apiEndpoint}/v1/alerts/reminders/${encodeURIComponent(row.alert_token)}`, {
      method: 'DELETE', headers, signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) return fail(await amazonRefusal(res));
    if (res.ok || res.status === 404) {
      forget.run(row.key);
      removed += 1;
    }
  }

  const insert = db.prepare('INSERT OR REPLACE INTO alexa_reminders (key, alert_token, fire_at, created_at) VALUES (?, ?, ?, ?)');
  for (const r of create) {
    const res = await fetch(`${apiEndpoint}/v1/alerts/reminders`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        requestTime: `${localStamp(new Date(now))}:00.000`,
        trigger: { type: 'SCHEDULED_ABSOLUTE', scheduledTime: `${localStamp(new Date(r.fireAt))}:00.000`, timeZoneId: config.timezone },
        alertInfo: { spokenInfo: { content: [{ locale: 'it-IT', text: r.text }] } },
        pushNotification: { status: 'ENABLED' },
      }),
    });
    // 401/403 doesn't always mean "no permission" (the console simulator, an expired token…): keep Amazon's words
    // and don't remember it as denied, the permission status comes from Alexa's own payloads.
    if (res.status === 401 || res.status === 403) return fail(await amazonRefusal(res));
    if (!res.ok) { // skip this one, the others can still go through
      error = `Alexa ha rifiutato "${r.text}" (${res.status}): ${(await res.text()).slice(0, 200)}`;
      continue;
    }
    setPermission('GRANTED'); // Alexa accepted it: the permission is there, whatever the payloads said
    const { alertToken } = await res.json();
    insert.run(r.key, alertToken, new Date(r.fireAt).toISOString(), nowIso());
    created += 1;
  }

  status.lastSync = nowIso();
  if (error) return { ...fail(error), created, removed };
  status.lastError = null;
  return { ok: true, created, removed };
}

let lwa = { token: null, until: 0 };
async function lwaToken() {
  if (lwa.token && Date.now() < lwa.until) return lwa.token;
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.alexa.clientId,
      client_secret: config.alexa.clientSecret,
      scope: 'alexa:skill_messaging',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`login Amazon fallito (${res.status}): controlla alexa_client_id e alexa_client_secret`);
  const data = await res.json();
  lwa = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  return lwa.token;
}

let lastMessageAt = 0;
export const canSyncOutOfSession = () => !!(config.alexa.clientId && config.alexa.clientSecret) && getSetting('alexa_session_only') !== '1';
export const sessionOnly = () => getSetting('alexa_session_only') === '1';

/**
 * Asks Alexa to call us back (Messaging.MessageReceived) when the plan changed.
 * Returns what happened, for the "Sincronizza ora" button.
 */
const TEST_LEAD_MS = 150e3;

function testReminder() {
  try {
    const t = JSON.parse(getSetting('alexa_test_reminder') || 'null');
    return t && Number.isFinite(t.fireAt) ? { key: `test|${t.fireAt}`, fireAt: t.fireAt, text: t.text } : null;
  } catch {
    return null;
  }
}

/**
 * Test button: schedules a reminder ~2.5 minutes from now and asks Alexa to sync (the reminder needs
 * Alexa's callback to be created). Returns when it will ring.
 */
export async function scheduleTestReminder() {
  // session-only: leave time to say "Alexa, chiedi ad AiCal di aggiornare i promemoria"
  const fireAt = Date.now() + (sessionOnly() ? 4 * 60e3 : TEST_LEAD_MS);
  setSetting('alexa_test_reminder', JSON.stringify({ fireAt, text: 'Prova di Calendary: le notifiche su Alexa funzionano!' }));
  if (sessionOnly()) return { ok: true, sessionOnly: true, fireAt: new Date(fireAt).toISOString() };
  const r = await requestSync({ force: true });
  return { ...r, fireAt: new Date(fireAt).toISOString() };
}

export async function requestSync({ force = false } = {}) {
  if (config.alexa.reminders === 'off') return { ok: true, skipped: 'promemoria Alexa disattivati' };
  const userId = getSetting('alexa_user_id');
  const endpoint = getSetting('alexa_api_endpoint');
  if (!userId || !endpoint) return { ok: false, error: 'apri almeno una volta la skill dicendo "Alexa, apri AiCal"' };
  if (sessionOnly() && !force) return { ok: false, error: 'Amazon crea i promemoria solo mentre parli con AiCal' };
  if (!config.alexa.clientId || !config.alexa.clientSecret) return { ok: false, error: 'mancano alexa_client_id e alexa_client_secret' };
  // Permission explicitly revoked (Alexa said so): retry now and then, Alexa tells us again once it is granted.
  if (!remindersAllowed() && !force && Date.now() - lastMessageAt < 3600e3) return { ok: false, error: 'permesso Promemoria non concesso nell\'app Alexa' };
  const { create, remove, expired } = planDiff();
  if (!create.length && !remove.length && !force) {
    const forget = db.prepare('DELETE FROM alexa_reminders WHERE key = ?');
    for (const row of expired) forget.run(row.key);
    return { ok: true, pending: 0 };
  }
  lastMessageAt = Date.now();
  try {
    const res = await fetch(`${endpoint}/v1/skillmessages/users/${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await lwaToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data: { action: 'sync-reminders' }, expiresAfterSeconds: 600 }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 403 || res.status === 404) {
      return fail(`Alexa non riconosce più l'utente (${res.status}): riapri la skill con "Alexa, apri AiCal"`);
    }
    if (!res.ok) return fail(`Skill Messaging ha risposto ${res.status}`);
    return { ok: true, pending: create.length + remove.length };
  } catch (err) {
    return fail(err.message);
  }
}

// Debounced trigger: many edits in a row (a study plan, an iCal sync) become one round trip.
let timer = null;
export function scheduleSync(delayMs = 20_000) {
  if (config.alexa.reminders === 'off' || !canSyncOutOfSession() || !getSetting('alexa_user_id')) return;
  clearTimeout(timer);
  timer = setTimeout(() => requestSync().catch((err) => fail(err.message)), delayMs);
}

export function startAlexaReminders() {
  // Up to 0.8.2 a 401/403 from Amazon was stored as "denied" and blocked the sync: forget it, Alexa's next request sets it again.
  if (getSetting('alexa_permission') === 'DENIED' && !getSetting('alexa_permission_v2')) deleteSetting('alexa_permission');
  setSetting('alexa_permission_v2', '1');
  if (config.alexa.reminders === 'off') return;
  // The horizon moves forward with time, so check periodically even if nothing was edited.
  setInterval(() => scheduleSync(0), 15 * 60e3);
  scheduleSync(30_000);
}
