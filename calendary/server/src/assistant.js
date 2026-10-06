import crypto from 'node:crypto';
import { config } from './config.js';
import { getAllEvents } from './agenda.js';
import { describeRoutine, goalsForAssistant, listGoals } from './goals.js';
import { planStudy } from './planner.js';
import { firstLocalCalendarId, getEvent, listCalendars, listTasks } from './store.js';
import { fmtDayTime, fmtLongDay, httpError, isYmd, localStamp, str, ymd } from './util.js';

// The assistant speaks the OpenAI "chat completions" dialect, which Gemini, Groq, OpenRouter,
// Mistral, Ollama and many others expose. Scheduling math is done by planner.js, not by the model:
// the model only turns the request into structured tool calls, so a tiny/free model is enough.

export const assistantStatus = () => ({
  enabled: !!config.ai.apiKey || /localhost|127\.0\.0\.1|:11434/.test(config.ai.baseUrl),
  model: config.ai.model,
  provider: new URL(config.ai.baseUrl).hostname,
});

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_events',
      description: "Legge gli eventi del calendario (tutti i calendari) in un intervallo. Usalo per rispondere a domande sull'agenda o per verificare conflitti.",
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Inizio, ora locale, formato YYYY-MM-DDTHH:mm' },
          to: { type: 'string', description: 'Fine, ora locale, formato YYYY-MM-DDTHH:mm' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_events',
      description: "Propone uno o più eventi da aggiungere al calendario. NON li crea: l'utente li vedrà e dovrà approvarli.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titolo breve della proposta' },
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                start: { type: 'string', description: 'Ora locale YYYY-MM-DDTHH:mm (per eventi di tutto il giorno YYYY-MM-DD)' },
                end: { type: 'string', description: 'Ora locale YYYY-MM-DDTHH:mm; se assente dura 1 ora' },
                allDay: { type: 'boolean' },
                location: { type: 'string' },
                description: { type: 'string' },
                important: { type: 'boolean', description: 'true per attività importanti: riceveranno una notifica push' },
                reminderMinutes: { type: 'integer', description: "Minuti di preavviso per la notifica" },
                calendarId: { type: 'string' },
              },
              required: ['title', 'start'],
            },
          },
        },
        required: ['events'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_study',
      description: "Calcola un piano di studio: divide i moduli in sessioni e le distribuisce negli slot liberi del calendario prima della scadenza, evitando gli impegni esistenti. Restituisce una proposta da far approvare all'utente. Usalo SEMPRE per piani di studio/corsi/preparazione esami.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Nome del corso o esame, es. "Corso di inglese"' },
          deadline: { type: 'string', description: 'Data di scadenza YYYY-MM-DD' },
          modules: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, hours: { type: 'number' } },
              required: ['name', 'hours'],
            },
          },
          startDate: { type: 'string', description: 'Da quando iniziare, YYYY-MM-DD (default oggi)' },
          sessionMaxHours: { type: 'number', description: 'Durata massima di una sessione in ore (default 2)' },
          maxHoursPerDay: { type: 'number', description: 'Ore massime di studio al giorno (default 3)' },
          days: { type: 'array', items: { type: 'integer' }, description: 'Giorni ammessi: 0=domenica ... 6=sabato (default lun-sab)' },
          weekdayWindows: {
            type: 'array',
            description: 'Fasce orarie feriali, default 18:00-21:00',
            items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
          },
          weekendWindows: {
            type: 'array',
            description: 'Fasce orarie weekend, default 09:30-12:30 e 15:00-18:00',
            items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
          },
          bufferDays: { type: 'integer', description: 'Giorni di margine prima della scadenza (default 1)' },
          finalReview: { type: 'boolean', description: 'Aggiunge una sessione di ripasso finale' },
          calendarId: { type: 'string' },
        },
        required: ['title', 'deadline', 'modules'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_tasks',
      description: "Propone attività per la matrice di Eisenhower di un giorno. quadrant: 1=urgente e importante, 2=importante non urgente, 3=urgente non importante, 4=né urgente né importante. L'utente deve approvarle.",
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, quadrant: { type: 'integer', enum: [1, 2, 3, 4] } },
              required: ['title', 'quadrant'],
            },
          },
        },
        required: ['date', 'tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_delete_events',
      description: "Propone di eliminare eventi del calendario interno (ottieni gli id con get_events). L'utente deve confermare. Gli eventi iCal importati non si possono eliminare.",
      parameters: {
        type: 'object',
        properties: { eventIds: { type: 'array', items: { type: 'string' } } },
        required: ['eventIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_goals',
      description: "Legge gli obiettivi dell'utente (es. obiettivi di lavoro annuali) con avanzamento, andamento rispetto al tempo trascorso, misure e routine già esistenti.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_routines',
      description: "Propone routine ricorrenti (settimanali, mensili o trimestrali) per far avanzare un obiettivo. Compariranno nel calendario con promemoria. L'utente deve approvarle. Prima leggi obiettivi e agenda (get_goals, get_events) per non creare sovrapposizioni e per collegare la routine alla misura giusta.",
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string' },
          routines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Azione concreta e breve, es. "Timesheet settimanale"' },
                freq: { type: 'string', enum: ['weekly', 'monthly', 'quarterly'] },
                days: { type: 'array', items: { type: 'integer' }, description: 'Per weekly: 0=domenica ... 6=sabato' },
                intervalWeeks: { type: 'integer', description: 'Per weekly: 1 = ogni settimana, 2 = ogni 2 settimane' },
                monthDay: { type: 'integer', description: 'Per monthly/quarterly: giorno del mese 1-28, oppure -1 per l\'ultimo giorno' },
                time: { type: 'string', description: 'HH:mm' },
                duration: { type: 'integer', description: 'Minuti' },
                reminderMinutes: { type: 'integer' },
                itemId: { type: 'string', description: "Id della misura dell'obiettivo che questa routine fa avanzare (facoltativo)" },
              },
              required: ['title', 'freq', 'time', 'duration'],
            },
          },
        },
        required: ['goalId', 'routines'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_matrix',
      description: 'Legge le attività della matrice di Eisenhower di un giorno.',
      parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    },
  },
];

