import { useEffect, useMemo, useState } from 'react';
import { addDays, isSameDay, isSameMonth, startOfDay } from 'date-fns';
import { api, type CalEvent, type Weather } from '../api';
import { nextAlarm } from '../alarm';
import { capitalize, countdown, eventsOnDay, fmt, hm, monthGrid } from '../dates';
import { inWindow, isEco, setBrightness, useBattery, usePrefs } from '../device';
import { useEvents, useNow, useSwipe } from '../hooks';
import { keepAwake } from '../native';
import { useMoveo } from '../suite';
import { Lamp } from './Lamp';

type Page = 'widgets' | 'clock' | 'agenda';
const PAGES: Page[] = ['widgets', 'clock', 'agenda'];
const PAGE_KEY = 'calendary:night-page';

// Home Assistant weather conditions → icon + label
const WEATHER: Record<string, [string, string]> = {
  'clear-night': ['🌙', 'Sereno'], sunny: ['☀️', 'Sole'], partlycloudy: ['⛅', 'Poco nuvoloso'], cloudy: ['☁️', 'Nuvoloso'],
  fog: ['🌫️', 'Nebbia'], rainy: ['🌧️', 'Pioggia'], pouring: ['🌧️', 'Rovesci'], lightning: ['🌩️', 'Temporale'],
  'lightning-rainy': ['⛈️', 'Temporale'], snowy: ['🌨️', 'Neve'], 'snowy-rainy': ['🌨️', 'Nevischio'], hail: ['🌨️', 'Grandine'],
  windy: ['💨', 'Vento'], 'windy-variant': ['💨', 'Vento'], exceptional: ['⚠️', 'Allerta'],
};
const wIcon = (c?: string) => WEATHER[c || '']?.[0] || '🌡️';
const wLabel = (c?: string) => WEATHER[c || '']?.[1] || c || '';

function useWeather() {
  const [w, setW] = useState<Weather | null>(null);
  useEffect(() => {
    const load = () => api.weather().then(setW).catch(() => {});
    load();
    const id = window.setInterval(load, 15 * 60_000);
    return () => window.clearInterval(id);
  }, []);
  return w;
}

function Clock({ now, size }: { now: Date; size: 'xl' | 'xxl' }) {
  return (
    <div className={`ns-clock ${size}`} aria-label={`Sono le ${hm(now)}`}>
      <span>{fmt(now, 'HH')}</span><span className="ns-colon">:</span><span>{fmt(now, 'mm')}</span>
    </div>
  );
}

