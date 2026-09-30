import { useEffect, useMemo, useState } from 'react';
import type { CalEvent } from '../api';
import { countdown, effectiveReminder, hm } from '../dates';
import { useEvents, useNow } from '../hooks';
import { scheduleNativeReminders } from '../native';
import { useUI } from '../ui';

const DISMISSED_KEY = 'calendary.dismissedAlerts';

function loadDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
  } catch {
    return [];
  }
}

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
  } catch {
    /* audio blocked until the user interacts */
  }
}

/**
 * In-app alert: when an important event (or one with a reminder) enters its reminder window,
 * show a full-screen neon card with a live countdown. Also keeps native reminders in sync on Android.
 */
export function AlertWatcher({ sound = false }: { sound?: boolean }) {
  const { startFive } = useUI();
  const now = useNow(15_000);
  const hourKey = Math.floor(now.getTime() / 3600e3);
  const range = useMemo(() => {
    const from = new Date(hourKey * 3600e3 - 3600e3);
    return { from, to: new Date(from.getTime() + 3 * 86400e3) };
  }, [hourKey]);
  const { data: events } = useEvents(range.from, range.to);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);

  useEffect(() => {
    scheduleNativeReminders(events);
  }, [events]);

  const active: CalEvent | undefined = events.find((ev) => {
    if (ev.allDay || !ev.important) return false;
    const reminder = effectiveReminder(ev) ?? 30;
    const start = Date.parse(ev.start);
    const t = now.getTime();
    return t >= start - reminder * 60_000 && t < start + 5 * 60_000 && !dismissed.includes(`${ev.id}|${ev.start}`);
  });

  useEffect(() => {
    if (active && sound) beep();
  }, [active?.id, sound]); // beep once per new alert, not on every tick

  if (!active) return null;

  const key = `${active.id}|${active.start}`;
  const dismiss = () => {
    const next = [...dismissed, key].slice(-100);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const left = Date.parse(active.start) - now.getTime();

  return (
    <div className="alert-overlay">
      <div className="alert-card glass glow-pink">
        <div className="mono small neon-pink">⚡ ATTIVITÀ IMPORTANTE</div>
        <div className="countdown neon-cyan" style={{ fontSize: '3rem' }}>{left > 0 ? `Tra ${countdown(left)}` : 'Adesso!'}</div>
        <h1 className="neon-pink" style={{ fontSize: '2rem' }}>{active.title}</h1>
        <div className="muted">{hm(active.start)} – {hm(active.end)}{active.location ? ` · ${active.location}` : ''}</div>
        <div className="small">Non pensarci troppo: conta fino a 5 e muoviti.</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn pink lg" onClick={() => { dismiss(); startFive(active.title); }}>5 · 4 · 3 · 2 · 1 · VAI</button>
          <button className="btn lg" onClick={dismiss}>Ho capito</button>
        </div>
      </div>
    </div>
  );
}
