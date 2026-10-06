import { isSameDay, isSameMonth } from 'date-fns';
import type { CalEvent } from '../api';
import { eventsOnDay, fmt, hm, monthGrid, ymd } from '../dates';
import type { TripDay } from '../trips/api';
import { DayStrips } from '../trips/DayStrips';

const DOW = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];

export function MonthView({ anchor, events, onDayClick, onEventClick, maxPerCell = 3, tripDays }: {
  anchor: Date;
  events: CalEvent[];
  onDayClick: (day: Date) => void;
  onEventClick: (ev: CalEvent) => void;
  maxPerCell?: number;
  /** day strips of the trips (not events: they don't count in maxPerCell) */
  tripDays?: Map<string, TripDay[]>;
}) {
  const days = monthGrid(anchor);
  const today = new Date();

  return (
    <div className="month glass">
      {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
      {days.map((day) => {
        const list = eventsOnDay(events, day).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
        const shown = list.slice(0, maxPerCell);
        const extra = list.length - shown.length;
        return (
          <div
            key={day.toISOString()}
            className={`cell ${isSameMonth(day, anchor) ? '' : 'out'} ${isSameDay(day, today) ? 'today' : ''}`}
            onClick={() => onDayClick(day)}
            title={fmt(day, 'EEEE d MMMM')}
          >
            <div className="num">{fmt(day, 'd')}</div>
            <DayStrips days={tripDays?.get(ymd(day))} />
            {shown.map((ev) => (
              <div
                key={ev.id}
                className={`ev-chip ${ev.allDay ? 'allday' : ''} ${ev.done ? 'is-done' : ''}`}
                style={ev.allDay ? { background: `color-mix(in srgb, ${ev.color} 35%, transparent)`, boxShadow: `0 0 10px color-mix(in srgb, ${ev.color} 40%, transparent)` } : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick(ev);
                }}
                title={ev.title}
              >
                <span className="dot" style={{ color: ev.color }} />
                {!ev.allDay && <span className="h">{hm(ev.start)}</span>}
                <span className="t">{ev.important ? '⚡ ' : ''}{ev.title}</span>
              </div>
            ))}
            {extra > 0 && <div className="more">+{extra} altri</div>}
          </div>
        );
      })}
    </div>
  );
}
