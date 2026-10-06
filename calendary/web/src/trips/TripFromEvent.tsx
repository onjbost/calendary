import { useState } from 'react';
import { notifyChanged } from '../live';
import { navigate } from '../router';
import { tripsApi } from './api';
import { spansDays } from './logic';

type EventLike = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; planId: string | null; readOnly: boolean };

/** "🧳 Trasforma in viaggio" in the event card: the trip replaces the long event in the calendar. */
export function TripFromEventButton({ event, onDone, deleteEvent }: { event: EventLike; onDone: () => void; deleteEvent: (id: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (event.planId?.startsWith('trip:') || !spansDays(event)) return null;
  const run = async () => {
    setBusy(true);
    try {
      const { trip, eventDeletable } = await tripsApi.fromEvent({ eventId: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location || '' });
      if (eventDeletable && window.confirm("Viaggio creato. Elimino l'evento originale? Nel calendario lo sostituiscono le strisce del viaggio.")) {
        await deleteEvent(event.id);
      } else if (!eventDeletable) {
        window.alert("Viaggio creato. L'evento originale resta: si modifica nel calendario da cui è importato.");
      }
      notifyChanged('events');
      notifyChanged('trips');
      onDone();
      navigate(`/viaggi/${trip.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={run} disabled={busy}>🧳 Trasforma in viaggio</button>
      {error && <div className="alert error">{error}</div>}
    </>
  );
}
