import { useMemo, useState } from 'react';
import { addDays, isSameDay } from 'date-fns';
import { api, type CalEvent, type Goal, type GoalItem } from '../api';
import { capitalize, fmt, hm, parseYmd } from '../dates';
import { describeRoutine, itemStatus, PACE, pct } from '../goals';
import { useEvents, useNow } from '../hooks';
import { notifyChanged } from '../live';
import { useUI } from '../ui';

export function ProgressBar({ value, expected, color }: { value: number; expected?: number; color: string }) {
  return (
    <div className="gbar" style={{ ['--c' as string]: color }}>
      <div className="gbar-fill" style={{ width: pct(value) }} />
      {expected !== undefined && expected > 0 && expected < 1 && (
        <div className="gbar-expected" style={{ left: pct(expected) }} title={`Atteso a oggi: ${pct(expected)}`} />
      )}
    </div>
  );
}

export function PaceChip({ goal }: { goal: Goal }) {
  const p = PACE[goal.pace];
  return <span className={`chip ${p.cls}`} title={goal.pace === 'untracked' ? 'Nessun valore inserito: aggiorna misure o evidenze' : `Atteso a oggi ${pct(goal.expected)}`}>{p.label}</span>;
}

async function toggleRoutine(ev: CalEvent, setEvents: (fn: (p: CalEvent[]) => CalEvent[]) => void) {
  if (!ev.routineId || !ev.occurrenceDate) return;
  const done = !ev.done;
  setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, done } : e)));
  await api.checkRoutine(ev.routineId, ev.occurrenceDate, done).catch(() => {});
  notifyChanged('goals');
  notifyChanged('events');
}