function WeatherWidget({ w }: { w: Weather | null }) {
  if (!w?.enabled || w.error || w.temperature == null) return null;
  return (
    <div className="ns-widget">
      <div className="ns-w-now">
        <span className="ns-w-ico">{wIcon(w.condition)}</span>
        <span className="ns-w-temp">{Math.round(w.temperature)}°</span>
        <span className="ns-label">{wLabel(w.condition)}</span>
      </div>
      {!!w.daily?.length && (
        <div className="ns-w-days">
          {w.daily.slice(1, 4).map((d) => (
            <div key={d.date}>
              <span className="ns-label">{capitalize(fmt(d.date, 'EEE'))}</span>
              <span>{wIcon(d.condition)}</span>
              <span>{d.high != null ? `${Math.round(d.high)}°` : ''}{d.low != null ? <span className="ns-dim"> {Math.round(d.low)}°</span> : null}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NextEvent({ events, now }: { events: CalEvent[]; now: Date }) {
  const next = events.find((e) => !e.allDay && Date.parse(e.end) > now.getTime());
  return (
    <div className="ns-widget">
      <div className="ns-label">Prossimo impegno</div>
      {next ? (
        <>
          <div className="ns-big-line">{next.important ? '⚡ ' : ''}{next.title}</div>
          <div className="ns-dim">
            {isSameDay(new Date(next.start), now) ? 'Oggi' : capitalize(fmt(next.start, 'EEEE'))} {hm(next.start)}
            {Date.parse(next.start) > now.getTime() ? ` · tra ${countdown(Date.parse(next.start) - now.getTime())}` : ' · in corso'}
          </div>
        </>
      ) : <div className="ns-dim">Niente in programma</div>}
    </div>
  );
}

/** The next bedside alarm if there is one, otherwise the next event. */
function AlarmOrEvent({ alarm, events, now }: { alarm: Date | null; events: CalEvent[]; now: Date }) {
  if (!alarm) return <NextEvent events={events} now={now} />;
  return (
    <div className="ns-widget">
      <div className="ns-label">Prossima sveglia</div>
      <div className="ns-big-line">⏰ {hm(alarm)}</div>
      <div className="ns-dim">
        {isSameDay(alarm, now) ? 'Oggi' : isSameDay(alarm, addDays(now, 1)) ? 'Domani' : capitalize(fmt(alarm, 'EEEE'))} · tra {countdown(alarm.getTime() - now.getTime())}
      </div>
    </div>
  );
}

function TrainingWidget() {
  const m = useMoveo();
  const s = m?.enabled ? m.session || m.next : null;
  if (!s) return null;
  return (
    <div className="ns-widget">
      <div className="ns-label">Allenamento</div>
      <div className="ns-big-line">🏃 {s.title}</div>
      <div className="ns-dim">{s.date === fmt(new Date(), 'yyyy-MM-dd') ? 'Oggi' : capitalize(fmt(`${s.date}T12:00`, 'EEEE'))} alle {s.time} · {s.durationMin} min</div>
    </div>
  );
}

function MiniMonth({ now }: { now: Date }) {
  const days = monthGrid(now);
  return (
    <div className="ns-month">
      <div className="ns-label" style={{ marginBottom: 8 }}>{capitalize(fmt(now, 'MMMM'))}</div>
      <div className="ns-month-grid">
        {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <span key={i} className="ns-dim">{d}</span>)}
        {days.map((d) => (
          <span key={d.toISOString()} className={`${isSameDay(d, now) ? 'today' : ''} ${isSameMonth(d, now) ? '' : 'out'}`}>{fmt(d, 'd')}</span>
        ))}
      </div>
    </div>
  );
}

function DayList({ title, events, now }: { title: string; events: CalEvent[]; now: Date }) {
  const list = events.filter((e) => e.allDay || Date.parse(e.end) > now.getTime()).slice(0, 6);
  return (
    <div className="ns-widget">
      <div className="ns-label">{title}</div>
      {list.length ? list.map((e) => (
        <div key={`${e.id}-${e.start}`} className="ns-row">
          <span className="ns-dot" style={{ color: e.color }} />
          <span className="ns-dim mono">{e.allDay ? 'tutto il giorno' : hm(e.start)}</span>
          <span className="ns-ellipsis">{e.important ? '⚡ ' : ''}{e.title}</span>
        </div>
      )) : <div className="ns-dim">Libero ✨</div>}
    </div>
  );
}

/**
 * Night stand ("modalità notte"), inspired by iPhone StandBy: a landscape clock with a few widgets,
 * red and dim at night, slowly shifting to avoid burn-in. Swipe to change page, tap to go back.
 */
export function NightStand({ onExit, onWake = onExit }: { onExit: () => void; /** tap on the lamp: back to Normal */ onWake?: () => void }) {
  const now = useNow(isEco() ? 30_000 : 1000);
  const [prefs] = usePrefs();
  const battery = useBattery();
  const weather = useWeather();
  const [page, setPage] = useState<Page>(() => (localStorage.getItem(PAGE_KEY) as Page) || 'widgets');
  const dayKey = fmt(now, 'yyyy-MM-dd');
  const range = useMemo(() => {
    const d = startOfDay(new Date(`${dayKey}T12:00`));
    return { from: d, to: addDays(d, 2) };
  }, [dayKey]);
  const { data: events } = useEvents(range.from, range.to);
  const sorted = useMemo(() => [...events].sort((a, b) => a.start.localeCompare(b.start)), [events]);
  const red = inWindow(now, prefs.redFrom, prefs.redTo);
  const alarm = nextAlarm(prefs, now);

  useEffect(() => {
    try { localStorage.setItem(PAGE_KEY, page); } catch { /* ignore */ }
  }, [page]);

  // screen on, brightness down (real brightness only in the Android app with the ScreenBrightness plugin)
  useEffect(() => {
    keepAwake(true);
    return () => { setBrightness(isEco() ? 0.35 : -1); };
  }, []);
  useEffect(() => { setBrightness(red ? 0.02 : 0.15); }, [red]);

  const go = (d: 1 | -1) => setPage((p) => PAGES[(PAGES.indexOf(p) + d + PAGES.length) % PAGES.length]);
  const swipe = useSwipe(() => go(-1), () => go(1));
  // tiny drift every minute so the same pixels aren't lit all night
  const m = now.getHours() * 60 + now.getMinutes();
  const shift = `translate(${((m * 7) % 13) - 6}px, ${((m * 5) % 11) - 5}px)`;
  const today = eventsOnDay(sorted, now);
  const tomorrow = eventsOnDay(sorted, addDays(now, 1));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className={`nightstand ${red ? 'red' : ''}`} onClick={onExit} {...swipe} role="dialog" aria-label="Modalità notte: tocca per uscire">
      <div className="ns-status">
        {alarm && <span>⏰ {hm(alarm)}</span>}
        {battery.level !== null && <span>{battery.charging ? '⚡' : '🔋'} {battery.level}%</span>}
      </div>

      <div className="ns-inner" style={{ transform: shift }}>
        {page === 'widgets' && (
          <div className="ns-split">
            <div className="ns-left">
              <Clock now={now} size="xl" />
              <div className="ns-date">{capitalize(fmt(now, 'EEEE d MMMM'))}</div>
            </div>
            <div className="ns-right">
              <AlarmOrEvent alarm={alarm} events={sorted} now={now} />
              <TrainingWidget />
            </div>
          </div>
        )}
        {page === 'clock' && (
          <div className="ns-center">
            <Clock now={now} size="xxl" />
            <div className="ns-date">{capitalize(fmt(now, 'EEEE d MMMM'))}{weather?.temperature != null ? ` · ${wIcon(weather.condition)} ${Math.round(weather.temperature)}°` : ''}</div>
          </div>
        )}
        {page === 'agenda' && (
          <div className="ns-split">
            <div className="ns-left">
              <MiniMonth now={now} />
              <div className="ns-small-clock">{hm(now)}</div>
            </div>
            <div className="ns-right">
              <WeatherWidget w={weather} />
              <DayList title="Oggi" events={today} now={now} />
              <DayList title="Domani" events={tomorrow} now={new Date(0)} />
            </div>
          </div>
        )}
      </div>

      <div className="ns-lamp" onClick={stop}>
        <Lamp size="large" mode="night" onToggle={onWake} light={false} />
      </div>

      <div className="ns-dots" onClick={stop}>
        {PAGES.map((p) => <button key={p} className={p === page ? 'on' : ''} onClick={() => setPage(p)} aria-label={`Pagina ${p}`} />)}
      </div>
      <div className="ns-hint">Scorri per cambiare vista · tocca per uscire · tocca la lampada per accenderla</div>
    </div>
  );
}
