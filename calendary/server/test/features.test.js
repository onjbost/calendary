import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-features-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';
process.env.ALEXA_REMINDERS = 'important';

const notes = await import('../src/notes.js');
const pills = await import('../src/pills.js');
const { desiredReminders } = await import('../src/alexa-reminders.js');
const store = await import('../src/store.js');
const { ymd } = await import('../src/util.js');

store.ensureDefaultCalendars();
const { db } = await import('../src/db.js');
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); }); // Windows: an open database can't be removed

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('notes', () => {
  test('create, edit, pin, delete', () => {
    const a = notes.createNote({ text: 'Comprare il latte' });
    const b = notes.createNote({ text: 'Chiamare l\'idraulico', color: '#5ee7ff' });
    assert.equal(b.color, '#5ee7ff');
    assert.ok(notes.NOTE_COLORS.includes(a.color));
    notes.updateNote(a.id, { pinned: true, text: 'Comprare il latte e il pane' });
    const list = notes.listNotes();
    assert.equal(list[0].id, a.id); // pinned first
    assert.equal(list[0].text, 'Comprare il latte e il pane');
    notes.updateNote(b.id, { color: '#000000' }); // unknown colors are ignored
    assert.equal(notes.listNotes().find((n) => n.id === b.id).color, '#5ee7ff');
    notes.deleteNote(b.id);
    assert.equal(notes.listNotes().length, 1);
    assert.throws(() => notes.deleteNote(b.id), /non trovata/);
  });
});

describe('pills', () => {
  test('validates times and days', () => {
    assert.throws(() => pills.createPill({ name: 'X', times: [] }), /orario/);
    assert.throws(() => pills.createPill({ name: 'X', times: ['25:00'] }), /orario/);
    assert.throws(() => pills.createPill({ name: 'X', times: ['08:00'], days: [] }), /giorno/);
    assert.throws(() => pills.createPill({ times: ['08:00'] }), /nome/);
  });

  test('daily doses, taking one, history', () => {
    const p = pills.createPill({ name: 'Vitamina D', dose: '1 compressa', times: ['20:00', '08:00', '08:00'] });
    assert.deepEqual(p.times, ['08:00', '20:00']);
    const today = ymd(new Date());
    const doses = pills.dosesOn(today);
    assert.equal(doses.length, 2);
    assert.equal(doses[0].time, '08:00');
    assert.equal(doses[0].takenAt, null);

    pills.setDose(p.id, today, '08:00', true);
    assert.ok(pills.dosesOn(today)[0].takenAt);
    // the time can be corrected, but not in the future
    const at = new Date(`${today}T08:20`);
    if (at.getTime() < Date.now()) {
      pills.setDose(p.id, today, '08:00', true, at.toISOString());
      assert.equal(pills.dosesOn(today)[0].takenAt, at.toISOString());
    }
    assert.throws(() => pills.setDose(p.id, today, '08:00', true, new Date(Date.now() + 3600e3).toISOString()), /futuro/);
    assert.throws(() => pills.setDose(p.id, today, '08:00', true, 'boh'), /non valido/);
    const h = pills.pillHistory({ days: 7 }).pills.find((x) => x.pillId === p.id);
    assert.ok(h.taken >= 1);
    assert.ok(h.scheduled >= h.taken);
    pills.setDose(p.id, today, '08:00', false);
    assert.equal(pills.dosesOn(today)[0].takenAt, null);
  });

  test('weekdays, therapy end and pausing are respected', () => {
    const tomorrow = new Date(Date.now() + 86400e3);
    const p = pills.createPill({ name: 'Antibiotico', times: ['12:00'], days: [tomorrow.getDay()] });
    assert.equal(pills.dosesOn(ymd(new Date())).filter((d) => d.pillId === p.id).length, 0);
    assert.equal(pills.dosesOn(ymd(tomorrow)).filter((d) => d.pillId === p.id).length, 1);
    pills.updatePill(p.id, { endDate: ymd(new Date()) });
    assert.equal(pills.dosesOn(ymd(tomorrow)).filter((d) => d.pillId === p.id).length, 0);
    pills.updatePill(p.id, { endDate: null, active: false });
    assert.equal(pills.dosesOn(ymd(tomorrow)).filter((d) => d.pillId === p.id).length, 0);
  });

  test('upcoming doses ring on Alexa until taken', () => {
    const at = new Date(Date.now() + 2 * 3600e3);
    const p = pills.createPill({ name: 'Omega 3', times: [hhmm(at)], startDate: ymd(at) });
    // daily dose: one reminder per day in the 3-day horizon; look at the first one
    const mine = () => desiredReminders().filter((r) => r.key.startsWith(`pill:${p.id}|${ymd(at)}|`));
    assert.equal(mine().length, 1);
    assert.match(mine()[0].text, /È ora della pillola: Omega 3/);
    pills.setDose(p.id, ymd(at), hhmm(at), true);
    assert.equal(mine().length, 0);
    pills.setDose(p.id, ymd(at), hhmm(at), false);
    pills.updatePill(p.id, { alexa: false });
    assert.equal(desiredReminders().filter((r) => r.key.startsWith(`pill:${p.id}|`)).length, 0);
  });
});

