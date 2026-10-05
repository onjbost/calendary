import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { api, type CalEvent, type Calendar, type Dose, type Goal, type Note, type Pill, type Task } from './api';
import { onChanged, type Scope } from './live';

/** Fetch + refetch on live "changed" events for a scope, plus a slow safety poll. */
function useLiveResource<T>(scope: Scope, key: string, load: () => Promise<T>, initial: T, pollMs = 5 * 60_000) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await loadRef.current();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
    const off = onChanged(scope, reload);
    const timer = setInterval(reload, pollMs);
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [scope, key, reload, pollMs]);

  return { data, setData, loading, error, reload };
}

export function useEvents(from: Date, to: Date) {
  const key = `${from.toISOString()}|${to.toISOString()}`;
  return useLiveResource<CalEvent[]>('events', key, () => api.events(from, to), []);
}

export function useCalendars() {
  return useLiveResource<Calendar[]>('calendars', 'all', () => api.calendars(), []);
}

export function useTasks(date: string) {
  return useLiveResource<{ tasks: Task[]; pendingBefore: number }>('tasks', date, () => api.tasks(date), { tasks: [], pendingBefore: 0 });
}

export function useGoals() {
  return useLiveResource<Goal[]>('goals', 'all', () => api.goals(), []);
}

export function useNotes() {
  return useLiveResource<Note[]>('notes', 'all', () => api.notes(), []);
}

export function usePills() {
  return useLiveResource<Pill[]>('pills', 'all', () => api.pills(), []);
}

export function useDoses(date: string) {
  return useLiveResource<Dose[]>('pills', date, () => api.doses(date), []);
}

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Horizontal swipe (touch) → previous/next. Vertical scrolling is left alone. */
export function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onPrev();
      else onNext();
    },
  };
}

export const isNarrowScreen = () => window.matchMedia('(max-width: 700px)').matches;

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