/** Routine occurrences of the week containing `anchor`, grouped by day, tickable. */
export function WeekRoutines({ anchor, compact = false, onlyToday = false }: { anchor: Date; compact?: boolean; onlyToday?: boolean }) {
  const now = useNow(60_000);
  const range = useMemo(() => {
    const monday = addDays(anchor, -((anchor.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return onlyToday
      ? { from: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()), to: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1) }
      : { from: monday, to: addDays(monday, 7) };
  }, [anchor.toDateString(), onlyToday]); // keyed by day: callers pass a new Date on every render
  const { data, setData } = useEvents(range.from, range.to);
  const routines = data.filter((e) => e.source === 'routine');
  const done = routines.filter((r) => r.done).length;

  if (!routines.length) {
    return <div className="empty small">{onlyToday ? 'Nessuna routine oggi.' : 'Nessuna routine questa settimana: aggiungine una a un obiettivo.'}</div>;
  }

  const days = [...new Set(routines.map((r) => r.occurrenceDate!))];
  return (
    <div className="stack" style={{ gap: compact ? 6 : 10 }}>
      <div className="row small">
        <ProgressBar value={done / routines.length} color="var(--lime)" />
        <span className="muted text-nowrap">{done}/{routines.length} fatte</span>
      </div>
      {days.map((d) => {
        const day = parseYmd(d);
        const isToday = isSameDay(day, now);
        return (
          <div key={d} className="routine-day">
            {!onlyToday && <div className={`wd ${isToday ? 'neon-cyan' : ''}`}>{capitalize(fmt(day, 'EEEE d'))}{isToday ? ' · oggi' : ''}</div>}
            {routines.filter((r) => r.occurrenceDate === d).map((r) => {
              const late = !r.done && Date.parse(r.end) < now.getTime();
              return (
                <label key={r.id} className={`routine-row ${r.done ? 'done' : ''} ${late ? 'late' : ''}`}>
                  <input type="checkbox" className="check" checked={!!r.done} onChange={() => toggleRoutine(r, setData)} />
                  <span className="dot" style={{ color: r.color }} />
                  <span className="mono tiny when">{hm(r.start)}</span>
                  <span className="grow">
                    <span className="routine-title">{r.title}</span>
                    {!compact && <span className="faint tiny"> · {r.calendarName}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ItemRow({ item, goal, onEvidence }: { item: GoalItem; goal: Goal; onEvidence: (itemId: string) => void }) {
  const { toast } = useUI();
  const [value, setValue] = useState(item.current === null ? '' : String(item.current));

  const save = async (patch: Partial<GoalItem>) => {
    try {
      await api.updateGoalItem(item.id, patch);
      notifyChanged('goals');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="gitem">
      {item.kind === 'check' ? (
        <input type="checkbox" className="check" checked={item.done} onChange={() => save({ done: !item.done })} />
      ) : (
        <div className="gitem-ring" style={{ ['--p' as string]: `${Math.round((item.progress ?? 0) * 100)}`, ['--c' as string]: goal.color }} title={item.progress === null ? 'senza target' : pct(item.progress)} />
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className={item.kind === 'check' && item.done ? 'gitem-title done' : 'gitem-title'}>{item.title}</div>
        <div className="faint tiny">{itemStatus(item)}{item.due ? ` · entro ${fmt(parseYmd(item.due), 'd MMM yyyy')}` : ''}</div>
      </div>
      {item.kind === 'number' && (
        <input className="input gitem-input" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)}
          onBlur={() => value !== String(item.current ?? '') && save({ current: value === '' ? null : Number(value) })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} title="Valore attuale" />
      )}
      {item.kind === 'count' && <button className="btn sm" onClick={() => onEvidence(item.id)} title="Aggiungi un'evidenza per questa misura">＋1</button>}
    </div>
  );
}

export function GoalCard({ goal, onEdit, onRoutine, onEvidence }: {
  goal: Goal;
  onEdit: () => void;
  onRoutine: (routineId?: string) => void;
  onEvidence: (itemId?: string) => void;
}) {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const required = goal.requiredItems;
  const doneChecks = goal.items.filter((i) => i.progress !== null && (i.progress ?? 0) >= 1).length;

  const removeEvidence = async (id: string) => {
    await api.deleteEvidence(id).catch((e) => toast(e.message, 'error'));
    notifyChanged('goals');
  };

  return (
    <section className="glass pad goal-card" style={{ ['--gc' as string]: goal.color }}>
      <div className="row nowrap" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 className="goal-title">{goal.title}</h3>
          <div className="faint tiny">{goal.category}{goal.category ? ' · ' : ''}scade {fmt(parseYmd(goal.deadline), 'd MMM yyyy')} ({goal.daysLeft} gg)</div>
        </div>
        <PaceChip goal={goal} />
        <button className="btn icon ghost sm" onClick={onEdit} title="Modifica obiettivo">✎</button>
      </div>

      <div className="row nowrap" style={{ margin: '12px 0 4px' }}>
        <ProgressBar value={goal.progress} expected={goal.expected} color={goal.color} />
        <span className="mono goal-pct" style={{ color: goal.color }}>{pct(goal.progress)}</span>
      </div>
      <div className="faint tiny">
        atteso a oggi {pct(goal.expected)}{required ? ` · soglia: ${required} misure su ${goal.items.length} (raggiunte ${doneChecks})` : ''}
      </div>

      {goal.items.length > 0 && (
        <div className="stack" style={{ gap: 4, marginTop: 12 }}>
          {goal.items.map((i) => <ItemRow key={`${i.id}-${i.current}`} item={i} goal={goal} onEvidence={(id) => onEvidence(id)} />)}
        </div>
      )}

      {goal.routines.length > 0 && (
        <div className="stack" style={{ gap: 2, marginTop: 12 }}>
          <div className="faint tiny mono">ROUTINE</div>
          {goal.routines.map((r) => (
            <button key={r.id} className="routine-chip" onClick={() => onRoutine(r.id)} title="Modifica routine">
              <span>↻</span>
              <span className="grow" style={{ textAlign: 'left' }}>
                <span className={r.active ? '' : 'faint'}>{r.title}</span>
                <span className="faint tiny"> · {describeRoutine(r)}{r.active ? '' : ' · in pausa'}</span>
              </span>
              {r.stats && r.stats.recentOccurred > 0 && (
                <span className="chip tiny" title="Fatte nelle ultime 4 settimane">{r.stats.recentDone}/{r.stats.recentOccurred}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 14, gap: 8 }}>
        <button className="btn sm pink" onClick={() => onEvidence()}>＋ Evidenza</button>
        <button className="btn sm" onClick={() => onRoutine()}>＋ Routine</button>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Dettagli ({goal.evidence.length} evidenze)</button>
      </div>

      {open && (
        <div className="stack" style={{ marginTop: 12 }}>
          {goal.description && <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{goal.description}</div>}
          <div className="faint tiny mono">EVIDENZE</div>
          {!goal.evidence.length && <div className="faint small">Ancora nessuna evidenza: annota risultati, feedback e attestati man mano, ti serviranno per MidYear e Year-End.</div>}
          {goal.evidence.map((e) => (
            <div key={e.id} className="evidence-row">
              <span className="mono tiny when">{fmt(parseYmd(e.date), 'dd/MM/yy')}</span>
              <span className="grow small" style={{ whiteSpace: 'pre-wrap' }}>
                {e.text}
                {e.itemId && <span className="faint tiny"> · {goal.items.find((i) => i.id === e.itemId)?.title}</span>}
              </span>
              <button className="btn icon ghost sm" onClick={() => removeEvidence(e.id)} title="Elimina evidenza">🗑</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** One line per goal with its bar: for the dashboard and the tablet. */
export function GoalsMini({ goals, onOpen }: { goals: Goal[]; onOpen?: () => void }) {
  if (!goals.length) return <div className="empty small">Nessun obiettivo. Aggiungili dalla pagina Obiettivi.</div>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {goals.map((g) => (
        <div key={g.id} className="goal-mini" onClick={onOpen} style={{ cursor: onOpen ? 'pointer' : undefined }}>
          <div className="row nowrap small">
            <span className="dot" style={{ color: g.color }} />
            <span className="grow goal-mini-title">{g.title}</span>
            <span className={`tiny ${PACE[g.pace].cls}`}>{PACE[g.pace].label}</span>
            <span className="mono tiny" style={{ width: 38, textAlign: 'right' }}>{pct(g.progress)}</span>
          </div>
          <ProgressBar value={g.progress} expected={g.expected} color={g.color} />
        </div>
      ))}
    </div>
  );
}
