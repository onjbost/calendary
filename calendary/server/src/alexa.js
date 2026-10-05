import { config } from './config.js';
import { getAllEvents } from './agenda.js';
import { atTime, dayLabel, joinList } from './alexa-speech.js';
import {
  REMINDERS_SCOPE, forgetAlexaUser, rememberAlexaUser, remindersGranted, setPermission, syncWithToken,
} from './alexa-reminders.js';
import { verifyAlexaRequest } from './alexa-verify.js';
import { db } from './db.js';
import { createEvent, createTask } from './store.js';
import { broadcast } from './stream.js';
import { addDays, httpError, parseYmd, startOfDay, ymd } from './util.js';

// Alexa → Calendary: the custom skill "AiCal" (interaction model in /alexa) talks to POST /api/alexa.
// "Alexa, chiedi ad AiCal di ricordarmi di chiamare Marco domani alle 18"
// "Alexa, chiedi ad AiCal cosa ho domani"

// --------------------------------------------------------- slot parsing

/** AMAZON.DATE → local midnight, or null. Handles days, ISO weeks ("2026-W41", "-WE") and months. */
export function parseAlexaDate(value, now = new Date()) {
  if (!value) return null;
  if (value === 'PRESENT_REF') return startOfDay(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseYmd(value);
  const week = /^(\d{4})-W(\d{2})(-WE)?$/.exec(value);
  if (week) {
    const jan4 = new Date(Number(week[1]), 0, 4); // ISO week 1 always contains 4 January
    const monday = addDays(jan4, -((jan4.getDay() + 6) % 7) + (Number(week[2]) - 1) * 7);
    const day = week[3] ? addDays(monday, 5) : monday;
    return day < startOfDay(now) && !week[3] ? startOfDay(now) : day; // "questa settimana" = from today
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1);
  return null;
}

/** AMAZON.TIME → [hours, minutes], or null. "MO/AF/EV/NI" are morning, afternoon, evening, night. */
export function parseAlexaTime(value) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (m) return [Number(m[1]), Number(m[2])];
  return { MO: [9, 0], AF: [15, 0], EV: [19, 0], NI: [21, 0] }[value] || null;
}

/** AMAZON.DURATION ("PT1H30M", "P1D") → minutes, or null. */
export function parseAlexaDuration(value) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value || '');
  if (!m || value === 'P' || value === 'PT') return null;
  const min = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return min > 0 ? min : null;
}

/** Start of a reminder/event: a time without a day means today, or tomorrow if it already passed. */
export function resolveStart(dateValue, timeValue, now = new Date()) {
  const time = parseAlexaTime(timeValue);
  if (!time) return null;
  const day = parseAlexaDate(dateValue, now);
  const start = new Date(day || now);
  start.setHours(time[0], time[1], 0, 0);
  if (!day && start.getTime() <= now.getTime()) start.setDate(start.getDate() + 1);
  return start;
}

const slot = (intent, name) => {
  const s = intent?.slots?.[name];
  if (!s) return { value: null, id: null };
  const match = s.resolutions?.resolutionsPerAuthority?.find((r) => r.status?.code === 'ER_SUCCESS_MATCH');
  return { value: s.value ? String(s.value).trim() : null, id: match?.values?.[0]?.value?.id ?? null };
};

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ------------------------------------------------------------ responses

function say(text, { end = true, reprompt = null, card = null } = {}) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      ...(reprompt ? { reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } } } : {}),
      ...(card ? { card } : {}),
      shouldEndSession: end,
    },
  };
}

const ack = () => ({ version: '1.0', response: {} });
const delegate = () => ({ version: '1.0', response: { directives: [{ type: 'Dialog.Delegate' }], shouldEndSession: false } });
const permissionCard = () => ({ type: 'AskForPermissionsConsent', permissions: [REMINDERS_SCOPE] });
const elicit = (slotName, question) => ({
  version: '1.0',
  response: {
    outputSpeech: { type: 'PlainText', text: question },
    reprompt: { outputSpeech: { type: 'PlainText', text: question } },
    directives: [{ type: 'Dialog.ElicitSlot', slotToElicit: slotName }],
    shouldEndSession: false,
  },
});

const HELP = 'Puoi dirmi: ricordami di chiamare Marco domani alle 18; aggiungi dentista giovedì alle 15 e 30; '
  + 'cosa ho domani; qual è il prossimo impegno; aggiungi fare la spesa alla matrice; oppure aggiorna i promemoria. Cosa faccio?';

// -------------------------------------------------------------- intents

