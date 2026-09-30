import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CalEvent, EventDraft } from './api';
import { EventModal } from './components/EventModal';
import { FiveSeconds } from './components/FiveSeconds';

interface UI {
  toast: (message: string, kind?: 'ok' | 'error') => void;
  startFive: (label?: string) => void;
  openEvent: (event: CalEvent) => void;
  newEvent: (draft?: Partial<EventDraft>) => void;
}

const Ctx = createContext<UI | null>(null);

export function useUI() {
  const ui = useContext(Ctx);
  if (!ui) throw new Error('useUI outside provider');
  return ui;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [five, setFive] = useState<{ label?: string } | null>(null);
  const [editing, setEditing] = useState<{ event?: CalEvent; draft?: Partial<EventDraft> } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToastMsg({ text, kind });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const value = useMemo<UI>(() => ({
    toast,
    startFive: (label) => setFive({ label }),
    openEvent: (event) => setEditing({ event }),
    newEvent: (draft) => setEditing({ draft: draft || {} }),
  }), [toast]);

  const closeFive = useCallback(() => setFive(null), []);

  return (
    <Ctx.Provider value={value}>
      {children}
      {editing && (
        <EventModal event={editing.event} draft={editing.draft} onClose={() => setEditing(null)} />
      )}
      {five && <FiveSeconds label={five.label} onDone={closeFive} />}
      {toastMsg && (
        <div className={`toast glass ${toastMsg.kind === 'error' ? 'glow-pink' : 'glow-cyan'}`}>{toastMsg.text}</div>
      )}
    </Ctx.Provider>
  );
}
