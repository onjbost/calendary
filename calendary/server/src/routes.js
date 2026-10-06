import { getAllEvents } from './agenda.js';
import { canSyncOutOfSession, planDiff, requestSync, scheduleTestReminder, sessionOnly, syncStatus } from './alexa-reminders.js';
import { announce, announceStatus } from './announce.js';
import { config } from './config.js';
import { getSetting } from './db.js';
import { assistantStatus, chat } from './assistant.js';
import * as goals from './goals.js';
import * as notes from './notes.js';
import { mcpEnabled } from './mcp.js';
import * as pills from './pills.js';
import { stockReminderAfterDose } from './notifier.js';
import * as travel from './travel.js';
import { forgetCalendar, syncCalendar } from './ics.js';
import { planStudy } from './planner.js';
import { moveoOverview, moveoToday, signTicket, suiteSecretOk, wardappToday } from './suite.js';
import { countSubscriptions, removeSubscription, saveSubscription, sendToAll, vapidPublicKey } from './push.js';
import * as store from './store.js';
import { broadcast, streamHandler } from './stream.js';
import { httpError } from './util.js';
import { weather } from './weather.js';

export async function registerRoutes(app) {
  app.get('/health', async () => ({ ok: true }));
  app.get('/stream', streamHandler);

  // ---------------------------------------------------------- calendars
  app.get('/calendars', async () => store.listCalendars());

  app.post('/calendars', async (req) => {
    const cal = store.createCalendar(req.body || {});
    if (cal.type === 'ics') {
      const r = await syncCalendar(cal.id);
      if (r.error) {
        store.deleteCalendar(cal.id);
        throw httpError(400, `Impossibile importare il calendario: ${r.error}`);
      }
    }
    broadcast('calendars');
    return store.getCalendar(cal.id);
  });

  app.patch('/calendars/:id', async (req) => {
    const before = store.getCalendar(req.params.id);
    const cal = store.updateCalendar(req.params.id, req.body || {});
    if (cal.type === 'ics' && before && before.url !== cal.url) {
      forgetCalendar(cal.id);
      await syncCalendar(cal.id);
    }
    broadcast('calendars');
    return store.getCalendar(cal.id);
  });

  app.delete('/calendars/:id', async (req) => {
    store.deleteCalendar(req.params.id);
    forgetCalendar(req.params.id);
    broadcast('calendars');
    return { ok: true };
  });

  app.post('/calendars/:id/sync', async (req) => {
    const r = await syncCalendar(req.params.id);
    broadcast('events');
    return { ...r, calendar: store.getCalendar(req.params.id) };
  });

  // ------------------------------------------------------------- events
  app.get('/events', async (req) => getAllEvents(req.query.from, req.query.to));

  app.post('/events', async (req) => {
    const ev = store.createEvent(req.body || {}, { source: req.body?.source });
    broadcast('events');
    return ev;
  });

  app.post('/events/bulk', async (req) => {
    const { events, planId, source } = req.body || {};
    const created = store.createEvents(events, { source: source || (planId ? 'planner' : 'assistant'), planId });
    broadcast('events');
    return created;
  });

  app.patch('/events/:id', async (req) => {
    const ev = store.updateEvent(req.params.id, req.body || {});
    broadcast('events');
    return ev;
  });

  app.delete('/events/:id', async (req) => {
    store.deleteEvent(req.params.id);
    broadcast('events');
    return { ok: true };
  });

  app.post('/events/delete-bulk', async (req) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    let deleted = 0;
    for (const id of ids) {
      try {
        store.deleteEvent(id);
        deleted += 1;
      } catch { /* already gone or read-only */ }
    }
    broadcast('events');
    return { deleted };
  });

  app.delete('/plans/:planId', async (req) => {
    const deleted = store.deletePlan(req.params.planId);
    broadcast('events');
    return { deleted };
  });

  // ------------------------------------------------- eisenhower matrix
  app.get('/tasks', async (req) => ({
    tasks: store.listTasks(req.query.date),
    pendingBefore: store.countPendingBefore(req.query.date),
  }));

  app.post('/tasks', async (req) => {
    const t = store.createTask(req.body || {});
    broadcast('tasks');
    return t;
  });

  app.post('/tasks/bulk', async (req) => {
    const list = store.createTasks(req.body?.tasks);
    broadcast('tasks');
    return list;
  });

  app.patch('/tasks/:id', async (req) => {
    const t = store.updateTask(req.params.id, req.body || {});
    broadcast('tasks');
    return t;
  });

  app.delete('/tasks/:id', async (req) => {
    store.deleteTask(req.params.id);
    broadcast('tasks');
    return { ok: true };
  });

  app.post('/tasks/carry-over', async (req) => {
    const moved = store.carryOverTasks(req.body?.date);
    broadcast('tasks');
    return { moved };
  });

  // --------------------------------------------------------------- push
  app.get('/push/status', async () => ({ publicKey: vapidPublicKey(), subscriptions: countSubscriptions() }));

  app.post('/push/subscribe', async (req) => {
    saveSubscription(req.body, req.headers['user-agent']);
    return { ok: true };
  });

  app.post('/push/unsubscribe', async (req) => {
    removeSubscription(req.body?.endpoint);
    return { ok: true };
  });

  app.post('/push/test', async () => sendToAll({
    title: '✨ Notifiche attive',
    body: 'Riceverai un avviso quando si avvicina un’attività importante.',
    url: '/',
    tag: `test-${Date.now()}`,
  }));

  // Generic notification for other add-ons (Moveo stretching breaks…): reaches every subscribed device.
  app.post('/notify', async (req) => {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 120);
    if (!title) throw httpError(400, 'Serve un titolo');
    const url = typeof b.url === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(b.url) ? b.url.slice(0, 2000) : '/';
    return sendToAll({
      title,
      body: String(b.body || '').slice(0, 500),
      url,
      tag: String(b.tag || `notify-${Date.now()}`).slice(0, 120),
      important: !!b.important,
    });
  });

  // ------------------------------------------------------------- weather (night mode widget)
  app.get('/weather', async () => weather());

  // ---------------------------------------------------- suite (Moveo, WardApp)
  app.get('/suite/moveo', async () => moveoToday());
  app.get('/suite/moveo/overview', async () => moveoOverview());
  app.get('/suite/wardapp', async () => wardappToday());

  /** Link to Moveo or WardApp (`app`) that signs you in automatically (single-use ticket, valid 2 minutes). */
  app.post('/suite/link', async (req) => {
    const target = req.body?.app === 'wardapp' ? 'wardapp' : 'moveo';
    if (!suiteSecretOk()) throw httpError(400, `Imposta api_token per collegare ${target === 'wardapp' ? 'WardApp' : 'Moveo'}`);
    const ticket = signTicket('calendary', req.body?.next);
    return { url: `${config[target].publicUrl}/sso?t=${encodeURIComponent(ticket)}` };
  });

  // -------------------------------------------------------------- notes
  app.get('/notes', async (req) => notes.listNotes({ folderId: req.query.folder || undefined }));

  app.get('/note-folders', async () => notes.listFolders());

  app.post('/note-folders', async (req) => {
    const f = notes.createFolder(req.body || {});
    broadcast('notes');
    return f;
  });

  app.patch('/note-folders/:id', async (req) => {
    const f = notes.updateFolder(req.params.id, req.body || {});
    broadcast('notes');
    return f;
  });

  app.delete('/note-folders/:id', async (req) => {
    notes.deleteFolder(req.params.id, { withNotes: req.query.withNotes === '1' });
    broadcast('notes');
    return { ok: true };
  });

  app.post('/notes', async (req) => {
    const n = notes.createNote(req.body || {});
    broadcast('notes');
    return n;
  });

  app.patch('/notes/:id', async (req) => {
    const n = notes.updateNote(req.params.id, req.body || {});
    broadcast('notes');
    return n;
  });

  app.delete('/notes/:id', async (req) => {
    notes.deleteNote(req.params.id);
    broadcast('notes');
    return { ok: true };
  });

  // -------------------------------------------------------------- pills
  app.get('/pills', async () => pills.listPills().map((p) => ({ ...p, stockInfo: pills.stockInfo(p) })));

  app.post('/pills/:id/stock', async (req) => {
    const p = pills.updateStock(req.params.id, req.body || {});
    broadcast('pills');
    return { ...p, stockInfo: pills.stockInfo(p) };
  });

  app.post('/pills', async (req) => {
    const p = pills.createPill(req.body || {});
    broadcast('pills');
    return p;
  });

  app.patch('/pills/:id', async (req) => {
    const p = pills.updatePill(req.params.id, req.body || {});
    broadcast('pills');
    return p;
  });

  app.delete('/pills/:id', async (req) => {
    pills.deletePill(req.params.id);
    broadcast('pills');
    return { ok: true };
  });

  app.get('/pills/doses', async (req) => pills.dosesOn(req.query.date));

  app.post('/pills/:id/dose', async (req) => {
    const { date, time, taken = true, takenAt = null } = req.body || {};
    pills.setDose(req.params.id, date, time, !!taken, takenAt);
    broadcast('pills');
    if (taken) stockReminderAfterDose(req.params.id).catch((err) => req.log.error(err));
    return { ok: true };
  });

  app.get('/pills/history', async (req) => (req.query.all
    ? pills.pillHistory({ all: true })
    : pills.pillHistory({ days: Math.min(3660, Math.max(1, Number(req.query.days) || 14)) })));

  app.get('/pills/log', async (req) => pills.pillLog(req.query.month));

  // -------------------------------------------------------------- alexa
  app.get('/integrations/mcp', async () => ({ enabled: mcpEnabled(), url: `${config.publicUrl}/api/mcp/<mcp_token>` }));

  app.get('/alexa/status', async () => {
    const plan = config.alexa.reminders === 'off' ? null : planDiff();
    return {
      skillConfigured: !!config.alexa.skillId,
      endpoint: `${config.publicUrl}/api/alexa`,
      linked: !!getSetting('alexa_user_id'),
      lastSeen: getSetting('alexa_last_seen'),
      permission: getSetting('alexa_permission'),
      remindersMode: config.alexa.reminders,
      outOfSession: canSyncOutOfSession(),
      sessionOnly: sessionOnly(),
      trip: travel.travelPeriodAt(),
      pending: plan ? plan.create.length + plan.remove.length : 0,
      ...syncStatus(),
      announce: announceStatus(),
    };
  });

  app.post('/alexa/sync', async () => requestSync({ force: true }));

  // travel mode: no Alexa reminders or announcements in these days
  app.get('/travel', async () => ({ trips: travel.listTravelPeriods(), now: travel.travelPeriodAt() }));

  app.post('/travel', async (req) => {
    const t = travel.createTravelPeriod(req.body || {});
    broadcast('events'); // re-plans the Alexa reminders
    return t;
  });

  app.delete('/travel/:id', async (req) => {
    travel.deleteTravelPeriod(req.params.id);
    broadcast('events');
    return { ok: true };
  });

  app.post('/alexa/test-reminder', async () => scheduleTestReminder());

  app.post('/alexa/announce-test', async () => announce('Ciao, sono AiCal. Da ora ti avviso qui degli impegni importanti.', { strict: true }));

  // -------------------------------------------------------------- goals
  const goalsChanged = (alsoEvents = true) => {
    broadcast('goals');
    if (alsoEvents) broadcast('events'); // routines and milestones live in the calendar too
  };

  app.get('/goals', async () => goals.listGoals());

  app.post('/goals', async (req) => {
    const id = goals.createGoal(req.body || {});
    goalsChanged();
    return { id };
  });

  app.patch('/goals/:id', async (req) => {
    goals.updateGoal(req.params.id, req.body || {});
    goalsChanged();
    return { ok: true };
  });

  app.delete('/goals/:id', async (req) => {
    goals.deleteGoal(req.params.id);
    goalsChanged();
    return { ok: true };
  });

  app.patch('/goal-items/:id', async (req) => {
    goals.updateItem(req.params.id, req.body || {});
    goalsChanged();
    return { ok: true };
  });

  app.post('/goals/:id/evidence', async (req) => {
    const id = goals.addEvidence(req.params.id, req.body || {});
    goalsChanged(false);
    return { id };
  });

  app.delete('/evidence/:id', async (req) => {
    goals.deleteEvidence(req.params.id);
    goalsChanged(false);
    return { ok: true };
  });

  app.post('/routines', async (req) => {
    const body = req.body || {};
    const ids = Array.isArray(body.routines) ? goals.createRoutines(body.routines) : [goals.createRoutine(body)];
    goalsChanged();
    return { ids };
  });

  app.patch('/routines/:id', async (req) => {
    goals.updateRoutine(req.params.id, req.body || {});
    goalsChanged();
    return { ok: true };
  });

  app.delete('/routines/:id', async (req) => {
    goals.deleteRoutine(req.params.id);
    goalsChanged();
    return { ok: true };
  });

  app.post('/routines/:id/check', async (req) => {
    const { date, done = true, note } = req.body || {};
    goals.setRoutineCheck(req.params.id, date, !!done, note);
    goalsChanged();
    return { ok: true };
  });

  app.get('/goals/export', async (req, reply) => {
    reply.header('content-disposition', `attachment; filename="calendary-obiettivi-${new Date().toISOString().slice(0, 10)}.json"`);
    return goals.exportGoals();
  });

  app.post('/goals/import', async (req) => {
    const result = goals.importGoals(req.body);
    goalsChanged();
    return result;
  });

  app.get('/goals/report', async (req, reply) => {
    reply
      .type('text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="report-obiettivi-${new Date().toISOString().slice(0, 10)}.md"`);
    return goals.goalsReport();
  });

  // ------------------------------------------------ planner & assistant
  app.post('/planner/study', async (req) => planStudy(req.body || {}));

  app.get('/assistant/status', async () => assistantStatus());

  app.post('/assistant/chat', async (req) => chat(req.body?.messages));
}
