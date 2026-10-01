import { getAllEvents } from './agenda.js';
import { assistantStatus, chat } from './assistant.js';
import * as goals from './goals.js';
import { forgetCalendar, syncCalendar } from './ics.js';
import { planStudy } from './planner.js';
import { config } from './config.js';
import { moveoToday, signTicket, suiteSecretOk } from './suite.js';
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

  // ------------------------------------------------------------- suite (Moveo)
  app.get('/suite/moveo', async () => moveoToday());

  /** Link to Moveo that signs you in automatically (single-use ticket, valid 2 minutes). */
  app.post('/suite/link', async (req) => {
    if (!suiteSecretOk()) throw httpError(400, 'Imposta api_token per collegare Moveo');
    const ticket = signTicket('calendary', req.body?.next);
    return { url: `${config.moveo.publicUrl}/sso?t=${encodeURIComponent(ticket)}` };
  });

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
