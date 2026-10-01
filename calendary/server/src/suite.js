import crypto from 'node:crypto';
import { config } from './config.js';

// "Suite": Calendary and Moveo are separate apps that share one secret (Calendary's api_token =
// Moveo's calendary_token). With it they call each other's API and sign single-use login tickets,
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

/** Returns the target path when the ticket is valid, unexpired, unused and issued by `issuer`; otherwise null. */
export function verifyTicket(ticket, issuer) {
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
  if (data.iss !== issuer || !(data.exp > Date.now()) || usedNonces.has(data.n)) return null;
  usedNonces.set(data.n, data.exp);
  for (const [n, exp] of usedNonces) if (exp < Date.now()) usedNonces.delete(n);
  return safePath(data.next);
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
