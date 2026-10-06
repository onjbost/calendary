// Lamp modes on this device: Normal → Power saving → Night, by hand (lamp tap) or automatically.
// The manual choice is kept in this browser and forgotten as soon as the automatic conditions change.
import { useEffect, useState } from 'react';
import { ecoActive, inWindow, useBattery, usePrefs } from './device';
import { autoSignature, nextMode, resolveMode, type LampMode, type LampOverride } from './lamp-logic';

export type { LampMode } from './lamp-logic';

const KEY = 'hubitat:lamp';
const bus = new EventTarget();

function load(): LampOverride | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function save(o: LampOverride | null) {
  try {
    if (o) localStorage.setItem(KEY, JSON.stringify(o));
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable: lasts for this page only */ }
  memory = o;
  bus.dispatchEvent(new Event('change'));
}

let memory: LampOverride | null = load();

/** Back to the automatic behaviour (e.g. leaving the night page with a tap). */
export const clearLampOverride = () => save(null);

/**
 * Current mode and the lamp actions. `nightAuto` is the page's own "night now" rule (the kiosk:
 * on charge or night hours, after the idle time); other pages pass false.
 */
export function useLampMode(nightAuto = false) {
  const [prefs] = usePrefs();
  const battery = useBattery();
  const [override, setOverride] = useState<LampOverride | null>(memory);
  const [now, setNow] = useState(() => new Date());
  // the battery state arrives a moment after the page opens: judge the manual choice only after that
  const [waited, setWaited] = useState(false);
  useEffect(() => { const id = window.setTimeout(() => setWaited(true), 2000); return () => window.clearTimeout(id); }, []);
  const settled = waited || battery.supported;

  useEffect(() => {
    const f = () => setOverride(memory);
    const fromStorage = () => { memory = load(); f(); };
    bus.addEventListener('change', f);
    window.addEventListener('storage', fromStorage);
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      bus.removeEventListener('change', f);
      window.removeEventListener('storage', fromStorage);
      window.clearInterval(id);
    };
  }, []);

  const cond = { ecoAuto: ecoActive(prefs, battery), charging: battery.charging, nightHours: inWindow(now, prefs.redFrom, prefs.redTo) };
  const r = resolveMode({ ...cond, nightAuto, override, settled });

  // a choice made under other conditions is dropped for good
  useEffect(() => { if (override && !r.override) save(null); }, [override, r.override]);

  const set = (mode: LampMode) => save({ mode, sig: autoSignature(cond) });
  return { mode: r.mode, manual: !!r.override, cycle: () => set(nextMode(r.mode)), set };
}
