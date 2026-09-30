import crypto from 'node:crypto';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';

const COOKIE = 'calendary_session';
const SESSION_DAYS = 365; // the kiosk tablet should stay logged in
const PUBLIC_PATHS = new Set(['/api/login', '/api/logout', '/api/session', '/api/health']);

const authConfigured = () => config.noAuth || config.password.length > 0;

let secretKey = null;
function key() {
  if (secretKey) return secretKey;
  let s = getSetting('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', s);
  }
  // The password is part of the key: changing it logs out every device.
  secretKey = crypto.createHash('sha256').update(`${s}:${config.password}`).digest();
  return secretKey;
}

const sign = (payload) => crypto.createHmac('sha256', key()).update(payload).digest('base64url');

function makeToken() {
  const payload = `v1.${Date.now() + SESSION_DAYS * 86400e3}.${crypto.randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;
  return Number(payload.split('.')[1]) > Date.now();
}

function passwordMatches(candidate) {
  const a = crypto.createHash('sha256').update(String(candidate || '')).digest();
  const b = crypto.createHash('sha256').update(config.password).digest();
  return crypto.timingSafeEqual(a, b);
}

// Tiny brute-force guard: 10 wrong attempts per IP every 15 minutes.
const attempts = new Map();
function tooManyAttempts(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60e3) return false;
  return a.count >= 10;
}
function recordFailure(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60e3) attempts.set(ip, { first: Date.now(), count: 1 });
  else a.count += 1;
}

function bearerMatches(req) {
  if (config.apiToken.length < 16) return false; // short tokens are ignored on purpose
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return false;
  const a = crypto.createHash('sha256').update(h.slice(7).trim()).digest();
  const b = crypto.createHash('sha256').update(config.apiToken).digest();
  return crypto.timingSafeEqual(a, b);
}

export const isAuthenticated = (req) => config.noAuth || verifyToken(req.cookies?.[COOKIE]) || bearerMatches(req);

export function registerAuth(app) {
  if (config.noAuth) app.log.warn('CALENDARY_NO_AUTH=1: autenticazione disattivata (solo per sviluppo!)');
  else if (!config.password) app.log.warn('Nessuna password configurata: le API resteranno bloccate finché non la imposti.');

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC_PATHS.has(path)) return;
    if (!authConfigured()) return reply.code(503).send({ error: "Imposta una password nelle opzioni dell'add-on" });
    if (!isAuthenticated(req)) return reply.code(401).send({ error: 'Accesso richiesto' });
  });

  app.get('/api/session', async (req) => ({
    authenticated: authConfigured() && isAuthenticated(req),
    authConfigured: authConfigured(),
  }));

  app.post('/api/login', async (req, reply) => {
    if (!authConfigured()) return reply.code(503).send({ error: "Imposta una password nelle opzioni dell'add-on" });
    if (config.noAuth) return { ok: true };
    const ip = req.ip;
    if (tooManyAttempts(ip)) return reply.code(429).send({ error: 'Troppi tentativi, riprova tra qualche minuto' });
    if (!passwordMatches(req.body?.password)) {
      recordFailure(ip);
      return reply.code(401).send({ error: 'Password errata' });
    }
    attempts.delete(ip);
    reply.setCookie(COOKIE, makeToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: SESSION_DAYS * 86400,
    });
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}