function addReminder(intent, ctx) {
  const what = slot(intent, 'what').value;
  if (!what) return elicit('what', 'Cosa ti devo ricordare?');
  const start = resolveStart(slot(intent, 'date').value, slot(intent, 'time').value, ctx.now);
  if (!start) return elicit('time', 'A che ora te lo ricordo?');
  if (start.getTime() < ctx.now.getTime()) return say('Quell\'orario è già passato: dimmi un altro momento.', { end: false, reprompt: 'Quando te lo ricordo?' });
  createEvent({ title: capitalize(what), start, end: start, reminderMinutes: 0 }, { source: 'alexa' });
  broadcast('events');
  ctx.syncNow = true;
  return say(`Fatto, ${dayLabel(start, ctx.now)} ${atTime(start)} ti ricordo: ${what}.${ctx.reminderHint}`, ctx.reminderCard);
}

function addEvent(intent, ctx) {
  const what = slot(intent, 'what').value;
  if (!what) return elicit('what', 'Che impegno aggiungo?');
  const start = resolveStart(slot(intent, 'date').value, slot(intent, 'time').value, ctx.now);
  if (!start) return elicit('time', 'A che ora?');
  const minutes = parseAlexaDuration(slot(intent, 'duration').value) || 60;
  const important = !!slot(intent, 'importance').value;
  createEvent({
    title: capitalize(what), start, end: new Date(start.getTime() + minutes * 60e3), important,
  }, { source: 'alexa' });
  broadcast('events');
  ctx.syncNow = true;
  return say(`Aggiunto${important ? ' come importante' : ''}: ${what}, ${dayLabel(start, ctx.now)} ${atTime(start)}.${ctx.reminderHint}`, ctx.reminderCard);
}

function describeEvents(events) {
  return events.map((e) => (e.allDay ? `tutto il giorno ${e.title}` : `${atTime(e.start)} ${e.title}`));
}

function agenda(intent, ctx) {
  const day = parseAlexaDate(slot(intent, 'date').value, ctx.now) || startOfDay(ctx.now);
  const events = getAllEvents(day, addDays(day, 1)).filter((e) => !e.done);
  const label = dayLabel(day, ctx.now);
  const parts = [];
  if (!events.length) parts.push(`${capitalize(label)} non hai impegni in calendario.`);
  else {
    const spoken = describeEvents(events.slice(0, 8));
    const more = events.length > 8 ? `, più altri ${events.length - 8}` : '';
    parts.push(`${capitalize(label)} hai ${events.length === 1 ? 'un impegno' : `${events.length} impegni`}: ${joinList(spoken)}${more}.`);
  }
  const urgent = db.prepare('SELECT title FROM tasks WHERE date = ? AND quadrant = 1 AND done = 0 ORDER BY position').all(ymd(day));
  if (urgent.length) {
    parts.push(`Nella matrice ${urgent.length === 1 ? 'c\'è un\'attività urgente e importante' : `ci sono ${urgent.length} attività urgenti e importanti`}: ${joinList(urgent.slice(0, 4).map((t) => t.title))}.`);
  }
  return say(parts.join(' '));
}

function nextEvent(ctx) {
  const now = ctx.now.getTime();
  const next = getAllEvents(ctx.now, addDays(ctx.now, 14)).find((e) => !e.allDay && !e.done && Date.parse(e.start) >= now);
  if (!next) return say('Non hai impegni nei prossimi 14 giorni.');
  const mins = Math.round((Date.parse(next.start) - now) / 60e3);
  const when = mins < 60 ? `tra ${mins <= 1 ? 'un minuto' : `${mins} minuti`}` : `${dayLabel(next.start, ctx.now)} ${atTime(next.start)}`;
  const where = next.location ? `, a ${next.location}` : '';
  return say(`Il prossimo impegno è ${next.title}, ${when}${where}.${next.important ? ' È segnato come importante.' : ''}`);
}

const QUADRANTS = { 1: 'urgenti e importanti', 2: 'importanti da pianificare', 3: 'urgenti da delegare', 4: 'né urgenti né importanti' };

function addTask(intent, ctx) {
  const what = slot(intent, 'task').value;
  if (!what) return elicit('task', 'Che attività aggiungo alla matrice?');
  const q = slot(intent, 'quadrant');
  const quadrant = [1, 2, 3, 4].includes(Number(q.id)) ? Number(q.id) : 2;
  const day = parseAlexaDate(slot(intent, 'date').value, ctx.now) || startOfDay(ctx.now);
  createTask({ date: ymd(day), quadrant, title: capitalize(what) });
  broadcast('tasks');
  return say(`Aggiunta alla matrice di ${dayLabel(day, ctx.now)}, tra le attività ${QUADRANTS[quadrant]}: ${what}.`);
}

function onIntent(intent, ctx) {
  switch (intent.name) {
    case 'AddReminderIntent': return addReminder(intent, ctx);
    case 'AddEventIntent': return addEvent(intent, ctx);
    case 'GetAgendaIntent': return agenda(intent, ctx);
    case 'NextEventIntent': return nextEvent(ctx);
    case 'AddTaskIntent': return addTask(intent, ctx);
    case 'AMAZON.HelpIntent': return say(HELP, { end: false, reprompt: 'Cosa faccio?' });
    case 'AMAZON.CancelIntent':
    case 'AMAZON.StopIntent':
    case 'AMAZON.NavigateHomeIntent': return say('A dopo!');
    case 'AMAZON.FallbackIntent':
    default: return say(`Non ho capito. ${HELP}`, { end: false, reprompt: 'Cosa faccio?' });
  }
}

