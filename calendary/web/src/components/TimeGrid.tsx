import { useEffect, useRef, type MouseEvent } from 'react';
import { isSameDay, startOfDay } from 'date-fns';
import type { CalEvent } from '../api';
import { eventsOnDay, fmt, hm, layoutDay, ymd } from '../dates';
import type { TripDay } from '../trips/api';
import { DayStrips } from '../trips/DayStrips';
import { useNow } from '../hooks';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Week or day view: hours on the left, one column per day, overlapping events side by side. */
export function TimeGrid({ days, events, onSlotClick, onEventClick, onDayClick, hourHeight = 52, scrollToHour = 7, className = '', tripDays }: {
  days: Date[];
  events: CalEvent[];
  onSlotClick?: (date: Date) => void;
  onEventClick: (ev: CalEvent) => void;
  onDayClick?: (day: Date) => void;
  hourHeight?: number;
  scrollToHour?: number;
  className?: string;
  /** day strips of the trips, shown in the day header */
  tripDays?: Map<string, TripDay[]>;
}) {
  const now = useNow(60_000);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const dayKey = days.map((d) => d.toDateString()).join();

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const showsToday = days.some((d) => isSameDay(d, new Date()));
    const hour = showsToday ? Math.max(0, new Date().getHours() - 2) : scrollToHour;
    el.scrollTop = hour * hourHeight;
  }, [dayKey, hourHeight, scrollToHour]); // days is re-created on every render: dayKey is its identity

  const slotClick = (day: Date) => (e: MouseEvent<HTMLDivElement>) => {
    if (!onSlotClick || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - rect.top) / hourHeight) * 60 / 30) * 30;
    const d = startOfDay(day);
    d.setMinutes(minutes);
    onSlotClick(d);
  };

  const allDayByDay = days.map((d) => eventsOnDay(events, d).filter((e) => e.allDay));
  const hasAllDay = allDayByDay.some((l) => l.length);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className={`tgrid glass ${className}`}>
      <div className="tgrid-head" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className={`dh ${isSameDay(d, now) ? 'today' : ''}`} onClick={() => onDayClick?.(d)}>
            <div className="d1">{fmt(d, 'EEE').toUpperCase()}</div>
            <div className="d2">{fmt(d, 'd')}</div>
            <DayStrips days={tripDays?.get(ymd(d))} short={days.length > 1} />
          </div>
        ))}
      </div>

      {hasAllDay && (
        <div className="tgrid-allday" style={{ gridTemplateColumns: cols }}>
          <div className="lbl">giorno</div>
          {allDayByDay.map((list, i) => (
            <div key={i} className="ad">
              {list.map((ev) => (
                <div key={ev.id} className="ev-chip allday" onClick={() => onEventClick(ev)} title={ev.title}
                  style={{ background: `color-mix(in srgb, ${ev.color} 35%, transparent)` }}>
                  <span className="t">{ev.title}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="tgrid-body" ref={bodyRef}>
        <div className="tgrid-cols" style={{ gridTemplateColumns: cols, height: 24 * hourHeight }}>
          <div className="tgrid-hours">
            {HOURS.map((h) => (
              <div key={h} className="hr" style={{ height: hourHeight }}>{h ? `${String(h).padStart(2, '0')}:00` : ''}</div>
            ))}
          </div>
          {days.map((day) => {
            const isToday = isSameDay(day, now);
            const positioned = layoutDay(eventsOnDay(events, day), day);
            return (
              <div key={day.toISOString()} className={`tgrid-col ${isToday ? 'today' : ''}`} onClick={slotClick(day)}>
                {HOURS.map((h) => (
                  <div key={h}>
                    <div className="line" style={{ top: h * hourHeight }} />
                    <div className="line half" style={{ top: h * hourHeight + hourHeight / 2 }} />
                  </div>
                ))}
                {positioned.map(({ ev, startMin, endMin, col, cols: n }) => {
                  const height = Math.max(22, ((endMin - startMin) / 60) * hourHeight - 2);
                  return (
                    <div
                      key={ev.id}
                      className={`tg-ev ${ev.important ? 'important' : ''} ${ev.source === 'routine' ? 'routine' : ''} ${ev.done ? 'is-done' : ''}`}
                      style={{
                        ['--c' as string]: ev.color,
                        top: (startMin / 60) * hourHeight + 1,
                        height,
                        left: `calc(${(col / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      title={`${ev.title}\n${hm(ev.start)} – ${hm(ev.end)}`}
                    >
                      <div className="t">{ev.title}</div>
                      {height > 34 && <div className="h">{hm(ev.start)} – {hm(ev.end)}{ev.location ? ` · ${ev.location}` : ''}</div>}
                    </div>
                  );
                })}
                {isToday && <div className="now-line" style={{ top: (nowMin / 60) * hourHeight }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
