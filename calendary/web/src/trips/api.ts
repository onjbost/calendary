// API of the trips module. Self-contained (its own fetch helper) so the folder can move to its own app.

export type TagId = 'beach' | 'hiking' | 'dinner' | 'work' | 'sport' | 'city' | 'party' | 'other';
export type ModeId = 'plane' | 'train' | 'bus' | 'car' | 'ferry';
export type BagId = 'backpack_s' | 'backpack_l' | 'cabin' | 'suitcase';

export const TAGS: Record<TagId, { emoji: string; label: string }> = {
  beach: { emoji: '🏖️', label: 'Mare' },
  hiking: { emoji: '⛰️', label: 'Montagna/escursione' },
  dinner: { emoji: '🍽️', label: 'Cena elegante' },
  work: { emoji: '💼', label: 'Lavoro' },
  sport: { emoji: '🏃', label: 'Sport' },
  city: { emoji: '🏙️', label: 'Città' },
  party: { emoji: '🎉', label: 'Serata' },
  other: { emoji: '📍', label: 'Altro' },
};

export const MODES: Record<ModeId, { emoji: string; label: string }> = {
  plane: { emoji: '✈️', label: 'Volo' },
  train: { emoji: '🚆', label: 'Treno' },
  bus: { emoji: '🚌', label: 'Bus' },
  car: { emoji: '🚗', label: 'Auto' },
  ferry: { emoji: '⛴️', label: 'Traghetto' },
};

export const BAGS: Record<BagId, { emoji: string; label: string }> = {
  backpack_s: { emoji: '🎒', label: 'Zaino piccolo' },
  backpack_l: { emoji: '🎒', label: 'Zaino grande' },
  cabin: { emoji: '🧳', label: 'Trolley cabina' },
  suitcase: { emoji: '🧳', label: 'Valigia grande' },
};

export const TRIP_COLOR = '#38bdf8';

export interface Place { name: string; country: string; lat: number | null; lon: number | null }
export interface PlaceHit { name: string; region: string; country: string; lat: number; lon: number }
export interface WeatherDay { date: string; min: number | null; max: number | null; rain: number | null; rainy: boolean; code: number | null }

export interface Leg {
  id: string; tripId: string; mode: ModeId; from: string; to: string; departAt: string; arriveAt: string;
  code: string; booking: string; notes: string; checkinHours: number | null; direction: 'out' | 'back' | 'other'; eventId: string | null;
}

export interface Activity {
  id: string; tripId: string; day: string; tag: TagId; title: string; time: string; minutes: number;
  place: string; notes: string; eventId: string | null; position: number;
}

export interface Trip {
  id: string; name: string; place: Place | null; startDate: string; endDate: string; bag: BagId;
  canWash: boolean; quietAlexa: boolean; notes: string;
  weather: WeatherDay[] | null; weatherAt: string | null; weatherKind: 'forecast' | 'last_year' | null; weatherChanged: boolean;
  source: 'manual' | 'event'; legs: Leg[]; activities: Activity[];
}

export interface TripDay {
  date: string; tripId: string; name: string; label: string; emoji: string; color: string;
  kind: 'start' | 'middle' | 'end' | 'single'; index: number; total: number;
}

export type TripDraft = Partial<Pick<Trip, 'name' | 'place' | 'startDate' | 'endDate' | 'bag' | 'canWash' | 'quietAlexa' | 'notes'>>;
export type LegDraft = Partial<Omit<Leg, 'id' | 'tripId' | 'eventId'>>;
export type ActivityDraft = Partial<Omit<Activity, 'id' | 'tripId' | 'eventId'>>;

export class TripsError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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
    throw new TripsError(0, 'Connessione assente o server non raggiungibile.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new TripsError(res.status, `Risposta inattesa dal server (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('calendary:unauthorized'));
    throw new TripsError(res.status, data?.error || `Errore ${res.status}`);
  }
  return data as T;
}

export const tripsApi = {
  list: () => request<Trip[]>('GET', '/trips'),
  get: (id: string) => request<Trip>('GET', `/trips/${id}`),
  create: (t: TripDraft) => request<Trip>('POST', '/trips', t),
  update: (id: string, t: TripDraft) => request<Trip>('PATCH', `/trips/${id}`, t),
  remove: (id: string) => request<{ ok: true }>('DELETE', `/trips/${id}`),
  refreshWeather: (id: string) => request<Trip>('POST', `/trips/${id}/weather`, {}),
  addLeg: (tripId: string, l: LegDraft) => request<Leg>('POST', `/trips/${tripId}/legs`, l),
  updateLeg: (id: string, l: LegDraft) => request<Leg>('PATCH', `/trips/legs/${id}`, l),
  removeLeg: (id: string) => request<{ ok: true }>('DELETE', `/trips/legs/${id}`),
  addActivity: (tripId: string, a: ActivityDraft) => request<Activity>('POST', `/trips/${tripId}/activities`, a),
  updateActivity: (id: string, a: ActivityDraft) => request<Activity>('PATCH', `/trips/activities/${id}`, a),
  removeActivity: (id: string) => request<{ ok: true }>('DELETE', `/trips/activities/${id}`),
  days: (from: string, to: string) => request<TripDay[]>('GET', `/trips/days?from=${from}&to=${to}`),
  geocode: (q: string) => request<PlaceHit[]>('GET', `/trips/geocode?q=${encodeURIComponent(q)}`),
  fromEvent: (e: { eventId: string; title: string; start: string; end: string; allDay: boolean; location: string }) =>
    request<{ trip: Trip; eventDeletable: boolean }>('POST', '/trips/from-event', e),
};
