// Trip reminders (spec §7): flight check-in, the evening before leaving, welcome back. Checked every minute by the
// notifier; each one is sent once (table `notified`), as a push and on Alexa (announce() is silent in travel mode).
import { db, getSetting } from '../db.js';
import { announce } from '../announce.js';
import { sendToAll } from '../push.js';
import { addDays, fmtDay, fmtTime, nowIso, parseYmd, ymd } from '../util.js';
import { packCounts } from './pack.js';
import { listTrips } from './trips.js';

const DAY_START = 8; // a check-in opening at night is announced at 8
const DAY_END = 22;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const WHAT_TO_PACK = {
  plane: "documento d'identità, carta d'imbarco, liquidi max 100 ml nel bagaglio a mano",
  train: 'biglietto e posto',
  bus: 'biglietto e posto',
  car: 'pieno, pedaggi, patente e libretto',
  ferry: "biglietto e orario d'imbarco",
};

const at = (day, hhmm) => new Date(`${day}T${hhmm}`); // local time
const placeOf = (trip) => trip.place?.name || trip.name;

function dayWord(iso, now) {
  const d = ymd(new Date(iso));
  if (d === ymd(now)) return 'oggi';
  if (d === ymd(addDays(now, 1))) return 'domani';
  return `il ${fmtDay(iso)}`;
}

/** When the check-in opens, moved to 8:00 when that falls between 22:00 and 8:00. */
function checkinFire(leg) {
  const open = new Date(Date.parse(leg.departAt) - leg.checkinHours * 3600e3);
  const h = open.getHours();
  if (h >= DAY_START && h < DAY_END) return open;
  const day = h >= DAY_END ? ymd(addDays(open, 1)) : ymd(open);
  return at(day, '08:00');
}

function eveningTime() {
  const t = getSetting('trips_evening_time');
  return t && HHMM.test(t) ? t : '20:00';
}

/** The reminders due at `now` that were not sent yet: [{ key, title, body, url, speak }]. */
export function dueTripReminders(now = new Date()) {
  const t = now.getTime();
  const today = ymd(now);
  const sent = db.prepare('SELECT 1 FROM notified WHERE key = ?');
  const out = [];
  const add = (key, title, body, url) => {
    if (!sent.get(key)) out.push({ key, title, body, url, speak: true });
  };
  for (const trip of listTrips()) {
    if (trip.endDate < ymd(addDays(now, -1))) continue;
    const url = `/viaggi/${trip.id}`;
    const where = placeOf(trip);

    for (const leg of trip.legs) {
      if (leg.mode !== 'plane' || !leg.checkinHours) continue;
      const fire = checkinFire(leg);
      if (t >= fire.getTime() && t < Date.parse(leg.departAt)) {
        const route = [leg.code, [leg.from, leg.to].filter(Boolean).join(' → ')].filter(Boolean).join(' ');
        const booking = leg.booking ? ` · prenotazione ${leg.booking}` : '';
        add(`trip|${trip.id}|checkin|${leg.id}|${leg.departAt}`, '✈️ Check-in aperto', `${route} ${dayWord(leg.departAt, now)} alle ${fmtTime(leg.departAt)}${booking}`, url);
      }
    }

    // evening before: one per departure day of the outbound legs; without them the first leg that isn't the return,
    // and without that the trip's first day
    let outbound = trip.legs.filter((l) => l.direction === 'out');
    if (!outbound.length) outbound = trip.legs.filter((l) => l.direction !== 'back').slice(0, 1);
    const byDay = new Map();
    for (const leg of outbound) {
      const d = ymd(new Date(leg.departAt));
      byDay.set(d, [...(byDay.get(d) || []), leg]);
    }
    if (!outbound.length) byDay.set(trip.startDate, []);
    for (const [day, legs] of byDay) {
      const eve = ymd(addDays(parseYmd(day), -1));
      const fire = at(eve, eveningTime());
      const firstDepart = legs.length ? Math.min(...legs.map((l) => Date.parse(l.departAt))) : Infinity;
      if (today !== eve || t < fire.getTime() || t >= firstDepart) continue;
      const modes = [...new Set(legs.map((l) => l.mode))];
      const parts = modes.length ? modes.map((m) => WHAT_TO_PACK[m]) : ['documenti, caricabatterie e biglietti'];
      const counts = packCounts(trip.id);
      const missing = counts ? counts.total - counts.checked : 0;
      const suitcase = missing > 0 ? ` Valigia: mancano ${missing} ${missing === 1 ? 'capo' : 'capi'}.` : '';
      add(`trip|${trip.id}|evening|${day}`, `🧳 Domani si parte per ${where}`, `Prepara: ${[...new Set(parts)].join('; ')}.${suitcase}`, url);
    }

    // welcome back: an hour after the last return leg lands, else at 18:00 of the last day; only that day
    const back = trip.legs.filter((l) => l.direction === 'back').sort((a, b) => a.arriveAt.localeCompare(b.arriveAt)).at(-1);
    const fire = back ? new Date(Date.parse(back.arriveAt) + 3600e3) : at(trip.endDate, '18:00');
    if (t >= fire.getTime() && today === ymd(fire)) {
      const body = packCounts(trip.id)
        ? `Rientro da ${where}: svuota la valigia, metto i capi usati nel cesto di WardApp? Toccami per sceglierli.`
        : `Rientro da ${where}: svuota la valigia e rimetti a posto i capi.`;
      add(`trip|${trip.id}|return|${trip.endDate}`, '🏠 Bentornato!', body, url);
    }
  }
  return out;
}

/** Sends the due reminders. `send`/`speak` are replaceable (tests). */
export async function checkTripReminders(now = new Date(), { send = sendToAll, speak = announce } = {}) {
  const mark = db.prepare('INSERT OR IGNORE INTO notified (key, sent_at) VALUES (?, ?)');
  for (const r of dueTripReminders(now)) {
    if (!mark.run(r.key, nowIso()).changes) continue;
    await send({ title: r.title, body: r.body, url: r.url, tag: r.key });
    if (r.speak) await speak(`${r.title}. ${r.body}`);
  }
}
