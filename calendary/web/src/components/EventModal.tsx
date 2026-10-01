import { useMemo, useState, type MouseEvent } from 'react';
import { addDays, addHours, startOfHour } from 'date-fns';
import { api, type CalEvent, type EventDraft } from '../api';
import { capitalize, fmt, hm, timeRange, ymd } from '../dates';
import { useCalendars } from '../hooks';
import { notifyChanged } from '../live';
import { navigate } from '../router';
import { useUI } from '../ui';
import { Modal } from './Modal';
import { isMoveoLink, openMoveoUrl } from '../suite';

const REMINDERS: { value: string; label: string }[] = [
  { value: '', label: 'Automatico' },
  { value: '0', label: "All'inizio" },
  { value: '5', label: '5 minuti prima' },
  { value: '10', label: '10 minuti prima' },
  { value: '15', label: '15 minuti prima' },
  { value: '30', label: '30 minuti prima' },
  { value: '60', label: '1 ora prima' },
  { value: '120', label: '2 ore prima' },
  { value: '1440', label: '1 giorno prima' },
];

interface Form {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  important: boolean;
  reminder: string;
  linkUrl: string;
  linkLabel: string;
}

function initialForm(event?: CalEvent, draft?: Partial<EventDraft>): Form {
  const src = event || draft || {};
  const start = src.start ? new Date(src.start) : addHours(startOfHour(new Date()), 1);
  const end = src.end ? new Date(src.end) : addHours(start, 1);
  const allDay = !!src.allDay;
  return {
    title: src.title || '',
    calendarId: src.calendarId || '',
    allDay,
    startDate: ymd(start),
    startTime: allDay ? '09:00' : hm(start),
    endDate: allDay ? ymd(new Date(end.getTime() - 1)) : ymd(end),
    endTime: allDay ? '10:00' : hm(end),
    location: src.location || '',
    description: src.description || '',
    important: !!src.important,
    reminder: src.reminderMinutes === null || src.reminderMinutes === undefined ? '' : String(src.reminderMinutes),
    linkUrl: src.linkUrl || '',
    linkLabel: src.linkLabel || '',
  };
}

/** Big call-to-action for events that carry a deep link (a Moveo workout, a meeting URL…). */
export function EventLinkButton({ event, onOpen }: { event: Pick<CalEvent, 'linkUrl' | 'linkLabel'>; onOpen?: () => void }) {
  if (!event.linkUrl) return null;
  const external = /^https?:\/\//i.test(event.linkUrl) && !event.linkUrl.startsWith(window.location.origin);
  const click = (e: MouseEvent) => {
    if (isMoveoLink(event.linkUrl)) {
      // Moveo workout: open it signed in (and in the Moveo app on the tablet).
      e.preventDefault();
      openMoveoUrl(event.linkUrl!);
    }
    onOpen?.();
  };
  return (
    <a className="btn primary" href={event.linkUrl} target={external ? '_blank' : undefined} rel="noopener"
      onClick={click} style={{ alignSelf: 'flex-start', textDecoration: 'none' }}>
      ▶ {event.linkLabel || 'Apri'}
    </a>
  );
}

