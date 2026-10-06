// Live updates: the server sends "changed" over SSE after every mutation,
// so the tablet refreshes as soon as something is edited from the PC.

export type Scope = 'events' | 'calendars' | 'tasks' | 'goals' | 'notes' | 'pills' | 'trips';

const bus = new EventTarget();
let source: EventSource | null = null;

export function connectLive() {
  if (source) return;
  source = new EventSource('/api/stream');
  source.addEventListener('changed', (e) => {
    try {
      const { scope } = JSON.parse((e as MessageEvent).data) as { scope: Scope };
      notifyChanged(scope);
    } catch {
      /* ignore malformed */
    }
  });
  // After a reconnect we may have missed something: refresh everything.
  source.addEventListener('open', () => {
    notifyChanged('calendars');
    notifyChanged('tasks');
    notifyChanged('goals');
    notifyChanged('notes');
    notifyChanged('pills');
    notifyChanged('trips');
  });
}

export function disconnectLive() {
  source?.close();
  source = null;
}

export function notifyChanged(scope: Scope) {
  bus.dispatchEvent(new CustomEvent('changed', { detail: scope }));
  // calendars affect how events look (colors, visibility)
  if (scope === 'calendars') bus.dispatchEvent(new CustomEvent('changed', { detail: 'events' }));
}

export function onChanged(scope: Scope, fn: () => void) {
  const handler = (e: Event) => {
    if ((e as CustomEvent).detail === scope) fn();
  };
  bus.addEventListener('changed', handler);
  return () => bus.removeEventListener('changed', handler);
}
