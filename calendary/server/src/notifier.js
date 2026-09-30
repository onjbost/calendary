import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { effectiveReminder, getAllEvents } from './agenda.js';
import { sendToAll } from './push.js';
import { fmtTime, nowIso, ymd } from './util.js';

function minutesLabel(min) {
  if (min <= 0) return 'Adesso';
  if (min < 60) return `Tra ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24 && m === 0 && h % 24 === 0) return h === 24 ? 'Domani' : `Tra ${h / 24} giorni`;
  return m ? `Tra ${h} h ${m} min` : `Tra ${h} h`;
}

async function checkReminders() {
  const now = Date.now();
  // Look back a few minutes so a restart doesn't lose reminders, look ahead up to a week for long reminders.
  const events = getAllEvents(new Date(now - 5 * 60e3), new Date(now + 7 * 86400e3));
  const isNotified = db.prepare('SELECT 1 FROM notified WHERE key = ?');
  const markNotified = db.prepare('INSERT OR IGNORE INTO notified (key, sent_at) VALUES (?, ?)');

  for (const ev of events) {
    if (ev.allDay || ev.done) continue; // a routine already ticked off needs no reminder
    const reminder = effectiveReminder(ev);
    if (reminder === null) continue;
    const start = Date.parse(ev.start);
    const fireAt = start - reminder * 60e3;
    if (now < fireAt || now > start + 60e3) continue;
    const key = `${ev.id}|${ev.start}|${reminder}`;
    if (isNotified.get(key)) continue;
    markNotified.run(key, nowIso());
    const minutesLeft = Math.max(0, Math.round((start - now) / 60e3));
    const where = ev.location ? ` · ${ev.location}` : '';
    await sendToAll({
      title: `${ev.important ? '⚡ ' : '⏰ '}${minutesLabel(minutesLeft)}: ${ev.title}`,
      body: `${fmtTime(ev.start)} – ${fmtTime(ev.end)}${where}${ev.important ? '\nConta fino a 5 e parti: 5, 4, 3, 2, 1… vai!' : ''}`,
      url: `/calendario?view=day&date=${ymd(ev.start)}`,
      tag: key,
      important: ev.important,
    });
  }

  db.prepare('DELETE FROM notified WHERE sent_at < ?').run(new Date(now - 14 * 86400e3).toISOString());
}

async function checkMorningSummary() {
  const at = config.morningSummary;
  if (!/^\d{1,2}:\d{2}$/.test(at)) return;
  const now = new Date();
  const [h, m] = at.split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < h * 60 + m) return;
  const today = ymd(now);
  if (getSetting('last_morning_summary') === today) return;
  setSetting('last_morning_summary', today);
  // Server started late in the day: skip, a "good morning" at 20:00 is just noise.
  if (nowMin > h * 60 + m + 180) return;

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86400e3);
  const events = getAllEvents(dayStart, dayEnd);
  const urgent = db.prepare('SELECT title FROM tasks WHERE date = ? AND quadrant = 1 AND done = 0').all(today);
  if (!events.length && !urgent.length) return;

  const timed = events.filter((e) => !e.allDay).slice(0, 4).map((e) => `${fmtTime(e.start)} ${e.title}`);
  const lines = [];
  if (events.length) lines.push(`${events.length} ${events.length === 1 ? 'evento' : 'eventi'} oggi${timed.length ? ': ' + timed.join(', ') : ''}`);
  if (urgent.length) lines.push(`🔥 ${urgent.length} urgenti e importanti: ${urgent.slice(0, 3).map((t) => t.title).join(', ')}`);
  await sendToAll({ title: '☀️ Buongiorno! Ecco la tua giornata', body: lines.join('\n'), url: '/', tag: `summary-${today}` });
}

async function tick() {
  try {
    await checkReminders();
    await checkMorningSummary();
  } catch (err) {
    console.error('Notifier:', err);
  }
}

export function startNotifier() {
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}