export function EventModal({ event, draft, onClose }: {
  event?: CalEvent;
  draft?: Partial<EventDraft>;
  onClose: () => void;
}) {
  const { toast, startFive } = useUI();
  const { data: calendars } = useCalendars();
  const localCals = useMemo(() => calendars.filter((c) => c.type === 'local'), [calendars]);
  const [f, setF] = useState<Form>(() => initialForm(event, draft));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  // Goal routines: tick the occurrence (optionally with a note that becomes evidence).
  if (event?.source === 'routine' && event.routineId && event.occurrenceDate) {
    const toggle = async () => {
      setBusy(true);
      try {
        await api.checkRoutine(event.routineId!, event.occurrenceDate!, !event.done, note);
        notifyChanged('events');
        notifyChanged('goals');
        toast(event.done ? 'Spunta rimossa' : 'Routine completata ✨');
        onClose();
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    };
    return (
      <Modal title={`↻ ${event.title}`} onClose={onClose} glow="cyan"
        footer={<>
          <button className="btn ghost" onClick={() => { onClose(); navigate('/obiettivi'); }}>Apri obiettivi</button>
          <span className="spacer" />
          {!event.done && <button className="btn pink" onClick={() => { onClose(); startFive(event.title); }}>⚡ 5 secondi</button>}
          <button className={`btn ${event.done ? '' : 'primary'}`} onClick={toggle} disabled={busy}>{event.done ? 'Annulla spunta' : '✓ Fatto'}</button>
        </>}>
        <div className="stack">
          {error && <div className="alert error">{error}</div>}
          <div className="row"><span className="dot" style={{ color: event.color }} /> <span className="muted">Routine · {event.calendarName}</span></div>
          <div className="neon-cyan mono">{capitalize(fmt(event.start, 'EEEE d MMMM'))} · {timeRange(event)}</div>
          {event.done ? (
            <div className="alert ok small">Completata ✓</div>
          ) : (
            <label className="field">Nota (facoltativa: diventa un'evidenza dell'obiettivo)
              <textarea className="input" rows={3} value={note}
                onChange={(e) => setNote(e.target.value)} placeholder="Es. Inviato time sheet, nessuna correzione" />
            </label>
          )}
          <div className="faint tiny">Orari e giorni si cambiano dalla routine nella pagina Obiettivi.</div>
        </div>
      </Modal>
    );
  }

  // Events imported from iCal (and goal milestones) can't be edited here.
  if (event?.readOnly) {
    return (
      <Modal title={event.title} onClose={onClose} glow="violet"
        footer={<>
          <button className="btn pink" onClick={() => { onClose(); startFive(event.title); }}>⚡ 5 secondi</button>
          <button className="btn primary" onClick={onClose}>Chiudi</button>
        </>}>
        <div className="stack">
          <div className="row"><span className="dot" style={{ color: event.color }} /> <span className="muted">{event.calendarName}{event.source === 'ics' ? ' · iCal (sola lettura)' : event.source === 'milestone' ? ' · obiettivi' : ''}</span></div>
          <div className="neon-cyan mono">{capitalize(fmt(event.start, 'EEEE d MMMM yyyy'))}</div>
          <div>{timeRange(event)}</div>
          {event.location && <div>📍 {event.location}</div>}
          {event.description && <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{event.description}</div>}
          <EventLinkButton event={event} onOpen={onClose} />
          {event.source === 'milestone' ? (
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); navigate('/obiettivi'); }}>Apri obiettivi →</button>
          ) : (
            <div className="faint tiny">Gli eventi importati si modificano nel calendario di origine (Google, Outlook…).</div>
          )}
        </div>
      </Modal>
    );
  }

  const toPayload = (): EventDraft => {
    const start = f.allDay ? new Date(`${f.startDate}T00:00`) : new Date(`${f.startDate}T${f.startTime}`);
    const end = f.allDay ? addDays(new Date(`${f.endDate}T00:00`), 1) : new Date(`${f.endDate}T${f.endTime}`);
    return {
      title: f.title.trim(),
      calendarId: f.calendarId || localCals[0]?.id,
      allDay: f.allDay,
      start: start.toISOString(),
      end: end.toISOString(),
      location: f.location,
      description: f.description,
      important: f.important,
      reminderMinutes: f.reminder === '' ? null : Number(f.reminder),
      linkUrl: f.linkUrl.trim() || null,
      linkLabel: f.linkLabel.trim() || null,
    };
  };

  const onStartChange = (date: string, time: string) => {
    // keep the duration when moving the start
    const oldStart = new Date(`${f.startDate}T${f.startTime}`).getTime();
    const oldEnd = new Date(`${f.endDate}T${f.endTime}`).getTime();
    const duration = Math.max(0, oldEnd - oldStart) || 3600e3;
    const newStart = new Date(`${date}T${time}`);
    if (Number.isNaN(newStart.getTime())) return setF((p) => ({ ...p, startDate: date, startTime: time }));
    const newEnd = new Date(newStart.getTime() + duration);
    setF((p) => ({ ...p, startDate: date, startTime: time, endDate: ymd(newEnd), endTime: hm(newEnd) }));
  };

  const save = async () => {
    if (!f.title.trim()) return setError('Inserisci un titolo');
    const payload = toPayload();
    if (Date.parse(payload.end) < Date.parse(payload.start)) return setError("La fine è prima dell'inizio");
    setBusy(true);
    setError(null);
    try {
      if (event) await api.updateEvent(event.id, payload);
      else await api.createEvent(payload);
      notifyChanged('events');
      toast(event ? 'Evento aggiornato' : 'Evento aggiunto al calendario');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (wholePlan = false) => {
    if (!event) return;
    setBusy(true);
    try {
      if (wholePlan && event.planId) {
        const r = await api.deletePlan(event.planId);
        toast(`Piano eliminato (${r.deleted} sessioni)`);
      } else {
        await api.deleteEvent(event.id);
        toast('Evento eliminato');
      }
      notifyChanged('events');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={event ? 'Modifica evento' : 'Nuovo evento'}
      onClose={onClose}
      footer={
        <>
          {event && !confirmDelete && <button className="btn danger" onClick={() => setConfirmDelete(true)} disabled={busy}>Elimina</button>}
          {event && confirmDelete && (
            <>
              <button className="btn danger" onClick={() => remove(false)} disabled={busy}>Conferma eliminazione</button>
              {event.planId && <button className="btn danger" onClick={() => remove(true)} disabled={busy}>Elimina tutto il piano</button>}
            </>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Annulla</button>
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</button>
        </>
      }
    >
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        {event?.linkUrl && <EventLinkButton event={event} onOpen={onClose} />}
        <input
          className="input"
          placeholder="Titolo (es. Lezione master, Palestra…)"
          value={f.title}
          autoFocus
          onChange={(e) => set('title', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          style={{ fontSize: '1.1rem' }}
        />
        <div className="row">
          <label className="switch"><input type="checkbox" checked={f.allDay} onChange={(e) => set('allDay', e.target.checked)} /> Tutto il giorno</label>
          <label className="switch"><input type="checkbox" checked={f.important} onChange={(e) => set('important', e.target.checked)} /> ⚡ Importante (notifica push)</label>
        </div>
        <div className="grid-2">
          <label className="field">Inizio
            <div className="row nowrap">
              <input className="input" type="date" value={f.startDate} onChange={(e) => onStartChange(e.target.value, f.startTime)} />
              {!f.allDay && <input className="input" type="time" value={f.startTime} onChange={(e) => onStartChange(f.startDate, e.target.value)} style={{ maxWidth: 120 }} />}
            </div>
          </label>
          <label className="field">Fine
            <div className="row nowrap">
              <input className="input" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
              {!f.allDay && <input className="input" type="time" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} style={{ maxWidth: 120 }} />}
            </div>
          </label>
        </div>
        <div className="grid-2">
          <label className="field">Calendario
            <select className="input" value={f.calendarId || localCals[0]?.id || ''} onChange={(e) => set('calendarId', e.target.value)}>
              {localCals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Promemoria
            <select className="input" value={f.reminder} onChange={(e) => set('reminder', e.target.value)}>
              {REMINDERS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
        </div>
        <label className="field">Luogo
          <input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Opzionale" />
        </label>
        <div className="grid-2">
          <label className="field">Link
            <input className="input" value={f.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} placeholder="https://… (opzionale)" />
          </label>
          <label className="field">Testo del pulsante
            <input className="input" value={f.linkLabel} onChange={(e) => set('linkLabel', e.target.value)} placeholder="Apri" />
          </label>
        </div>
        <label className="field">Note
          <textarea className="input" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Opzionale" />
        </label>
        <div className="faint tiny">
          Promemoria “Automatico”: 30 minuti prima per gli eventi importanti, altrimenti quello predefinito del calendario.
        </div>
      </div>
    </Modal>
  );
}
