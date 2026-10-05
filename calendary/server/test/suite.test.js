import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-suite-'));
process.env.CALENDARY_API_TOKEN = 's'.repeat(24);
process.env.WARDAPP_URL = '';

const { signTicket, verifyTicket, wardappToday } = await import('../src/suite.js');

test('il ticket emesso da WardApp è accettato da /sso, come quello di Moveo', () => {
  assert.equal(verifyTicket(signTicket('wardapp', '/notes'), ['moveo', 'wardapp']), '/notes');
  assert.equal(verifyTicket(signTicket('moveo', '/'), ['moveo', 'wardapp']), '/');
});

test('emittenti sconosciuti o il ticket di Calendary stesso vengono rifiutati', () => {
  assert.equal(verifyTicket(signTicket('calendary', '/'), ['moveo', 'wardapp']), null);
  assert.equal(verifyTicket(signTicket('altro', '/'), ['moveo', 'wardapp']), null);
});

test('un emittente singolo funziona ancora', () => {
  assert.equal(verifyTicket(signTicket('moveo', '/x'), 'moveo'), '/x');
});

test('senza wardapp_url la card WardApp è nascosta', async () => {
  assert.deepEqual(await wardappToday(), { enabled: false });
});
