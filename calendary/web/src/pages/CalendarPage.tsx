import { useMemo } from 'react';
import { addDays, addMonths, addWeeks, endOfWeek, startOfDay, startOfWeek } from 'date-fns';
import { MonthView } from '../components/MonthView';
import { TimeGrid } from '../components/TimeGrid';
import { capitalize, fmt, monthGrid, parseYmd, weekDays, WEEK, ymd } from '../dates';
import { isNarrowScreen, useCalendars, useEvents, useLocalStorage, useSwipe } from '../hooks';
import { navigate } from '../router';
import { useUI } from '../ui';

type View = 'month' | 'week' | 'day';

export function CalendarPage({ query }: { query: URLSearchParams }) {
  const { openEvent, newEvent } = useUI();
  const requested = query.get('view') || '';
  const view = (['month', 'week', 'day'].includes(requested) ? requested : isNarrowScreen() ? 'day' : 'week') as View;
  const dateStr = query.get('date') || ymd(new Date());
  const anchor = parseYmd(dateStr);
  const [hidden, setHidden] = useLocalStorage<string[]>('calendary.hiddenCalendars', []);
  const { data: calendars } = useCalendars();

  const range = useMemo(() => {
    const a = parseYmd(dateStr);
    if (view === 'month') {
      const g = monthGrid(a);
      return { from: g[0], to: addDays(g[g.length - 1], 1) };
    }
    if (view === 'week') return { from: startOfWeek(a, WEEK), to: addDays(endOfWeek(a, WEEK), 1) };
    return { from: startOfDay(a), to: addDays(startOfDay(a), 1) };
  }, [view, dateStr]);

  const { data: all, loading } = useEvents(range.from, range.to);
  const events = all.filter((e) => !hidden.includes(e.calendarId));

  const go = (v: View, d: Date) => navigate(`/calendario?view=${v}&date=${ymd(d)}`, { replace: true });
  const step = (dir: 1 | -1) => {
    if (view === 'month') go(view, addMonths(anchor, dir));
    else if (view === 'week') go(view, addWeeks(anchor, dir));
    else go(view, addDays(anchor, dir));
  };
  const swipe = useSwipe(() => step(-1), () => step(1));

  const period =
    view === 'month'
      ? capitalize(fmt(anchor, 'MMMM yyyy'))
      : view === 'week'
        ? `${fmt(startOfWeek(anchor, WEEK), 'd MMM')} – ${fmt(endOfWeek(anchor, WEEK), 'd MMM yyyy')}`
        : capitalize(fmt(anchor, 'EEEE d MMMM yyyy'));

  const slot = (d: Date) => newEvent({ start: d.toISOString(), end: new Date(d.getTime() + 3600e3).toISOString() });

  return (
    <div {...swipe}>
      <div className="cal-toolbar">
        <button className="btn icon" onClick={() => step(-1)} aria-label="Precedente">‹</button>
        <button className="btn sm" onClick={() => go(view, new Date())}>Oggi</button>
        <button className="btn icon" onClick={() => step(1)} aria-label="Successivo">›</button>
        <div className="period neon-cyan">{period}</div>
        {loading && <span className="faint small">…</span>}
        <span className="spacer" />
        <div className="seg">
          {(['month', 'week', 'day'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => go(v, anchor)}>
              {v === 'month' ? 'Mese' : v === 'week' ? 'Settimana' : 'Giorno'}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => newEvent({ start: new Date(`${dateStr}T09:00`).toISOString(), end: new Date(`${dateStr}T10:00`).toISOString() })}>＋ Evento</button>
      </div>

      {(calendars.length > 1 || all.some((e) => e.calendarId === 'goals')) && (
        <div className="row" style={{ marginBottom: 14, gap: 8 }}>
          {[
            ...calendars.filter((c) => c.enabled),
            ...(all.some((e) => e.calendarId === 'goals') ? [{ id: 'goals', name: '◎ Obiettivi', color: 'var(--violet)' }] : []),
          ].map((c) => {
            const off = hidden.includes(c.id);
            return (
              <button key={c.id} className="chip" style={{ cursor: 'pointer', opacity: off ? 0.4 : 1 }}
                onClick={() => setHidden((h) => (off ? h.filter((x) => x !== c.id) : [...h, c.id]))}>
                <span className="dot" style={{ color: c.color }} /> {c.name}
              </button>
            );
          })}
        </div>
      )}

      {view === 'month' && (
        <MonthView anchor={anchor} events={events} onEventClick={openEvent} onDayClick={(d) => go('day', d)} />
      )}
      {view === 'week' && (
        <TimeGrid days={weekDays(anchor)} events={events} onEventClick={openEvent} onSlotClick={slot} onDayClick={(d) => go('day', d)}
          className="cal-grid" hourHeight={50} />
      )}
      {view === 'day' && (
        <TimeGrid days={[anchor]} events={events} onEventClick={openEvent} onSlotClick={slot} hourHeight={64} className="cal-grid" />
      )}
    </div>
  );
}