describe('pill history', () => {
  test('a day with two doses and one taken is 50%, even before the second is due', () => {
    const late = new Date(Date.now() + 2 * 3600e3);
    const lateTime = `${String(late.getHours()).padStart(2, '0')}:${String(late.getMinutes()).padStart(2, '0')}`;
    if (ymd(late) !== ymd(new Date())) return; // too close to midnight to test today
    const p = pills.createPill({ name: 'Keppra', dose: '1,5 compresse', times: ['00:00', lateTime], startDate: ymd(new Date()) });
    pills.setDose(p.id, ymd(new Date()), '00:00', true);
    const h = pills.pillHistory({ days: 1 }).pills.find((x) => x.pillId === p.id);
    assert.equal(h.scheduled, 2);
    assert.equal(h.taken, 1);
    assert.equal(h.pending, 1);
    assert.equal(h.percent, 50);
    assert.deepEqual(h.days[ymd(new Date())], { scheduled: 2, taken: 1 });
    assert.equal(pills.pillLog(ymd(new Date()).slice(0, 7)).filter((d) => d.pillId === p.id).length, 2);
    pills.deletePill(p.id);
  });

  test('all-time history since the therapy started, with streak and monthly log', () => {
    const day = (n) => ymd(new Date(Date.now() - n * 86400e3));
    const p = pills.createPill({ name: 'Ferro', times: ['00:01'], startDate: day(60) });
    // taken every day except 40 days ago
    for (let n = 60; n >= 1; n -= 1) if (n !== 40) pills.setDose(p.id, day(n), '00:01', true);
    const all = pills.pillHistory({ all: true });
    assert.ok(all.from <= day(60));
    const h = all.pills.find((x) => x.pillId === p.id);
    assert.equal(h.firstDate, day(60));
    assert.equal(h.scheduled, 61); // 60 past days + today
    assert.ok(h.taken === 59);
    assert.equal(h.streak, 39 + (h.days[day(0)]?.taken ? 1 : 0)); // days 39..1 (today is not complete yet)
    assert.equal(pills.pillHistory({ days: 14 }).pills.find((x) => x.pillId === p.id).scheduled, 14);

    const month = day(40).slice(0, 7);
    const log = pills.pillLog(month).filter((d) => d.pillId === p.id);
    assert.ok(log.some((d) => d.date === day(40) && !d.takenAt));
    assert.ok(log.every((d) => d.date.startsWith(month)));
    assert.throws(() => pills.pillLog('2026-13-01'), /Mese/);
  });

  test('a paused or edited therapy keeps its past', () => {
    const day = (n) => ymd(new Date(Date.now() - n * 86400e3));
    const p = pills.createPill({ name: 'Magnesio', times: ['00:02'], startDate: day(5) });
    pills.setDose(p.id, day(3), '00:02', true);
    pills.updatePill(p.id, { times: ['00:03'] }); // the old 00:02 dose is still in the history
    assert.ok(pills.pillLog(day(3).slice(0, 7)).some((d) => d.pillId === p.id && d.time === '00:02' && d.takenAt));
    pills.updatePill(p.id, { active: false });
    assert.equal(pills.getPill(p.id).pausedAt, ymd(new Date()));
    const h = pills.pillHistory({ all: true }).pills.find((x) => x.pillId === p.id);
    assert.ok(h, 'paused therapies stay in the history');
    assert.equal(h.days[ymd(new Date())], undefined); // nothing due from the pause on
    pills.updatePill(p.id, { active: true });
    assert.equal(pills.getPill(p.id).pausedAt, null);
  });
});

describe('events on Alexa', () => {
  test('alexaMinutes is stored, kept on partial updates and cleared with null', () => {
    const ev = store.createEvent({ title: 'Dentista', start: new Date(Date.now() + 5 * 3600e3), alexaMinutes: 15 });
    assert.equal(ev.alexaMinutes, 15);
    assert.equal(store.updateEvent(ev.id, { title: 'Dentista (studio nuovo)' }).alexaMinutes, 15);
    assert.ok(desiredReminders().some((r) => r.key.startsWith(`${ev.id}|`) && /Tra 15 minuti/.test(r.text)));
    assert.equal(store.updateEvent(ev.id, { alexaMinutes: null }).alexaMinutes, null);
    assert.ok(!desiredReminders().some((r) => r.key.startsWith(`${ev.id}|`)));
  });
});

