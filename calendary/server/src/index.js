import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { registerAuth, startSession, TRUST_PROXY } from './auth.js';
import { verifyTicket } from './suite.js';
import { registerRoutes } from './routes.js';
import { registerAlexa } from './alexa.js';
import { registerMcp } from './mcp.js';
import { scheduleSync, startAlexaReminders } from './alexa-reminders.js';
import { onChange } from './stream.js';
import { initPush } from './push.js';
import { startIcsSync } from './ics.js';
import { startNotifier } from './notifier.js';
import { registerTripRoutes, startTrips } from './trips/index.js';
import { ensureDefaultCalendars } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST || path.resolve(here, '../../web/dist');

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: TRUST_PROXY, // Cloudflare tunnel / HA ingress in front (local addresses only)
  bodyLimit: 1_000_000,
});

app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: status >= 500 && !err.statusCode ? 'Errore interno del server' : err.message });
});

await app.register(fastifyCookie);
registerAuth(app);
await app.register(registerRoutes, { prefix: '/api' });
await app.register(registerAlexa, { prefix: '/api' });
await app.register(registerMcp, { prefix: '/api' });
await app.register(registerTripRoutes, { prefix: '/api' });

// Single sign-on from Moveo or WardApp: /sso?t=<ticket signed by them> → session cookie → redirect.
app.get('/sso', async (req, reply) => {
  const next = verifyTicket(req.query.t, ['moveo', 'wardapp']);
  if (!next) return reply.redirect('/?sso=scaduto');
  startSession(req, reply);
  return reply.redirect(next);
});

const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
if (hasWeb) {
  await app.register(fastifyStatic, {
    root: webDist,
    // @fastify/static >= 10 passes the Fastify reply here (older versions passed the raw response)
    setHeaders(reply, filePath) {
      const set = (k, v) => (typeof reply.header === 'function' ? reply.header(k, v) : reply.setHeader(k, v));
      const name = path.basename(filePath);
      if (filePath.includes(`${path.sep}assets${path.sep}`)) set('cache-control', 'public, max-age=31536000, immutable');
      else if (name === 'sw.js' || name === 'index.html' || name.endsWith('.webmanifest')) set('cache-control', 'no-cache');
    },
  });
} else {
  app.log.warn(`Frontend non trovato in ${webDist}: esegui "npm run build" in web/`);
}

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Endpoint non trovato' });
  if ((req.method === 'GET' || req.method === 'HEAD') && hasWeb) return reply.header('cache-control', 'no-cache').sendFile('index.html');
  return reply.code(404).send('Not found');
});

ensureDefaultCalendars();
initPush();
startIcsSync();
startNotifier();
startTrips();
startAlexaReminders();
onChange((scope) => {
  if (['events', 'goals', 'calendars', 'pills'].includes(scope)) scheduleSync();
});

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Hubitat pronto su http://localhost:${config.port} (fuso ${config.timezone})`);