function systemPrompt() {
  const now = new Date();
  const cals = listCalendars()
    .map((c) => `- ${c.id}: "${c.name}" (${c.type === 'local' ? 'interno, scrivibile' : 'iCal, sola lettura'})`)
    .join('\n');
  return `Sei Hubitat, l'assistente personale di pianificazione dell'utente. Parli italiano, sei conciso, pratico e motivante.
Oggi è ${fmtLongDay(now)}, ora locale ${localStamp(now).slice(11)} (fuso ${config.timezone}).

Calendari:
${cals}
Calendario interno predefinito: ${firstLocalCalendarId()}

Regole:
- Non puoi scrivere direttamente nel calendario: usa sempre gli strumenti propose_* o plan_study. L'utente vedrà una scheda e approverà o scarterà.
- Per corsi, esami, piani di studio o qualsiasi obiettivo diviso in ore/moduli usa SEMPRE plan_study: calcola lui gli orari liberi. Non inventare gli orari a mano.
- Per un singolo impegno con orario preciso usa propose_events. Se l'orario non è indicato, controlla l'agenda con get_events e proponi uno slot libero sensato.
- Se manca un'informazione indispensabile (ad esempio la scadenza di un piano di studio), chiedila in una frase prima di procedere.
- Date e ore sono sempre locali, formato YYYY-MM-DDTHH:mm.
- Dopo aver creato una proposta, riassumila in 1-3 frasi e ricorda che va approvata. Non elencare di nuovo ogni singola sessione.
- L'utente ha degli obiettivi (pagina Obiettivi): per domande sugli obiettivi o per creare routine usa get_goals e propose_routines. Le routine devono essere azioni piccole e concrete, in orari realistici e senza sovrapporsi agli impegni esistenti.
- Quando è utile, aggiungi un breve consiglio anti-procrastinazione (regola dei 5 secondi, pomodoro, mangia il ranocchio...).`;
}

function compactEvent(e) {
  return {
    id: e.id,
    title: e.title,
    start: e.allDay ? ymd(e.start) : localStamp(e.start),
    end: e.allDay ? ymd(new Date(Date.parse(e.end) - 1)) : localStamp(e.end),
    allDay: e.allDay,
    calendar: e.calendarName,
    readOnly: e.readOnly,
  };
}

