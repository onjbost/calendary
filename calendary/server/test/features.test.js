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
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

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
    pills.setDose(p.id, today, '08:00', true); // idempotent
    const h = pills.pillHistory(7).pills.find((x) => x.pillId === p.id);
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
