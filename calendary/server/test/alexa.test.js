import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

// The server reads its configuration at import time: set it up before loading any module.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-alexa-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';
process.env.ALEXA_SKILL_ID = 'amzn1.ask.skill.test';
process.env.ALEXA_REMINDERS = 'important';

const { handleAlexa, parseAlexaDate, parseAlexaDuration, parseAlexaTime, resolveStart } = await import('../src/alexa.js');
const { validCertUrl, verifyAlexaRequest, verifyChain } = await import('../src/alexa-verify.js');
const { desiredReminders, planDiff, reminderText, syncWithToken } = await import('../src/alexa-reminders.js');
const { atTime, inMinutes } = await import('../src/alexa-speech.js');
const { spokenText } = await import('../src/announce.js');
const store = await import('../src/store.js');
const { db, getSetting, setSetting } = await import('../src/db.js');

store.ensureDefaultCalendars();
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function alexaRequest(request, { appId = 'amzn1.ask.skill.test', permission } = {}) {
  return {
    version: '1.0',
    context: {
      System: {
        application: { applicationId: appId },
        user: {
          userId: 'amzn1.ask.account.TEST',
          ...(permission ? { permissions: { scopes: { 'alexa::alerts:reminders:skill:readwrite': { status: permission } } } } : {}),
        },
        apiEndpoint: 'https://api.eu.amazonalexa.com',
        apiAccessToken: 'token-123',
      },
    },
    request: { requestId: 'r1', timestamp: new Date().toISOString(), locale: 'it-IT', ...request },
  };
}

const intent = (name, slots = {}) => ({
  type: 'IntentRequest',
  dialogState: 'COMPLETED',
  intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, typeof v === 'object' ? { name: k, ...v } : { name: k, value: v }])) },
});

describe('slot parsing', () => {
  const now = new Date(2026, 9, 5, 10, 0); // Monday 5 October 2026, 10:00

  test('dates', () => {
    assert.equal(ymdOf(parseAlexaDate('2026-10-08', now)), '2026-10-08');
    assert.equal(ymdOf(parseAlexaDate('PRESENT_REF', now)), '2026-10-05');
    assert.equal(ymdOf(parseAlexaDate('2026-W42', now)), '2026-10-12');
    assert.equal(ymdOf(parseAlexaDate('2026-W41', now)), '2026-10-05');
    assert.equal(ymdOf(parseAlexaDate('2026-W41-WE', now)), '2026-10-10');
    assert.equal(ymdOf(parseAlexaDate('2026-11', now)), '2026-11-01');
    assert.equal(parseAlexaDate('XXXX-XX-XX', now), null);
  });

  test('times and durations', () => {
    assert.deepEqual(parseAlexaTime('15:30'), [15, 30]);
    assert.deepEqual(parseAlexaTime('EV'), [19, 0]);
    assert.equal(parseAlexaTime('boh'), null);
    assert.equal(parseAlexaDuration('PT1H30M'), 90);
    assert.equal(parseAlexaDuration('PT45M'), 45);
    assert.equal(parseAlexaDuration('P1D'), 1440);
    assert.equal(parseAlexaDuration('PT'), null);
  });

  test('a time already passed today means tomorrow', () => {
    assert.equal(resolveStart(null, '09:00', now).getDate(), 6);
    assert.equal(resolveStart(null, '18:00', now).getDate(), 5);
    assert.equal(resolveStart('2026-10-05', '09:00', now).getDate(), 5); // explicit day: kept (and refused later)
  });

  test('spoken Italian', () => {
    assert.equal(atTime(new Date(2026, 9, 5, 9, 0)), 'alle 9');
    assert.equal(atTime(new Date(2026, 9, 5, 13, 5)), 'alle 13:05');
    assert.equal(atTime(new Date(2026, 9, 5, 1, 30)), "all'una e 30");
    assert.equal(inMinutes(30), 'tra 30 minuti');
    assert.equal(inMinutes(60), "tra un'ora");
    assert.equal(inMinutes(135), 'tra 2 ore e 15 minuti');
    assert.equal(spokenText('🔥 2 urgenti\n☀️ ciao'), '2 urgenti. ciao');
  });
});

