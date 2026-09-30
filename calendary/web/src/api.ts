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

  pushStatus: () => get<{ publicKey: string; subscriptions: number }>('/push/status'),
  pushSubscribe: (sub: PushSubscriptionJSON) => post('/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => post('/push/unsubscribe', { endpoint }),
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
