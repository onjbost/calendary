import type { GoalItem, GoalPace, GoalStatus, Routine, RoutineDraft } from './api';

export const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const PACE: Record<GoalPace, { label: string; cls: string }> = {
  done: { label: 'Completato', cls: 'neon-lime' },
  on_track: { label: 'In linea', cls: 'neon-cyan' },
  behind: { label: 'In ritardo', cls: 'neon-amber' },
  untracked: { label: 'Da aggiornare', cls: 'muted' },
};

export const STATUS_LABEL: Record<GoalStatus, string> = {
  not_started: 'Non iniziato',
  in_progress: 'In corso',
  at_risk: 'A rischio',
  done: 'Completato',
};

export const KIND_LABEL = { check: 'Spunta', number: 'Valore / target', count: 'Conteggio evidenze' } as const;
export const PERIOD_LABEL = { total: 'in totale', week: 'a settimana', quarter: 'a trimestre' } as const;

export const pct = (v: number | null | undefined) => `${Math.round((v || 0) * 100)}%`;

export function describeRoutine(r: Pick<Routine, 'freq' | 'days' | 'intervalWeeks' | 'monthDay' | 'time' | 'duration'> | RoutineDraft) {
  const time = `${r.time} · ${r.duration} min`;
  if (r.freq === 'weekly') {
    const days = WEEK_ORDER.filter((d) => r.days?.includes(d)).map((d) => DAY_SHORT[d]).join(', ');
    const every = (r.intervalWeeks || 1) > 1 ? `Ogni ${r.intervalWeeks} settimane` : 'Ogni settimana';
    return `${every}: ${days} · ${time}`;
  }
  const day = r.monthDay === -1 || r.monthDay === null || r.monthDay === undefined ? 'ultimo giorno lavorativo' : `giorno ${r.monthDay}`;
  return `${r.freq === 'monthly' ? 'Ogni mese' : 'Ogni trimestre'}, ${day} · ${time}`;
}

/** Short status line for a measure, e.g. "55 / 100 %", "questa settimana 1/1 · 3 su 5 settimane". */
export function itemStatus(i: GoalItem) {
  const u = i.unit ? ` ${i.unit}` : '';
  if (i.kind === 'check') return i.done ? 'fatto' : 'da fare';
  if (i.kind === 'number') return `${fmtNum(i.current)}${i.target !== null ? ` / ${fmtNum(i.target)}` : ''}${u}`;
  if (i.period === 'total') return `${i.count ?? 0}${i.target ? ` / ${fmtNum(i.target)}` : ''} evidenze`;
  const label = i.period === 'week' ? 'questa settimana' : 'questo trimestre';
  const periods = i.period === 'week' ? 'settimane' : 'trimestri';
  return `${label} ${i.count ?? 0}/${fmtNum(i.target || 1)} · in regola ${i.periodsMet ?? 0} su ${i.periodsElapsed ?? 0} ${periods}`;
}

const fmtNum = (v: number | null | undefined) => (v === null || v === undefined ? '0' : Number.isInteger(v) ? String(v) : v.toFixed(1));