describe('request verification', () => {
  test('certificate URL rules', () => {
    assert.ok(validCertUrl('https://s3.amazonaws.com/echo.api/echo-api-cert.pem'));
    assert.ok(validCertUrl('https://s3.amazonaws.com:443/echo.api/../echo.api/echo-api-cert.pem'));
    assert.ok(validCertUrl('https://S3.AMAZONAWS.COM/echo.api/echo-api-cert.pem'));
    assert.ok(!validCertUrl('http://s3.amazonaws.com/echo.api/echo-api-cert.pem'));
    assert.ok(!validCertUrl('https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem'));
    assert.ok(!validCertUrl('https://s3.amazonaws.com/invalid.path/echo-api-cert.pem'));
    assert.ok(!validCertUrl('https://invalid.s3.amazonaws.com/echo.api/echo-api-cert.pem'));
    assert.ok(!validCertUrl('https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem'));
    assert.ok(!validCertUrl('https://s3.amazonaws.com/echo.api/../evil/cert.pem'));
  });

  test("Amazon's real chain (cross-signed above Amazon Root CA 1) is trusted", () => {
    const pems = fs.readFileSync(new URL('./fixtures/echo-api-cert-2023.pem', import.meta.url), 'utf8')
      .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    const when = Date.parse('2023-06-01');
    assert.equal(verifyChain(pems, { now: when }).subjectAltName, 'DNS:echo-api.amazon.com');
    assert.throws(() => verifyChain(pems, { now: Date.parse('2024-06-01') }), /scaduto/);
    assert.throws(() => verifyChain([pems[0], pems[2]], { now: when }), /non valida/);
  });

  let hasOpenssl = true;
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    hasOpenssl = false;
  }

  describe('signature', { skip: !hasOpenssl && 'openssl non disponibile' }, () => {
    const dir = path.join(tmp, 'pki');
    const pem = {};
    const certUrl = 'https://s3.amazonaws.com/echo.api/echo-api-cert.pem';

    before(() => {
      fs.mkdirSync(dir);
      const run = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
      run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Test Root',
        '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign');
      for (const [name, san] of [['leaf', 'echo-api.amazon.com'], ['evil', 'evil.example.com']]) {
        run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${san}`);
        fs.writeFileSync(path.join(dir, `${name}.ext`), `subjectAltName=DNS:${san}\n`);
        run('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '1', '-extfile', `${name}.ext`);
      }
      for (const f of ['ca.pem', 'leaf.pem', 'leaf.key', 'evil.pem', 'evil.key']) pem[f] = fs.readFileSync(path.join(dir, f), 'utf8');
    });

    const signed = (keyName, body) => {
      const raw = JSON.stringify(body);
      const sig = crypto.sign('sha256', Buffer.from(raw), pem[keyName]).toString('base64');
      return { raw, headers: { signaturecertchainurl: certUrl, 'signature-256': sig } };
    };
    const opts = (leaf = 'leaf.pem') => ({
      roots: [new crypto.X509Certificate(pem['ca.pem'])],
      getChain: async () => [pem[leaf], pem['ca.pem']],
    });

    test('accepts a genuine request', async () => {
      const body = alexaRequest({ type: 'LaunchRequest' });
      const { raw, headers } = signed('leaf.key', body);
      await verifyAlexaRequest(headers, raw, body, opts());
    });

    test('rejects a tampered body', async () => {
      const body = alexaRequest({ type: 'LaunchRequest' });
      const { headers } = signed('leaf.key', body);
      const tampered = JSON.stringify({ ...body, extra: 1 });
      await assert.rejects(verifyAlexaRequest(headers, tampered, body, opts()), /Firma/);
    });

    test('rejects an old request', async () => {
      const body = alexaRequest({ type: 'LaunchRequest', timestamp: new Date(Date.now() - 200e3).toISOString() });
      const { raw, headers } = signed('leaf.key', body);
      await assert.rejects(verifyAlexaRequest(headers, raw, body, opts()), /scaduta/);
    });

    test('rejects a certificate not issued to echo-api.amazon.com', async () => {
      const body = alexaRequest({ type: 'LaunchRequest' });
      const { raw, headers } = signed('evil.key', body);
      await assert.rejects(verifyAlexaRequest(headers, raw, body, opts('evil.pem')), /echo-api/);
    });

    test('rejects an untrusted chain', async () => {
      const body = alexaRequest({ type: 'LaunchRequest' });
      const { raw, headers } = signed('leaf.key', body);
      await assert.rejects(verifyAlexaRequest(headers, raw, body, { getChain: opts().getChain }), /attendibile/);
    });
  });
});

describe('skill', () => {
  test('refuses other skills', async () => {
    await assert.rejects(handleAlexa(alexaRequest({ type: 'LaunchRequest' }, { appId: 'amzn1.ask.skill.other' })), /non autorizzata/);
  });

  test('a consent token alone counts as the reminders permission', async () => {
    const body = alexaRequest({ type: 'SessionEndedRequest' });
    body.context.System.user.permissions = { consentToken: 'consent-123' };
    await handleAlexa(body);
    assert.equal(getSetting('alexa_permission'), 'GRANTED');
    setSetting('alexa_permission', 'unknown'); // back to "not granted" for the next tests
  });

  test('launch offers the reminders permission card', async () => {
    const { response } = await handleAlexa(alexaRequest({ type: 'LaunchRequest' }));
    assert.equal(response.response.shouldEndSession, false);
    assert.equal(response.response.card.type, 'AskForPermissionsConsent');
  });

  test('adds a reminder', async () => {
    const tomorrow = new Date(Date.now() + 86400e3);
    const { response, after: then } = await handleAlexa(alexaRequest(
      intent('AddReminderIntent', { what: 'chiamare Marco', date: ymdOf(tomorrow), time: '18:00' }),
      { permission: 'GRANTED' },
    ));
    assert.match(response.response.outputSpeech.text, /alle 18 ti ricordo: chiamare Marco/);
    assert.equal(typeof then, 'function');
    const ev = db.prepare("SELECT * FROM events WHERE source = 'alexa' AND title = 'Chiamare Marco'").get();
    assert.ok(ev);
    assert.equal(ev.start_at, ev.end_at);
    assert.equal(ev.reminder_minutes, 0);
  });

  test('asks for the time when missing', async () => {
    const { response } = await handleAlexa(alexaRequest(intent('AddReminderIntent', { what: 'pagare la bolletta' })));
    assert.equal(response.response.directives[0].type, 'Dialog.ElicitSlot');
    assert.equal(response.response.directives[0].slotToElicit, 'time');
  });

  test('adds an important event with a duration', async () => {
    const day = new Date(Date.now() + 2 * 86400e3);
    const { response } = await handleAlexa(alexaRequest(intent('AddEventIntent', {
      what: 'dentista', date: ymdOf(day), time: '15:30', duration: 'PT45M', importance: 'importante',
    })));
    assert.match(response.response.outputSpeech.text, /Aggiunto come importante: dentista/);
    const ev = db.prepare("SELECT * FROM events WHERE title = 'Dentista'").get();
    assert.equal(ev.important, 1);
    assert.equal(Date.parse(ev.end_at) - Date.parse(ev.start_at), 45 * 60e3);
  });

  test('reads the agenda and the matrix', async () => {
    const day = new Date(Date.now() + 2 * 86400e3);
    await handleAlexa(alexaRequest(intent('AddTaskIntent', {
      task: 'consegnare la tesina',
      date: ymdOf(day),
      quadrant: { value: 'urgente e importante', resolutions: { resolutionsPerAuthority: [{ status: { code: 'ER_SUCCESS_MATCH' }, values: [{ value: { id: '1' } }] }] } },
    })));
    const { response } = await handleAlexa(alexaRequest(intent('GetAgendaIntent', { date: ymdOf(day) })));
    const text = response.response.outputSpeech.text;
    assert.match(text, /un impegno: alle 15:30 Dentista/);
    assert.match(text, /attività urgente e importante: Consegnare la tesina/);
  });

  test('tells the next event', async () => {
    const { response } = await handleAlexa(alexaRequest(intent('NextEventIntent')));
    assert.match(response.response.outputSpeech.text, /Il prossimo impegno è Chiamare Marco/);
  });
});

describe('reminders on Alexa', () => {
  test('plans voice reminders and events with the Alexa option, not the others', () => {
    store.createEvent({ title: 'Riunione qualunque', start: new Date(Date.now() + 3 * 3600e3), reminderMinutes: 10, important: true });
    store.createEvent({ title: 'Treno', start: new Date(Date.now() + 4 * 3600e3), alexaMinutes: 20 });
    const titles = desiredReminders().map((r) => r.text);
    assert.ok(titles.some((t) => /Chiamare Marco/.test(t)));
    assert.ok(titles.some((t) => /Dentista/.test(t)));
    assert.ok(!titles.some((t) => /Riunione qualunque/.test(t)));
    assert.ok(titles.some((t) => /Tra 20 minuti, .*Treno/.test(t)));
  });

  test('reminder wording', () => {
    const start = new Date();
    start.setHours(15, 30, 0, 0);
    assert.equal(reminderText({ title: 'Dentista', start: start.toISOString(), location: '' }, 30), 'Tra 30 minuti, alle 15:30: Dentista');
    assert.equal(reminderText({ title: 'Palestra', start: start.toISOString(), location: '' }, 0), 'È ora: Palestra');
    assert.equal(reminderText({ title: 'Esame', start: start.toISOString(), location: 'Aula 3' }, 1440), 'Promemoria: domani alle 15:30, Esame, Aula 3');
  });

  test('syncs the plan through the Reminders API', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'POST') return new Response(JSON.stringify({ alertToken: `alert-${++n}` }), { status: 201 });
      return new Response(null, { status: 204 });
    };
    try {
      const first = await syncWithToken('token-123', 'https://api.eu.amazonalexa.com');
      assert.equal(first.ok, true);
      assert.equal(first.created, 3);
      const post = calls.find((c) => c.method === 'POST');
      assert.equal(post.url, 'https://api.eu.amazonalexa.com/v1/alerts/reminders');
      assert.equal(post.body.trigger.type, 'SCHEDULED_ABSOLUTE');
      assert.equal(post.body.trigger.timeZoneId, 'Europe/Rome');
      assert.match(post.body.trigger.scheduledTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000$/);
      assert.equal(post.body.alertInfo.spokenInfo.content[0].locale, 'it-IT');

      // Nothing changed: nothing to do.
      assert.deepEqual(planDiff().create, []);

      // Deleting the event removes its reminder from Alexa.
      const ev = db.prepare("SELECT id FROM events WHERE title = 'Dentista'").get();
      store.deleteEvent(ev.id);
      calls.length = 0;
      const second = await syncWithToken('token-123', 'https://api.eu.amazonalexa.com');
      assert.equal(second.removed, 1);
      assert.equal(calls[0].method, 'DELETE');
      assert.match(calls[0].url, /\/v1\/alerts\/reminders\/alert-\d$/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a 401 from Amazon is reported with its message, without storing "denied"', async () => {
    store.createEvent({ title: 'Volo', start: new Date(Date.now() + 5 * 3600e3), alexaMinutes: 15 });
    const realFetch = globalThis.fetch;
    setSetting('alexa_permission', 'GRANTED');
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Request is not authorized' }), { status: 401 });
    try {
      const r = await syncWithToken('token-123', 'https://api.eu.amazonalexa.com');
      assert.equal(r.ok, false);
      assert.match(r.error, /401: Request is not authorized/);
      assert.equal(getSetting('alexa_permission'), 'GRANTED'); // what Alexa said about the permission stays
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('test reminder', () => {
  test('the test button plans a one-off reminder a couple of minutes ahead', async () => {
    const { scheduleTestReminder, desiredReminders: plan } = await import('../src/alexa-reminders.js');
    const r = await scheduleTestReminder(); // no Skill Messaging credentials here: it reports why it can't push
    assert.equal(r.ok, false);
    const t = plan().find((x) => x.key.startsWith('test|'));
    assert.ok(t);
    assert.match(t.text, /Prova di Calendary/);
    assert.ok(t.fireAt - Date.now() > 120e3 && t.fireAt - Date.now() < 160e3);
    assert.equal(Date.parse(r.fireAt), t.fireAt);
  });
});
