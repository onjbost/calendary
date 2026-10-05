export interface CalEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  important: boolean;
  reminderMinutes: number | null;
  calendarReminder: number | null;
  readOnly: boolean;
  busy: boolean;
  source: string;
  planId: string | null;
  /** optional deep link, e.g. "open this workout in Moveo" */
  linkUrl?: string | null;
  linkLabel?: string | null;
  /** ring on Alexa this many minutes before (null = not on Alexa) */
  alexaMinutes?: number | null;
  /** goal routines ("routine") and milestones ("milestone") are virtual, read-only entries */
  routineId?: string;
  goalId?: string | null;
  occurrenceDate?: string;
  done?: boolean;
}

export type GoalStatus = 'not_started' | 'in_progress' | 'at_risk' | 'done';
export type GoalPace = 'done' | 'on_track' | 'behind' | 'untracked';
export type ItemKind = 'check' | 'number' | 'count';
export type ItemPeriod = 'total' | 'week' | 'quarter';

export interface GoalItem {
  id: string;
  goalId: string;
  title: string;
  kind: ItemKind;
  target: number | null;
  current: number | null;
  unit: string;
  period: ItemPeriod;
  due: string | null;
  done: boolean;
  progress: number | null;
  expected: number;
  count?: number;
  periodsMet?: number;
  periodsElapsed?: number;
  periodsTotal?: number;
}

export interface Routine {
  id: string;
  goalId: string;
  itemId: string | null;
  title: string;
  freq: 'weekly' | 'monthly' | 'quarterly';
  days: number[];
  intervalWeeks: number;
  monthDay: number | null;
  time: string;
  duration: number;
  startDate: string;
  endDate: string | null;
  reminderMinutes: number | null;
  active: boolean;
  stats?: { occurred: number; done: number; recentOccurred: number; recentDone: number };
}

export interface Evidence {
  id: string;
  goalId: string;
  itemId: string | null;
  routineId: string | null;
  date: string;
  text: string;
}

export interface Goal {
  id: string;
  title: string;
  category: string;
  description: string;
  startDate: string;
  deadline: string;
  status: GoalStatus;
  color: string;
  requiredItems: number | null;
  manualProgress: number | null;
  items: GoalItem[];
  routines: Routine[];
  evidence: Evidence[];
  progress: number;
  expected: number;
  pace: GoalPace;
  daysLeft: number;
}

export type GoalItemDraft = Partial<Pick<GoalItem, 'id' | 'title' | 'kind' | 'target' | 'current' | 'unit' | 'period' | 'due' | 'done'>>;
export type GoalDraft = Partial<Pick<Goal, 'title' | 'category' | 'description' | 'startDate' | 'deadline' | 'status' | 'color' | 'requiredItems' | 'manualProgress'>> & {
  items?: GoalItemDraft[];
};
export type RoutineDraft = Partial<Omit<Routine, 'id' | 'stats'>> & { goalTitle?: string };

export interface Calendar {
  id: string;
  name: string;
  color: string;
  type: 'local' | 'ics';
  url: string | null;
  enabled: boolean;
  reminderMinutes: number | null;
  lastSync: string | null;
  lastError: string | null;
}

export type Quadrant = 1 | 2 | 3 | 4;

export interface Task {
  id: string;
  date: string;
  quadrant: Quadrant;
  title: string;
  notes: string;
  done: boolean;
  position: number;
}

export interface EventDraft {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  important?: boolean;
  reminderMinutes?: number | null;
  calendarId?: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
  /** ring on Alexa this many minutes before (null = not on Alexa) */
  alexaMinutes?: number | null;
}

export interface TaskDraft {
  title: string;
  quadrant: Quadrant;
  date: string;
}

export type Proposal =
  | { id: string; kind: 'events'; title: string; summary?: string; warnings: string[]; planId?: string; items: EventDraft[] }
  | { id: string; kind: 'tasks'; title: string; summary?: string; warnings: string[]; items: TaskDraft[] }
  | { id: string; kind: 'delete'; title: string; summary?: string; warnings: string[]; items: { id: string; title: string; start: string; end: string; allDay: boolean }[] }
  | { id: string; kind: 'routines'; title: string; summary?: string; warnings: string[]; items: RoutineDraft[] };

export interface StudyPlanInput {
  title: string;
  deadline: string;
  startDate?: string;
  modules: { name: string; hours: number }[];
  sessionMaxHours: number;
  maxHoursPerDay: number;
  breakMinutes: number;
  bufferDays: number;
  days: number[];
  weekdayWindows: { from: string; to: string }[];
  weekendWindows: { from: string; to: string }[];
  finalReview: boolean;
  important: boolean;
  reminderMinutes: number | null;
  calendarId?: string;
}

export interface AlexaStatus {
  skillConfigured: boolean;
  endpoint: string;
  linked: boolean;
  lastSeen: string | null;
  permission: string | null;
  remindersMode: 'off' | 'important' | 'all';
  outOfSession: boolean;
  pending: number;
  scheduled: number;
  lastSync: string | null;
  lastError: string | null;
  announce: { enabled: boolean; services: string[]; homeAssistant: boolean };
}