// ------------------------------------------------------------- dispatch

const appIdOf = (body) => body?.context?.System?.application?.applicationId || body?.session?.application?.applicationId;

/** Returns { response, after } — `after` runs once the reply is on its way (reminder sync). */
export async function handleAlexa(body, now = new Date()) {
  if (!config.alexa.skillId) throw httpError(503, 'Integrazione Alexa non configurata: imposta alexa_skill_id');
  if (appIdOf(body) !== config.alexa.skillId) throw httpError(403, 'Skill Alexa non autorizzata');

  const system = body.context?.System;
  const request = body.request || {};
  rememberAlexaUser(system);
  const token = system?.apiAccessToken;
  const endpoint = system?.apiEndpoint;
  // Always try: the Reminders API answers for itself if the permission is really missing.
  const syncLater = () => (token && endpoint && config.alexa.reminders !== 'off' ? syncWithToken(token, endpoint) : null);

  switch (request.type) {
    case 'Messaging.MessageReceived': // our own Skill Message: Alexa hands us a token to sync reminders
      await syncLater();
      return { response: ack() };
    case 'AlexaSkillEvent.SkillPermissionAccepted':
    case 'AlexaSkillEvent.SkillPermissionChanged': {
      const accepted = request.body?.acceptedPermissions?.some((p) => p.scope === REMINDERS_SCOPE);
      setPermission(accepted ? 'GRANTED' : 'DENIED');
      return { response: ack() };
    }
    case 'AlexaSkillEvent.SkillDisabled':
      forgetAlexaUser();
      return { response: ack() };
    case 'AlexaSkillEvent.SkillEnabled':
    case 'SessionEndedRequest':
      return { response: ack() };
    default:
  }

  // Requests the user spoke: suggest the reminders permission when Alexa reminders are on but not granted yet.
  const needsPermission = config.alexa.reminders !== 'off' && !remindersGranted();
  const ctx = {
    now,
    syncNow: false,
    reminderHint: needsPermission ? ' Per sentirlo anche su Alexa concedi il permesso Promemoria: ti ho mandato una scheda nell\'app Alexa.' : '',
    reminderCard: needsPermission ? { card: permissionCard() } : {},
  };

  // Amazon lets a skill create reminders only while the user is talking to it: every request is a chance to sync.
  if (request.type === 'LaunchRequest') {
    return {
      response: say(`Ciao, sono AiCal, il tuo Calendary. ${HELP}`, { end: false, reprompt: 'Cosa faccio?', ...(needsPermission ? { card: permissionCard() } : {}) }),
      after: syncLater,
    };
  }
  if (request.type === 'IntentRequest') {
    const intent = request.intent || {};
    // With auto-delegation Alexa collects the slots itself; this covers models where it is off.
    if (request.dialogState === 'STARTED' && ['AddReminderIntent', 'AddEventIntent', 'AddTaskIntent'].includes(intent.name)) {
      const required = intent.name === 'AddTaskIntent' ? ['task'] : ['what', 'time'];
      if (required.some((n) => !intent.slots?.[n]?.value)) return { response: delegate() };
    }
    if (intent.name === 'SyncRemindersIntent') {
      if (!token || !endpoint) return { response: say('Non riesco a parlare con i promemoria di Alexa in questo momento.') };
      const r = await syncWithToken(token, endpoint);
      if (!r.ok) return { response: say(`Non ci sono riuscito: ${r.error.split('.')[0]}.`) };
      const n = r.created;
      return { response: say(n ? `Fatto, ho programmato ${n === 1 ? 'un promemoria' : `${n} promemoria`} per i prossimi tre giorni.` : 'I promemoria dei prossimi tre giorni sono già aggiornati.') };
    }
    const response = onIntent(intent, ctx);
    return { response, after: syncLater };
  }
  return { response: ack() };
}

// --------------------------------------------------------------- route

export async function registerAlexa(app) {
  // The signature covers the exact bytes Amazon sent, so this route keeps the raw body.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 128 * 1024 }, (req, raw, done) => {
    req.rawBody = raw;
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(httpError(400, 'JSON non valido'));
    }
  });

  app.post('/alexa', async (req) => {
    try {
      if (!config.alexa.skipVerify) await verifyAlexaRequest(req.headers, req.rawBody, req.body);
      const { response, after } = await handleAlexa(req.body);
      if (after) setImmediate(() => Promise.resolve(after()).catch((err) => req.log.error(err)));
      return response;
    } catch (err) {
      // Amazon only says "invalid response": the reason is visible in the add-on log.
      req.log.warn(`Richiesta Alexa rifiutata (${req.body?.request?.type || '?'}): ${err.message}`);
      throw err;
    }
  });
}
