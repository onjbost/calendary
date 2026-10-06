import { useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, addWeeks, endOfWeek, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import { api, type Task } from '../api';
import { Agenda } from '../components/Agenda';
import { AlertWatcher } from '../components/AlertWatcher';
import { GoalsMini, WeekRoutines } from '../components/GoalWidgets';
import { MatrixBoard, MiniMatrix } from '../components/Matrix';
import { MonthView } from '../components/MonthView';
import { MoveoCard } from '../components/MoveoCard';
import { NotesBoard, NotesMini } from '../components/Notes';
import { PillsBoard, PillsToday } from '../components/Pills';
import { MoveoBoard } from '../components/MoveoBoard';
import { TimeGrid } from '../components/TimeGrid';
import { TipCard } from '../components/TipCard';
import { capitalize, countdown, eventsOnDay, fmt, hm, monthGrid, parseYmd, weekDays, WEEK, ymd } from '../dates';
import { useEvents, useGoals, useNow, useSwipe, useTasks } from '../hooks';
import { notifyChanged } from '../live';
import { hideStatusBar, keepAwake } from '../native';
import { NightStand } from '../components/NightStand';
import { inWindow, useBattery, useEcoFlag, useLandscape, usePrefs } from '../device';
import { clearLampOverride, useLampMode } from '../lamp-mode';
import { Link } from '../router';
import { tipOfTheDay } from '../tips';
import { useUI } from '../ui';

type Tab = 'today' | 'pills' | 'moveo' | 'day' | 'week' | 'month' | 'matrix' | 'goals' | 'notes';
type CalView = 'day' | 'week' | 'month';
const isCal = (t: Tab): t is CalView => t === 'day' || t === 'week' || t === 'month';

// Main menu; "Calendario" opens the last calendar view (Giorno / Settimana / Mese is chosen inside it).
const MENU: { id: Tab | 'calendar'; label: string }[] = [
  { id: 'today', label: 'Dashboard' },
  { id: 'pills', label: 'Pillole' },
  { id: 'moveo', label: 'Moveo' },
  { id: 'calendar', label: 'Calendario' },
  { id: 'matrix', label: 'Matrice' },
  { id: 'goals', label: 'Obiettivi' },
  { id: 'notes', label: 'Note' },
];
const CAL_VIEWS: { id: CalView; label: string }[] = [
  { id: 'day', label: 'Giorno' },
  { id: 'week', label: 'Settimana' },
  { id: 'month', label: 'Mese' },
];

const IDLE_RESET_MS = 2 * 60_000;
const TIP_ROTATE_MS = 45_000;

function isNight(d: Date) {
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= 23 * 60 || m < 6 * 60 + 30;
}

/** Visible range of a calendar tab around the focused day. */
function tabRange(tab: Tab, focus: Date) {
  if (tab === 'month') {
    const g = monthGrid(focus);
    return { from: g[0], to: addDays(g[g.length - 1], 1) };
  }
  if (tab === 'week') return { from: startOfWeek(focus, WEEK), to: addDays(endOfWeek(focus, WEEK), 1) };
  return { from: startOfDay(focus), to: addDays(startOfDay(focus), 1) };
}

export function KioskPage() {
  const { openEvent, newEvent, startFive } = useUI();
  const eco = useEcoFlag();
  const now = useNow(eco ? 15_000 : 1000);
  const [prefs] = usePrefs();
  const battery = useBattery();
  const landscape = useLandscape();
  const [tab, setTabState] = useState<Tab>('today');
  const [calView, setCalView] = useState<CalView>('day');
  const setTab = (t: Tab) => {
    if (isCal(t)) setCalView(t);
    setTabState(t);
  };
  const [focusKey, setFocusKey] = useState(() => ymd(new Date()));
  const [lastTouch, setLastTouch] = useState(Date.now());
  const dayKey = ymd(now);

  // One fetch covering both the "today" dashboard (next ~8 days) and the calendar tab being browsed.
  const range = useMemo(() => {
    const today = parseYmd(dayKey);
    const view = tabRange(tab, parseYmd(focusKey));
    const from = view.from < today ? view.from : today;
    const soon = addDays(today, 9);
    return { from, to: view.to > soon ? view.to : soon };
  }, [dayKey, focusKey, tab]);
  const { data: events } = useEvents(range.from, range.to);
  const { data: taskData, setData: setTaskData } = useTasks(dayKey);
  const { data: goals } = useGoals();

  useEffect(() => {
    hideStatusBar();
    // touches inside the night stand (swiping between its pages) don't count: only a tap closes it
    const touch = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.nightstand')) setLastTouch(Date.now()); };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, []);

  // Screen always on, except in power saving away from the charger (if allowed): then Android's own timeout applies.
  const letSleep = eco && prefs.ecoSleep && battery.charging === false;
  useEffect(() => {
    keepAwake(!letSleep);
    const onVisible = () => document.visibilityState === 'visible' && keepAwake(!letSleep);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      keepAwake(false);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [letSleep]);

  // Night stand: by hand (🌙), or by itself after some idle time on charge + landscape / during the night hours.
  const idle = now.getTime() - lastTouch >= prefs.nightIdleSec * 1000;
  const autoNight = prefs.nightAuto === 'charging' ? battery.charging === true && landscape
    : prefs.nightAuto === 'hours' ? inWindow(now, prefs.redFrom, prefs.redTo) : false;
  const lamp = useLampMode(autoNight && idle && !document.querySelector('.modal-back, .note-view'));
  const night = lamp.mode === 'night';
  // a tap on the night page: back to the automatic behaviour, the idle time starts again
  const exitNight = () => { clearLampOverride(); setLastTouch(Date.now()); };

  // Back to "Today" after a couple of idle minutes, unless an editor is open.
  useEffect(() => {
    if (now.getTime() - lastTouch < IDLE_RESET_MS) return;
    if (document.querySelector('.modal-back, .note-view')) return; // an editor or an open note
    if (document.activeElement?.matches('textarea, input')) return; // still writing a note
    if (tab !== 'today') setTab('today');
    if (focusKey !== dayKey) setFocusKey(dayKey);
  }, [now, lastTouch, tab, focusKey, dayKey]);

  const today = parseYmd(dayKey);
  const focus = parseYmd(focusKey);
  const todayEvents = eventsOnDay(events, today).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  const next = events.find((e) => !e.allDay && Date.parse(e.start) > now.getTime());
  const upcomingImportant = events
    .filter((e) => e.important && Date.parse(e.start) >= addDays(today, 1).getTime() && Date.parse(e.start) < addDays(today, 9).getTime())
    .slice(0, 4);
  const tipShift = Math.floor(now.getTime() / TIP_ROTATE_MS);
  const tip = tipOfTheDay(now, tipShift);
  const dim = isNight(now) && now.getTime() - lastTouch > 5 * 60_000;

  const toggleTask = async (t: Task) => {
    setTaskData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }));
    await api.updateTask(t.id, { done: !t.done }).catch(() => {});
    notifyChanged('tasks');
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const openDay = (d: Date) => {
    setFocusKey(ymd(d));
    setTab('day');
  };

  const step = (dir: 1 | -1) => {
    const f = tab === 'month' ? addMonths(focus, dir) : tab === 'week' ? addWeeks(focus, dir) : addDays(focus, dir);
    setFocusKey(ymd(f));
  };
  const swipe = useSwipe(() => step(-1), () => step(1));

  /** New event: at the tapped slot, or 09:00 on the focused day (next hour if it's today). */
  const create = (at?: Date) => {
    let start = at;
    if (!start) {
      const base = tab === 'today' || tab === 'matrix' ? today : focus;
      start = isSameDay(base, now) ? new Date(Math.ceil(now.getTime() / 3600e3) * 3600e3) : new Date(`${ymd(base)}T09:00`);
    }
    newEvent({ start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString() });
  };

  const period =
    tab === 'month'
      ? capitalize(fmt(focus, 'MMMM yyyy'))
      : tab === 'week'
        ? `${fmt(startOfWeek(focus, WEEK), 'd MMM')} – ${fmt(endOfWeek(focus, WEEK), 'd MMM')}`
        : capitalize(fmt(focus, 'EEEE d MMMM'));

  const calendarNav = (
    <div className="kiosk-nav">
      <div className="seg">
        {CAL_VIEWS.map((v) => <button key={v.id} className={tab === v.id ? 'on' : ''} onClick={() => setTab(v.id)}>{v.label}</button>)}
      </div>
      <button className="btn icon" onClick={() => step(-1)} aria-label="Precedente">‹</button>
      <button className="btn sm" onClick={() => setFocusKey(dayKey)}>Oggi</button>
      <button className="btn icon" onClick={() => step(1)} aria-label="Successivo">›</button>
      <div className="period neon-cyan mono">{period}</div>
      <span className="spacer" />
      <span className="faint small hide-narrow">Tocca uno spazio vuoto per aggiungere · scorri per cambiare {tab === 'month' ? 'mese' : tab === 'week' ? 'settimana' : 'giorno'}</span>
    </div>
  );

  return (
    <div className="kiosk">
      <header className="kiosk-top">
        <div className="kiosk-clock neon-cyan">{hm(now)}</div>
        <div className="stack" style={{ gap: 2 }}>
          <div className="kiosk-date neon-violet">{capitalize(fmt(now, 'EEEE'))}</div>
          <div className="kiosk-date muted">{fmt(now, 'd MMMM yyyy')}</div>
        </div>
        <span className="spacer" />
        <div className="seg kiosk-menu">
          {MENU.map((m) => {
            const on = m.id === 'calendar' ? isCal(tab) : tab === m.id;
            return <button key={m.id} className={on ? 'on' : ''} onClick={() => setTab(m.id === 'calendar' ? calView : m.id)}>{m.label}</button>;
          })}
        </div>
        <button className="btn primary" onClick={() => create()}>＋ Evento</button>
        <button className="btn pink" onClick={() => startFive(next?.title)}>⚡ 5 s</button>
        <button className="btn icon" onClick={() => lamp.set('night')} aria-label="Modalità notte" title="Modalità notte">🌙</button>
        <Link to="/" className="btn icon" aria-label="App completa" title="App completa">☰</Link>
        <button className="btn icon" onClick={fullscreen} aria-label="Schermo intero">⛶</button>
      </header>

      {tab === 'today' && (
        <div className="kiosk-body">
          <div className="kiosk-col col-scroll">
            <section className="glass pad glow-pink next-card">
              <div className="muted small mono">PROSSIMO IMPEGNO</div>
              {next ? (
                <div onClick={() => openEvent(next)} style={{ cursor: 'pointer' }}>
                  <div className="countdown neon-pink">tra {countdown(Date.parse(next.start) - now.getTime())}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{next.important ? '⚡ ' : ''}{next.title}</div>
                  <div className="muted">
                    {isSameDay(new Date(next.start), now) ? 'Oggi' : capitalize(fmt(next.start, 'EEEE d'))} · {hm(next.start)} – {hm(next.end)}
                  </div>
                  {next.location && <div className="faint small">📍 {next.location}</div>}
                </div>
              ) : (
                <div className="muted">Nessun impegno in vista ✨</div>
              )}
            </section>
            <PillsToday kiosk className="glow-pink" />
            <MoveoCard kiosk className="glow-cyan" />
            <TipCard key={tip.id} tip={tip} className="glow-amber" />
            <section className="glass pad">
              <div className="card-title" style={{ marginBottom: 8 }}><h3>⚡ Importanti in arrivo</h3></div>
              <Agenda events={upcomingImportant} now={now} onEventClick={openEvent} empty="Nessuno nei prossimi giorni" showDay />
            </section>
          </div>

          <section className="glass pad kiosk-col" style={{ gap: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              <h2>Oggi</h2>
              <span className="chip">{todayEvents.length} eventi</span>
              <button className="btn sm ghost" onClick={() => openDay(today)}>Vista oraria →</button>
            </div>
            <div className="scroll" style={{ flex: 1 }}>
              <Agenda events={todayEvents} now={now} onEventClick={openEvent} empty="Giornata libera ✨ Tocca ＋ Evento per aggiungere qualcosa." />
            </div>
          </section>

          <div className="kiosk-col col-scroll">
            <section className="glass pad">
              <div className="card-title"><h2>Prossimi giorni</h2></div>
              <div className="week-strip">
                {[1, 2, 3, 4, 5, 6].map((i) => {
                  const d = addDays(today, i);
                  const list = eventsOnDay(events, d);
                  return (
                    <div key={i} className="week-day">
                      <div className="wd" onClick={() => openDay(d)} style={{ cursor: 'pointer' }}>{fmt(d, 'EEE d MMM').toUpperCase()} ›</div>
                      {!list.length && <div className="faint tiny">—</div>}
                      {list.slice(0, 3).map((ev) => (
                        <div key={ev.id} className="ev-chip" onClick={() => openEvent(ev)}>
                          <span className="dot" style={{ color: ev.color }} />
                          {!ev.allDay && <span className="h">{hm(ev.start)}</span>}
                          <span className="t">{ev.important ? '⚡ ' : ''}{ev.title}</span>
                        </div>
                      ))}
                      {list.length > 3 && <div className="faint tiny" onClick={() => openDay(d)}>+{list.length - 3} altri</div>}
                    </div>
                  );
                })}
              </div>
            </section>
            <NotesMini onOpen={() => setTab('notes')} />
            <section className="glass pad glow-violet">
              <div className="card-title" style={{ marginBottom: 10 }}>
                <h3>Matrice di oggi</h3>
                <button className="btn sm ghost" onClick={() => setTab('matrix')}>Modifica →</button>
              </div>
              <MiniMatrix tasks={taskData.tasks} onToggle={toggleTask} />
            </section>
          </div>
        </div>
      )}

      {(tab === 'day' || tab === 'week' || tab === 'month') && (
        <div className="kiosk-full" {...swipe}>
          {calendarNav}
          {tab === 'day' && (
            <TimeGrid days={[focus]} events={events} onEventClick={openEvent} onSlotClick={create} hourHeight={60} className="kiosk-full" />
          )}
          {tab === 'week' && (
            <TimeGrid days={weekDays(focus)} events={events} onEventClick={openEvent} onSlotClick={create} onDayClick={openDay}
              hourHeight={46} className="kiosk-full" />
          )}
          {tab === 'month' && (
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <MonthView anchor={focus} events={events} onEventClick={openEvent} onDayClick={openDay} maxPerCell={4} />
            </div>
          )}
        </div>
      )}

      {tab === 'matrix' && (
        <div className="kiosk-full" style={{ overflowY: 'auto' }}>
          <MatrixBoard date={dayKey} tasks={taskData.tasks} setTasks={(fn) => setTaskData((d) => ({ ...d, tasks: fn(d.tasks) }))} />
        </div>
      )}

      {tab === 'pills' && (
        <div className="kiosk-full col-scroll">
          <PillsBoard kiosk />
        </div>
      )}

      {tab === 'moveo' && <MoveoBoard />}

      {tab === 'notes' && (
        <div className="kiosk-full col-scroll">
          <NotesBoard />
        </div>
      )}

      {tab === 'goals' && (
        <div className="kiosk-body kiosk-goals">
          <section className="glass pad glow-cyan scroll">
            <div className="card-title"><h2>Routine della settimana</h2></div>
            <WeekRoutines anchor={now} />
          </section>
          <section className="glass pad scroll">
            <div className="card-title"><h2>Obiettivi</h2></div>
            <GoalsMini goals={goals} />
          </section>
        </div>
      )}

      <AlertWatcher sound />
      <div className="kiosk-dim" style={{ opacity: dim && !night ? 0.6 : 0 }} />
      {night && <NightStand onExit={exitNight} />}
    </div>
  );
}