export interface NoteFolder {
  id: string;
  name: string;
  description: string;
  color: string;
  position: number;
  count: number;
  open: number;
}

export interface Note {
  id: string;
  title: string;
  text: string;
  folderId: string | null;
  source: string;
  color: string;
  pinned: boolean;
  done: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Pill {
  id: string;
  name: string;
  dose: string;
  times: string[];
  days: number[];
  startDate: string;
  endDate: string | null;
  alexa: boolean;
  active: boolean;
  color: string;
  notes: string;
}

export type PillDraft = Partial<Omit<Pill, 'id'>> & { name: string; times: string[] };

export interface Dose {
  pillId: string;
  name: string;
  dose: string;
  color: string;
  alexa: boolean;
  date: string;
  time: string;
  at: string;
  takenAt: string | null;
}

export interface PillHistory {
  from: string;
  to: string;
  pills: {
    pillId: string; name: string; color: string; scheduled: number; taken: number; percent: number; streak: number; firstDate: string;
    days: Record<string, { scheduled: number; taken: number }>;
  }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Errors produced by Cloudflare / the network in front of the server (HTML pages, not our JSON). */
function proxyErrorMessage(status: number) {
  if (status === 524 || status === 504) return 'Il server ha impiegato troppo a rispondere (timeout del proxy Cloudflare). Riprova tra poco.';
  if (status === 502 || status === 521 || status === 522 || status === 523 || status === 530) {
    return 'Calendary non è raggiungibile: controlla che l’add-on e il tunnel Cloudflare siano attivi.';
  }
  return `Risposta inattesa dal server (HTTP ${status}). Riprova tra poco.`;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Connessione assente o server non raggiungibile.');
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, proxyErrorMessage(res.status));
    }
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('calendary:unauthorized'));
    throw new ApiError(res.status, data?.error || `Errore ${res.status}`);
  }
  return data as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body: unknown = {}) => request<T>('POST', url, body);
const patch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);
const del = <T>(url: string) => request<T>('DELETE', url);

export interface MoveoSession {
  title: string;
  programTitle: string;
  category: string | null;
  /** emoji of the category (also the ones created in Moveo) */
  emoji?: string;
  date: string;
  time: string;
  durationMin: number;
  week: number;
  weeks: number | null;
  path: string;
}

export interface MoveoToday {
  enabled: boolean;
  publicUrl?: string;
  error?: string;
  date?: string;
  session?: MoveoSession | null;
  next?: MoveoSession | null;
  doneToday?: { title: string; category: string }[];
  breaks?: { done: number; total: number; paused: boolean; open: { title: string; path: string } | null; next: { title: string; dueAt: string; path: string } | null };
  streak?: number;
  minutesWeek?: number;
}

export interface MoveoOverview extends MoveoToday {
  /** false: this Moveo version only gives today's summary */
  overview?: boolean;
  recent?: { title: string; programTitle?: string; category?: string; emoji?: string; finishedAt: string; durationSec?: number; completion?: number }[];
  upcoming?: MoveoSession[];
  programs?: { id: string; title: string; category?: string; emoji?: string; level?: string; minutes?: number; weeks?: number; summary?: string; path?: string; planned?: boolean }[];
}

export interface Weather {
  enabled: boolean;
  error?: string;
  condition?: string;
  temperature?: number | null;
  unit?: string;
  humidity?: number | null;
  wind?: number | null;
  windUnit?: string;
  daily?: { date: string; condition: string; high: number | null; low: number | null; rain: number | null }[];
}