function parseLocal(value, field) {
  const s = str(value, 40);
  if (!s) throw httpError(400, `${field} mancante`);
  const d = isYmd(s) ? new Date(`${s}T00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) throw httpError(400, `${field} non valido: ${s}`);
  return d;
}

function runTool(name, args, proposals) {
  switch (name) {
    case 'get_events': {
      const events = getAllEvents(parseLocal(args.from, 'from'), parseLocal(args.to, 'to'));
      return { count: events.length, events: events.slice(0, 120).map(compactEvent) };
    }
    case 'propose_events': {
      const list = Array.isArray(args.events) ? args.events : [];
      const items = list.map((ev) => {
        const allDay = !!ev.allDay || isYmd(ev.start);
        const start = parseLocal(ev.start, 'start');
        let end = ev.end ? parseLocal(ev.end, 'end') : new Date(start.getTime() + (allDay ? 86400e3 : 3600e3));
        if (allDay && isYmd(ev.end)) end = new Date(end.getTime() + 86400e3); // inclusive date → exclusive
        if (end <= start) end = new Date(start.getTime() + (allDay ? 86400e3 : 3600e3));
        return {
          title: str(ev.title, 200) || 'Evento',
          start: start.toISOString(),
          end: end.toISOString(),
          allDay,
          location: str(ev.location, 300) || '',
          description: str(ev.description, 2000) || '',
          important: !!ev.important,
          reminderMinutes: Number.isFinite(Number(ev.reminderMinutes)) && ev.reminderMinutes !== null ? Number(ev.reminderMinutes) : null,
          calendarId: ev.calendarId || firstLocalCalendarId(),
        };
      });
      if (!items.length) return { error: 'Nessun evento nella proposta' };
      proposals.push({ id: crypto.randomUUID(), kind: 'events', title: str(args.title, 120) || 'Nuovi eventi', items, warnings: [] });
      return { ok: true, pending_approval: items.length, events: items.map((i) => `${i.title} — ${fmtDayTime(i.start)}`) };
    }
    case 'plan_study': {
      const proposal = planStudy(args);
      proposals.push(proposal);
      return {
        ok: true,
        pending_approval: proposal.items.length,
        summary: proposal.summary,
        warnings: proposal.warnings,
        first_sessions: proposal.items.slice(0, 6).map((i) => `${i.title} — ${fmtDayTime(i.start)}`),
      };
    }
    case 'propose_tasks': {
      if (!isYmd(args.date)) return { error: 'date deve essere YYYY-MM-DD' };
      const items = (Array.isArray(args.tasks) ? args.tasks : [])
        .map((t) => ({ title: str(t.title, 200), quadrant: Number(t.quadrant), date: args.date }))
        .filter((t) => t.title && [1, 2, 3, 4].includes(t.quadrant));
      if (!items.length) return { error: 'Nessuna attività valida' };
      proposals.push({ id: crypto.randomUUID(), kind: 'tasks', title: `Matrice di Eisenhower · ${args.date}`, items, warnings: [] });
      return { ok: true, pending_approval: items.length };
    }
    case 'propose_delete_events': {
      const ids = Array.isArray(args.eventIds) ? args.eventIds : [];
      const items = ids.map((id) => getEvent(String(id))).filter(Boolean)
        .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay }));
      const skipped = ids.length - items.length;
      if (!items.length) return { error: 'Nessun evento eliminabile trovato (gli eventi iCal sono in sola lettura)' };
      proposals.push({ id: crypto.randomUUID(), kind: 'delete', title: 'Eventi da eliminare', items, warnings: [] });
      return { ok: true, pending_approval: items.length, skipped_read_only_or_missing: skipped };
    }
    case 'get_goals':
      return { goals: goalsForAssistant() };
    case 'propose_routines': {
      const goal = listGoals().find((g) => g.id === args.goalId);
      if (!goal) return { error: 'Obiettivo non trovato: usa get_goals per gli id' };
      const items = (Array.isArray(args.routines) ? args.routines : []).map((r) => ({
        goalId: goal.id,
        goalTitle: goal.title,
        title: str(r.title, 200) || 'Routine',
        freq: ['weekly', 'monthly', 'quarterly'].includes(r.freq) ? r.freq : 'weekly',
        days: Array.isArray(r.days) ? r.days.map(Number).filter((d) => d >= 0 && d <= 6) : [],
        intervalWeeks: Number(r.intervalWeeks) || 1,
        monthDay: r.monthDay === undefined ? null : Number(r.monthDay),
        time: /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : '09:00',
        duration: Number(r.duration) || 30,
        reminderMinutes: r.reminderMinutes === undefined ? 10 : Number(r.reminderMinutes),
        itemId: goal.items.some((i) => i.id === r.itemId) ? r.itemId : null,
      })).filter((r) => r.freq !== 'weekly' || r.days.length);
      if (!items.length) return { error: 'Nessuna routine valida (per weekly servono i giorni)' };
      proposals.push({ id: crypto.randomUUID(), kind: 'routines', title: `Routine per "${goal.title}"`, items, warnings: [] });
      return { ok: true, pending_approval: items.length, routines: items.map((r) => `${r.title} — ${describeRoutine(r)}`) };
    }
    case 'get_matrix': {
      if (!isYmd(args.date)) return { error: 'date deve essere YYYY-MM-DD' };
      return { tasks: listTasks(args.date).map((t) => ({ title: t.title, quadrant: t.quadrant, done: t.done })) };
    }
    default:
      return { error: `Strumento sconosciuto: ${name}` };
  }
}

// Cloudflare drops requests after 100 s (and shows an HTML error page): stay well below.
const TOTAL_BUDGET_MS = 80_000;
const CALL_TIMEOUT_MS = 30_000;
// Worth retrying / switching model: overload, rate limit, server errors, unknown model.
const RETRYABLE = new Set([404, 408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callModel(model, messages, timeoutMs) {
  const headers = { 'content-type': 'application/json' };
  if (config.ai.apiKey) headers.authorization = `Bearer ${config.ai.apiKey}`;
  let res;
  try {
    res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.3 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return { status: timeout ? 408 : 502, detail: timeout ? 'nessuna risposta in tempo' : err.message };
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j[0]?.error?.message || detail;
    } catch { /* not JSON */ }
    return { status: res.status, detail };
  }
  try {
    const msg = JSON.parse(text).choices?.[0]?.message;
    return msg ? { msg } : { status: 502, detail: 'risposta vuota' };
  } catch {
    return { status: 502, detail: 'risposta non valida' };
  }
}

/**
 * One chat completion with resilience for free tiers: retry transient errors once,
 * then fall back to the other configured models, all within the request deadline.
 */
async function complete(messages, deadline) {
  const models = [...new Set([config.ai.model, ...config.ai.fallbackModels].filter(Boolean))];
  let last = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 4_000) break;
      const r = await callModel(model, messages, Math.min(CALL_TIMEOUT_MS, left - 1_000));
      if (r.msg) return r.msg;
      last = { ...r, model };
      console.warn(`Assistente: ${model} → ${r.status} ${r.detail}`);
      if (!RETRYABLE.has(r.status)) {
        const hint = r.status === 400 || r.status === 401 || r.status === 403 ? " Controlla ai_api_key nelle opzioni dell'add-on." : '';
        throw httpError(502, `Il servizio AI ha risposto ${r.status}: ${r.detail}.${hint}`);
      }
      if (r.status === 404) break; // unknown model: go straight to the next one
      if (attempt === 0 && deadline - Date.now() > 8_000) await sleep(r.status === 429 ? 3_000 : 1_500);
    }
  }
  if (last?.status === 429) throw httpError(503, 'Limite del piano gratuito raggiunto per tutti i modelli configurati. Riprova tra qualche minuto.');
  if (last?.status === 404) throw httpError(502, `Modello non trovato (${last.model}). Aggiorna ai_model nelle opzioni dell'add-on.`);
  throw httpError(503, 'Il servizio AI è sovraccarico in questo momento (succede nei picchi del piano gratuito). Riprova tra un minuto.');
}

/** history: [{ role: 'user'|'assistant', content: string }] */
export async function chat(history) {
  if (!assistantStatus().enabled) throw httpError(503, "Assistente non configurato: aggiungi ai_api_key nelle opzioni dell'add-on");
  const clean = (Array.isArray(history) ? history : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!clean.length || clean.at(-1).role !== 'user') throw httpError(400, 'Scrivi un messaggio');

  const messages = [{ role: 'system', content: systemPrompt() }, ...clean];
  const proposals = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (let round = 0; round < 6; round++) {
    let msg;
    try {
      msg = await complete(messages, deadline);
    } catch (err) {
      // Tools already produced proposals: hand them over instead of losing the work.
      if (proposals.length) return { reply: 'Ecco la mia proposta: controllala e approvala.', proposals };
      throw err;
    }
    const calls = msg.tool_calls || [];
    if (!calls.length) return { reply: (msg.content || '').trim() || 'Fatto.', proposals };

    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      let result;
      try {
        const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        result = runTool(call.function?.name, args, proposals);
      } catch (err) {
        result = { error: err.message || String(err) };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: proposals.length ? 'Ecco la mia proposta: controllala e approvala.' : 'Non sono riuscito a completare la richiesta, prova a riformularla.', proposals };
}