describe('travel mode', () => {
  test('no Alexa reminders or announcements during a trip', async () => {
    const travel = await import('../src/travel.js');
    const { announce } = await import('../src/announce.js');
    const tomorrow = new Date(Date.now() + 86400e3);
    tomorrow.setHours(10, 0, 0, 0);
    const ev = store.createEvent({ title: 'Riunione in sede', start: tomorrow, alexaMinutes: 10 });
    const planned = () => desiredReminders().some((r) => r.key.startsWith(`${ev.id}|`));
    assert.ok(planned());

    assert.throws(() => travel.createTrip({ startDate: ymd(tomorrow), endDate: ymd(new Date()) }), /prima della partenza/);
    const trip = travel.createTrip({ startDate: ymd(tomorrow), endDate: ymd(new Date(tomorrow.getTime() + 2 * 86400e3)), note: 'Lisbona' });
    assert.equal(travel.tripAt(tomorrow).note, 'Lisbona');
    assert.equal(travel.tripAt(new Date()), null);
    assert.ok(!planned());

    const today = travel.createTrip({ startDate: ymd(new Date()), endDate: ymd(new Date()) });
    assert.equal((await announce('ciao')).skipped, 'modalità viaggio');
    travel.deleteTrip(today.id);
    travel.deleteTrip(trip.id);
    assert.ok(planned());
  });
});

describe('announcements through Home Assistant', () => {
  test('Alexa Devices notify entities are sent with notify.send_message', async () => {
    process.env.SUPERVISOR_TOKEN = 'sv-token';
    const { config } = await import('../src/config.js');
    const { announce } = await import('../src/announce.js');
    config.announce.services = ['notify.echo_dot_announce'];
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
      return new Response('[]', { status: 200 });
    };
    try {
      const r = await announce('🔔 Prova\nda Calendary', { strict: true });
      assert.equal(r.sent, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://supervisor/core/api/services/notify/send_message');
      assert.equal(calls[0].auth, 'Bearer sv-token');
      assert.deepEqual(calls[0].body, { entity_id: 'notify.echo_dot_announce', message: 'Prova. da Calendary' });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.SUPERVISOR_TOKEN;
      config.announce.services = [];
    }
  });
});

describe('pill stock', () => {
  test('daily use, days left, auto decrement and boxes', () => {
    const p = pills.createPill({ name: 'Keppra', dose: '1,5 compresse', unitsPerDose: '1,5', times: ['09:00', '21:00'], boxSize: 60, stock: 30, lowDays: 7 });
    assert.equal(p.unitsPerDose, 1.5);
    let s = pills.stockInfo(p);
    assert.equal(s.perDay, 3);
    assert.equal(s.daysLeft, 10);
    assert.equal(s.low, false);

    const day = ymd(new Date(Date.now() - 86400e3));
    pills.setDose(p.id, day, '09:00', true);
    assert.equal(pills.getPill(p.id).stock, 28.5);
    pills.setDose(p.id, day, '09:00', true, new Date(`${day}T09:30`).toISOString()); // only the time changes
    assert.equal(pills.getPill(p.id).stock, 28.5);
    pills.setDose(p.id, day, '09:00', false); // "non presa": back in the box
    assert.equal(pills.getPill(p.id).stock, 30);

    pills.updateStock(p.id, { stock: 20 });
    s = pills.stockInfo(pills.getPill(p.id));
    assert.equal(s.daysLeft, 6);
    assert.equal(s.low, true);
    pills.updateStock(p.id, { addBoxes: 1 });
    assert.equal(pills.getPill(p.id).stock, 80);
    assert.equal(pills.stockInfo(pills.getPill(p.id)).boxes, 1.33);

    // a therapy that ends before the pills do is not "low"
    pills.updatePill(p.id, { endDate: ymd(new Date(Date.now() + 2 * 86400e3)) });
    pills.updateStock(p.id, { stock: 9 });
    assert.equal(pills.stockInfo(pills.getPill(p.id)).low, false);

    // untracked stock
    const q = pills.createPill({ name: 'Senza scorta', times: ['08:00'] });
    assert.equal(pills.stockInfo(q), null);
    pills.setDose(q.id, day, '08:00', true);
    assert.equal(pills.getPill(q.id).stock, null);
    assert.throws(() => pills.updateStock(q.id, { addBoxes: 1 }), /scatola/);
  });
});
