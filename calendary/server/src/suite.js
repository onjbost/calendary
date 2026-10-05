import crypto from 'node:crypto';
import { config } from './config.js';

// "Suite": Calendary, Moveo and WardApp are separate apps that share one secret (Calendary's api_token =
// the others' calendary_token). With it they call each other's API and sign single-use login tickets,
// so a link from one app opens the other already signed in.

const TICKET_TTL_MS = 2 * 60_000;
const usedNonces = new Map();

export const suiteSecretOk = () => config.apiToken.length >= 16;
export const moveoEnabled = () => suiteSecretOk() && !!config.moveo.url;

const key = () => crypto.createHash('sha256').update(`suite-sso|${config.apiToken}`).digest();
const b64 = (s) => Buffer.from(s).toString('base64url');

/** Only same-app absolute paths: never another origin. */
export function safePath(next) {
  const p = typeof next === 'string' ? next : '/';
  return p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') ? p.slice(0, 1000) : '/';
}

export function signTicket(issuer, next) {
  const payload = b64(JSON.stringify({ iss: issuer, exp: Date.now() + TICKET_TTL_MS, n: crypto.randomBytes(9).toString('hex'), next: safePath(next) }));
  const sig = crypto.createHmac('sha256', key()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Returns the target path when the ticket is valid, unexpired, unused and issued by `issuer` (one or a list); otherwise null. */
export function verifyTicket(ticket, issuer) {
  const issuers = Array.isArray(issuer) ? issuer : [issuer];
  if (!suiteSecretOk() || typeof ticket !== 'string') return null;
  const i = ticket.lastIndexOf('.');
  if (i < 0) return null;
  const payload = ticket.slice(0, i);
  const sig = Buffer.from(ticket.slice(i + 1));
  const expected = Buffer.from(crypto.createHmac('sha256', key()).update(payload).digest('base64url'));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!issuers.includes(data.iss) || !(data.exp > Date.now()) || usedNonces.has(data.n)) return null;
  usedNonces.set(data.n, data.exp);
  for (const [n, exp] of usedNonces) if (exp < Date.now()) usedNonces.delete(n);
  return safePath(data.next);
}

export const wardappEnabled = () => suiteSecretOk() && !!config.wardapp.url;

/** What was worn today, from WardApp, for the dashboard card "Oggi indosso". */
export async function wardappToday() {
  if (!wardappEnabled()) return { enabled: false };
  const base = { enabled: true, publicUrl: config.wardapp.publicUrl };
  try {
    const res = await fetch(`${config.wardapp.url}/api/suite/today`, {
      headers: { authorization: `Bearer ${config.apiToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ...base, error: `WardApp ${res.status}` };
    return { ...base, ...(await res.json()) };
  } catch (err) {
    return { ...base, error: `WardApp non raggiungibile (${err.cause?.code || err.message})` };
  }
}

/** Today's training summary from Moveo, for the dashboard and kiosk card. */
export async function moveoToday() {
  if (!moveoEnabled()) return { enabled: false };
  const base = { enabled: true, publicUrl: config.moveo.publicUrl };
  try {
    const res = await fetch(`${config.moveo.url}/api/suite/today`, {
      headers: { authorization: `Bearer ${config.apiToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ...base, error: `Moveo ${res.status}` };
    return { ...base, ...(await res.json()) };
  } catch (err) {
    return { ...base, error: `Moveo non raggiungibile (${err.cause?.code || err.message})` };
  }
}

/**
 * Everything for the tablet's "Moveo" tab: today's summary plus, when Moveo offers /api/suite/overview,
 * the last workouts, the next ones and the programs. Older Moveo versions only have /today: `overview` is then false.
 */
export async function moveoOverview() {
  const today = await moveoToday();
  if (!today.enabled || today.error) return { ...today, overview: false };
  try {
    const res = await fetch(`${config.moveo.url}/api/suite/overview`, {
      headers: { authorization: `Bearer ${config.apiToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ...today, overview: false };
    const data = await res.json();
    return {
      ...today,
      overview: true,
      recent: Array.isArray(data.recent) ? data.recent.slice(0, 20) : [],
      upcoming: Array.isArray(data.upcoming) ? data.upcoming.slice(0, 20) : [],
      programs: Array.isArray(data.programs) ? data.programs.slice(0, 50) : [],
    };
  } catch {
    return { ...today, overview: false };
  }
}