export const api = {
  session: () => get<{ authenticated: boolean; authConfigured: boolean }>('/session'),
  login: (password: string) => post<{ ok: boolean }>('/login', { password }),
  logout: () => post('/logout'),

  calendars: () => get<Calendar[]>('/calendars'),
  createCalendar: (c: Partial<Calendar>) => post<Calendar>('/calendars', c),
  updateCalendar: (id: string, c: Partial<Calendar>) => patch<Calendar>(`/calendars/${id}`, c),
  deleteCalendar: (id: string) => del(`/calendars/${id}`),
  syncCalendar: (id: string) => post<{ changed: boolean; error?: string; calendar: Calendar }>(`/calendars/${id}/sync`),

  events: (from: Date, to: Date) =>
    get<CalEvent[]>(`/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  createEvent: (e: EventDraft) => post<CalEvent>('/events', e),
  createEvents: (events: EventDraft[], planId?: string) => post<CalEvent[]>('/events/bulk', { events, planId }),
  updateEvent: (id: string, e: Partial<EventDraft>) => patch<CalEvent>(`/events/${id}`, e),
  deleteEvent: (id: string) => del(`/events/${encodeURIComponent(id)}`),
  deleteEvents: (ids: string[]) => post<{ deleted: number }>('/events/delete-bulk', { ids }),
  deletePlan: (planId: string) => del<{ deleted: number }>(`/plans/${planId}`),

  tasks: (date: string) => get<{ tasks: Task[]; pendingBefore: number }>(`/tasks?date=${date}`),
  createTask: (t: TaskDraft) => post<Task>('/tasks', t),
  createTasks: (tasks: TaskDraft[]) => post<Task[]>('/tasks/bulk', { tasks }),
  updateTask: (id: string, t: Partial<Task>) => patch<Task>(`/tasks/${id}`, t),
  deleteTask: (id: string) => del(`/tasks/${id}`),
  carryOver: (date: string) => post<{ moved: number }>('/tasks/carry-over', { date }),

  moveoToday: () => get<MoveoToday>('/suite/moveo'),
  moveoOverview: () => get<MoveoOverview>('/suite/moveo/overview'),
  weather: () => get<Weather>('/weather'),
  suiteLink: (next: string) => post<{ url: string }>('/suite/link', { next }),

  notes: () => get<Note[]>('/notes'),
  noteFolders: () => get<NoteFolder[]>('/note-folders'),
  createNoteFolder: (f: Partial<NoteFolder>) => post<NoteFolder>('/note-folders', f),
  updateNoteFolder: (id: string, changes: Partial<NoteFolder>) => patch<NoteFolder>(`/note-folders/${id}`, changes),
  deleteNoteFolder: (id: string, withNotes = false) => del(`/note-folders/${id}${withNotes ? '?withNotes=1' : ''}`),
  mcpStatus: () => get<{ enabled: boolean; url: string }>('/integrations/mcp'),
  createNote: (n: Partial<Note> = {}) => post<Note>('/notes', n),
  updateNote: (id: string, changes: Partial<Note>) => patch<Note>(`/notes/${id}`, changes),
  deleteNote: (id: string) => del(`/notes/${id}`),

  pills: () => get<Pill[]>('/pills'),
  createPill: (p: PillDraft) => post<Pill>('/pills', p),
  updatePill: (id: string, p: Partial<PillDraft>) => patch<Pill>(`/pills/${id}`, p),
  deletePill: (id: string) => del(`/pills/${id}`),
  doses: (date: string) => get<Dose[]>(`/pills/doses?date=${date}`),
  setDose: (pillId: string, date: string, time: string, taken: boolean, takenAt?: string) => post(`/pills/${pillId}/dose`, { date, time, taken, takenAt }),
  pillHistory: (days: number | 'all' = 14) => get<PillHistory>(days === 'all' ? '/pills/history?all=1' : `/pills/history?days=${days}`),
  pillLog: (month: string) => get<Dose[]>(`/pills/log?month=${month}`),

  pushStatus: () => get<{ publicKey: string; subscriptions: number }>('/push/status'),
  pushSubscribe: (sub: PushSubscriptionJSON) => post('/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => post('/push/unsubscribe', { endpoint }),
  alexaStatus: () => get<AlexaStatus>('/alexa/status'),
  alexaSync: () => post<{ ok: boolean; error?: string; pending?: number; skipped?: string }>('/alexa/sync'),
  alexaAnnounceTest: () => post<{ sent: number }>('/alexa/announce-test'),
  pushTest: () => post<{ sent: number; failed: number; errors: { service: string; status: number | null; message: string }[] }>('/push/test'),

  goals: () => get<Goal[]>('/goals'),
  createGoal: (g: GoalDraft) => post<{ id: string }>('/goals', g),
  updateGoal: (id: string, g: GoalDraft) => patch('/goals/' + id, g),
  deleteGoal: (id: string) => del('/goals/' + id),
  updateGoalItem: (id: string, p: GoalItemDraft) => patch('/goal-items/' + id, p),
  addEvidence: (goalId: string, e: { date: string; text: string; itemId?: string | null }) => post<{ id: string }>(`/goals/${goalId}/evidence`, e),
  deleteEvidence: (id: string) => del('/evidence/' + id),
  createRoutine: (r: RoutineDraft) => post<{ ids: string[] }>('/routines', r),
  createRoutines: (routines: RoutineDraft[]) => post<{ ids: string[] }>('/routines', { routines }),
  updateRoutine: (id: string, r: RoutineDraft) => patch('/routines/' + id, r),
  deleteRoutine: (id: string) => del('/routines/' + id),
  checkRoutine: (id: string, date: string, done: boolean, note?: string) => post(`/routines/${id}/check`, { date, done, note }),
  importGoals: (data: unknown) => post<{ created: number; skipped: string[]; routines: number }>('/goals/import', data),

  planStudy: (input: StudyPlanInput) => post<Proposal>('/planner/study', input),
  assistantStatus: () => get<{ enabled: boolean; model: string; provider: string }>('/assistant/status'),
  chat: (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    post<{ reply: string; proposals: Proposal[] }>('/assistant/chat', { messages }),
};
