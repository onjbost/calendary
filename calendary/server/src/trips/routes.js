// HTTP API of the trips module (under /api, behind the app's login like every other route).
import { getSetting, setSetting } from '../db.js';
import * as store from '../store.js';
import { broadcast } from '../stream.js';
import { httpError, isYmd, str, ymd } from '../util.js';
import { tripDays } from './days.js';
import * as trips from './trips.js';
import { geocode, refreshWeather } from './weather.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Every write changes the calendar too (events, Alexa reminders) and the trips pages. */
const changed = (result) => {
  broadcast('events');
  broadcast('trips');
  return result;
};

function settings() {
  const calendarId = getSetting('trips_calendar_id');
  const time = getSetting('trips_evening_time');
  return { calendarId: calendarId && store.getCalendar(calendarId) ? calendarId : null, eveningTime: time && HHMM.test(time) ? time : '20:00' };
}

/** "Trasforma in viaggio": a trip from a calendar event at least two days long. */
async function fromEvent(body = {}) {
  const start = new Date(body.start);
  const end = new Date(body.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw httpError(400, "Date dell'evento non valide");
  const startDate = ymd(start);
  const endDate = body.allDay ? ymd(new Date(end.getTime() - 1)) : ymd(end); // all-day ends are exclusive
  if (endDate <= startDate) throw httpError(400, 'Serve un evento lungo almeno due giorni');
  let place = null;
  const location = str(body.location, 120);
  if (location) {
    try {
      const [first] = await geocode(location);
      if (first) place = { name: first.name, country: first.country, lat: first.lat, lon: first.lon };
    } catch { /* no network: the place can be set later */ }
  }
  const trip = trips.createTrip({ name: str(body.title, 120) || 'Viaggio', startDate, endDate, place }, { source: 'event' });
  const ev = body.eventId ? store.getEvent(String(body.eventId)) : null;
  const eventDeletable = !!ev && !ev.readOnly && !String(ev.id).startsWith('ics:') && !ev.planId?.startsWith('trip:');
  return { trip, eventDeletable };
}

export async function registerTripRoutes(app) {
  app.get('/trips', async () => trips.listTrips());
  app.post('/trips', async (req) => changed(trips.createTrip(req.body || {})));

  app.get('/trips/days', async (req) => {
    const { from, to } = req.query;
    if (!isYmd(from) || !isYmd(to) || to < from) throw httpError(400, 'Intervallo di date non valido');
    return tripDays(from, to);
  });
  app.get('/trips/geocode', async (req) => {
    try {
      return await geocode(req.query.q);
    } catch (err) {
      if (err.statusCode) throw err;
      throw httpError(502, 'Ricerca delle città non disponibile, riprova tra poco');
    }
  });
  app.post('/trips/from-event', async (req) => changed(await fromEvent(req.body)));

  app.get('/trips/settings', async () => settings());
  app.put('/trips/settings', async (req) => {
    const { calendarId, eveningTime } = req.body || {};
    if (eveningTime !== undefined) {
      if (!HHMM.test(eveningTime)) throw httpError(400, 'Orario non valido (HH:mm)');
      setSetting('trips_evening_time', eveningTime);
    }
    if (calendarId !== undefined) {
      const cal = calendarId ? store.getCalendar(calendarId) : null;
      if (calendarId && (!cal || cal.type !== 'local')) throw httpError(400, 'Scegli un calendario locale');
      setSetting('trips_calendar_id', calendarId || '');
    }
    return settings();
  });

  app.get('/trips/:id', async (req) => {
    trips.getTrip(req.params.id); // 404 first
    return refreshWeather(req.params.id); // only when older than 6 hours; never throws
  });
  app.patch('/trips/:id', async (req) => changed(trips.updateTrip(req.params.id, req.body || {})));
  app.delete('/trips/:id', async (req) => {
    trips.deleteTrip(req.params.id);
    return changed({ ok: true });
  });
  app.post('/trips/:id/weather', async (req) => {
    trips.getTrip(req.params.id);
    return refreshWeather(req.params.id, { force: true });
  });

  app.post('/trips/:id/legs', async (req) => changed(trips.addLeg(req.params.id, req.body || {})));
  app.patch('/trips/legs/:legId', async (req) => changed(trips.updateLeg(req.params.legId, req.body || {})));
  app.delete('/trips/legs/:legId', async (req) => {
    trips.deleteLeg(req.params.legId);
    return changed({ ok: true });
  });

  app.post('/trips/:id/activities', async (req) => changed(trips.addActivity(req.params.id, req.body || {})));
  app.patch('/trips/activities/:activityId', async (req) => changed(trips.updateActivity(req.params.activityId, req.body || {})));
  app.delete('/trips/activities/:activityId', async (req) => {
    trips.deleteActivity(req.params.activityId);
    return changed({ ok: true });
  });
}
