import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-auth-'));
process.env.CALENDARY_PASSWORD = 'segreta';
process.env.CALENDARY_API_TOKEN = 'a'.repeat(24);

const { registerAuth, TRUST_PROXY } = await import('../src/auth.js');

// The real auth hook in front of fake routes with the same patterns as the app.
const app = Fastify({ logger: false, trustProxy: TRUST_PROXY });
await app.register(fastifyCookie);
registerAuth(app);
await app.register(async (api) => {
  api.get('/notes', async () => ({ notes: [] }));
  api.post('/alexa', async () => ({ ok: true }));
  for (const url of ['/mcp', '/mcp/:token']) api.route({ method: ['GET', 'POST'], url, handler: async () => ({ mcp: true }) });
}, { prefix: '/api' });

const get = (url, headers) => app.inject({ method: 'GET', url, headers });

test('le API richiedono l\'accesso, anche con percorsi codificati', async () => {
  for (const url of ['/api/notes', '/%61pi/notes', '/api/%6eotes', '/%61%70%69/notes', '/api/notes?x=1']) {
    assert.equal((await get(url)).statusCode, 401, url);
  }
});

test('il token api_token apre le API, anche con percorsi codificati', async () => {
  const auth = { authorization: `Bearer ${'a'.repeat(24)}` };
  assert.equal((await get('/api/notes', auth)).statusCode, 200);
  assert.equal((await get('/%61pi/notes', auth)).statusCode, 200);
});

test('Alexa e MCP restano raggiungibili senza sessione (hanno i loro controlli)', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/alexa' })).statusCode, 200);
  assert.equal((await get('/api/mcp')).statusCode, 200);
  assert.equal((await get('/api/mcp/token-qualsiasi')).statusCode, 200);
});

test('percorsi API inesistenti non rivelano nulla senza accesso', async () => {
  assert.equal((await get('/%61pi/non-esiste')).statusCode, 401);
});

test('il limite dei tentativi non si aggira cambiando X-Forwarded-For', async () => {
  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'no' }, remoteAddress: '203.0.113.5', headers: { 'x-forwarded-for': `198.51.100.${i}` } });
  }
  assert.equal(last.statusCode, 429);
});
