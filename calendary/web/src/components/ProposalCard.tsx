import { useMemo, useState } from 'react';
import { api, type Proposal, type RoutineDraft, type TaskDraft } from '../api';
import { capitalize, fmt, hm } from '../dates';
import { describeRoutine } from '../goals';
import { useCalendars } from '../hooks';
import { notifyChanged } from '../live';
import { QUADRANTS } from './Matrix';

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

/** Suggested changes from the assistant or planner: nothing is written until "Approva". */
export function ProposalCard({ proposal, status = 'pending', onResolved }: {
  proposal: Proposal;
  status?: ProposalStatus;
  onResolved: (status: ProposalStatus, message: string) => void;
}) {
  const { data: calendars } = useCalendars();
  const localCals = useMemo(() => calendars.filter((c) => c.type === 'local'), [calendars]);
  const [selected, setSelected] = useState<boolean[]>(() => proposal.items.map(() => true));
  const [calendarId, setCalendarId] = useState<string>(() =>
    proposal.kind === 'events' ? proposal.items[0]?.calendarId || '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const count = selected.filter(Boolean).length;
  const done = status !== 'pending';

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      let message = '';
      if (proposal.kind === 'events') {
        const items = proposal.items.filter((_, i) => selected[i]).map((it) => ({ ...it, calendarId: calendarId || it.calendarId }));
        await api.createEvents(items, proposal.planId);
        notifyChanged('events');
        message = `✓ ${items.length} ${items.length === 1 ? 'evento aggiunto' : 'eventi aggiunti'} al calendario`;
      } else if (proposal.kind === 'routines') {
        const items = proposal.items.filter((_, i) => selected[i]).map(({ goalTitle: _g, ...r }) => r);
        await api.createRoutines(items);
        notifyChanged('goals');
        notifyChanged('events');
        message = `✓ ${items.length} ${items.length === 1 ? 'routine aggiunta' : 'routine aggiunte'}: le trovi nel calendario`;
      } else if (proposal.kind === 'tasks') {
        const items = proposal.items.filter((_, i) => selected[i]);
        await api.createTasks(items);
        notifyChanged('tasks');
        message = `✓ ${items.length} attività aggiunte alla matrice`;
      } else {
        const ids = proposal.items.filter((_, i) => selected[i]).map((it) => it.id);
        const r = await api.deleteEvents(ids);
        notifyChanged('events');
        message = `✓ ${r.deleted} eventi eliminati`;
      }
      setResult(message);
      onResolved('approved', message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const glow = proposal.kind === 'delete' ? 'glow-pink' : proposal.kind === 'tasks' ? 'glow-amber' : proposal.kind === 'routines' ? 'glow-cyan' : 'glow-violet';

  return (
    <div className={`glass proposal ${glow}`}>
      <div className="row nowrap">
        <h3 className="grow">{proposal.kind === 'delete' ? '🗑 ' : proposal.kind === 'tasks' ? '🧭 ' : proposal.kind === 'routines' ? '↻ ' : '📅 '}{proposal.title}</h3>
        {!done && <span className="chip">{count}/{proposal.items.length}</span>}
      </div>
      {proposal.summary && <div className="muted small" style={{ marginTop: 6 }}>{proposal.summary}</div>}
      {proposal.warnings?.map((w) => <div key={w} className="alert" style={{ marginTop: 8 }}>{w}</div>)}

      <div className="proposal-items">
        {proposal.items.map((it, i) => {
          let when = '';
          let label = '';
          if (proposal.kind === 'routines') {
            const r = it as RoutineDraft;
            when = r.freq === 'weekly' ? 'SETTIMANALE' : r.freq === 'monthly' ? 'MENSILE' : 'TRIMESTRALE';
            label = `${r.title} · ${describeRoutine(r)}`;
          } else if (proposal.kind === 'tasks') {
            const t = it as TaskDraft;
            when = `Q${t.quadrant}`;
            label = `${t.title} · ${QUADRANTS[t.quadrant - 1].title}`;
          } else {
            const e = it as { title: string; start: string; end: string; allDay?: boolean };
            when = capitalize(fmt(e.start, 'EEE d MMM')) + (e.allDay ? '' : ` ${hm(e.start)}`);
            label = `${e.title}${e.allDay ? '' : ` (${hm(e.start)}–${hm(e.end)})`}`;
          }
          return (
            <label key={i} className="proposal-item" style={{ cursor: done ? 'default' : 'pointer' }}>
              {!done && (
                <input type="checkbox" className="check" checked={selected[i]}
                  onChange={(e) => setSelected((s) => s.map((v, j) => (j === i ? e.target.checked : v)))} />
              )}
              <span className="when">{when}</span>
              <span className="grow" style={proposal.kind === 'delete' ? { textDecoration: 'line-through' } : undefined}>{label}</span>
            </label>
          );
        })}
      </div>

      {error && <div className="alert error" style={{ marginBottom: 8 }}>{error}</div>}

      {done ? (
        <div className={status === 'approved' ? 'neon-lime small' : 'faint small'}>
          {status === 'approved' ? result || '✓ Approvata' : 'Proposta scartata'}
        </div>
      ) : (
        <div className="row">
          {proposal.kind === 'events' && localCals.length > 1 && (
            <select className="input" value={calendarId || localCals[0]?.id} onChange={(e) => setCalendarId(e.target.value)} style={{ width: 'auto' }}>
              {localCals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => onResolved('rejected', 'Proposta scartata')} disabled={busy}>Scarta</button>
          <button className={`btn ${proposal.kind === 'delete' ? 'danger' : 'primary'}`} onClick={approve} disabled={busy || !count}>
            {busy ? '…' : proposal.kind === 'delete' ? `Elimina ${count}` : `Approva ${count}`}
          </button>
        </div>
      )}
    </div>
  );
}
