import type { CalEvent } from '../api';
import { fmt, hm } from '../dates';

/** Vertical list of events, highlighting the one in progress and dimming past ones. */
export function Agenda({ events, now, onEventClick, empty = 'Niente in programma', showDay = false }: {
  events: CalEvent[];
  now: Date;
  onEventClick: (ev: CalEvent) => void;
  empty?: string;
  /** prefix the time with the weekday, for lists spanning several days */
  showDay?: boolean;
}) {
  if (!events.length) return <div className="empty">{empty}</div>;
  const t = now.getTime();
  return (
    <div className="stack" style={{ gap: 4 }}>
      {events.map((ev) => {
        const s = Date.parse(ev.start);
        const e = Date.parse(ev.end);
        const state = ev.allDay ? '' : e < t ? 'past' : s <= t ? 'now' : '';
        return (
          <div key={ev.id} className={`agenda-item ${state} ${ev.done ? 'is-done' : ''}`} onClick={() => onEventClick(ev)}>
            <div className="bar" style={{ color: ev.color }} />
            <div className="when">
              {showDay && <>{fmt(ev.start, 'EEE d').toUpperCase()}<br /></>}
              {ev.allDay ? 'GIORNO' : <>{hm(ev.start)}{!showDay && <><br /><span className="faint">{hm(ev.end)}</span></>}</>}
            </div>
            <div className="grow">
              <div className="title">{ev.important && <span className="neon-amber">⚡ </span>}{ev.source === 'routine' && <span className="neon-cyan">{ev.done ? '✓ ' : '↻ '}</span>}{ev.title}</div>
              <div className="faint tiny">{ev.calendarName}{ev.location ? ` · ${ev.location}` : ''}</div>
            </div>
            {ev.linkUrl && (
              <a className="btn sm primary" href={ev.linkUrl} target="_blank" rel="noopener" title={ev.linkLabel || 'Apri'}
                onClick={(e) => e.stopPropagation()} style={{ alignSelf: 'center', textDecoration: 'none' }}>▶</a>
            )}
            {state === 'now' && <span className="chip neon-pink" style={{ alignSelf: 'center' }}>ORA</span>}
          </div>
        );
      })}
    </div>
  );
}
