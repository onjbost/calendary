// Per-device behaviour of the tablet/phone: night mode (StandBy-style clock when charging in landscape),
// power saving, the bedside alarm and the screen brightness. Saved in this browser only (localStorage).
import { useEffect, useState } from 'react';
import { isNative } from './native';

export type NightAuto = 'charging' | 'hours' | 'off';
export type EcoMode = 'auto' | 'on' | 'off';

export interface DevicePrefs {
  /** When the night stand opens by itself: on charge + landscape, during the night hours, or only by hand. */
  nightAuto: NightAuto;
  /** Seconds without touches before it opens (it never covers you while you're using the screen). */
  nightIdleSec: number;
  /** Red, dimmed clock between these hours (like StandBy at night). */
  redFrom: string;
  redTo: string;
  /** Power saving: 'auto' turns on below `ecoBelow` % when not charging. */
  eco: EcoMode;
  ecoBelow: number;
  /** In power saving, let the screen turn off by itself when not charging. */
  ecoSleep: boolean;
  alarm: { enabled: boolean; time: string; days: number[]; sound: 'soft' | 'classic' };
}

export const DEFAULT_PREFS: DevicePrefs = {
  nightAuto: 'charging',
  nightIdleSec: 30,
  redFrom: '22:30',
  redTo: '06:30',
  eco: 'auto',
  ecoBelow: 20,
  ecoSleep: true,
  alarm: { enabled: false, time: '07:00', days: [1, 2, 3, 4, 5], sound: 'soft' },
};

const KEY = 'calendary:device';
const bus = new EventTarget();

export function loadPrefs(): DevicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_PREFS, ...raw, alarm: { ...DEFAULT_PREFS.alarm, ...(raw.alarm || {}) } };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: DevicePrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
  bus.dispatchEvent(new Event('change'));
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    const on = () => setPrefs(loadPrefs());
    bus.addEventListener('change', on);
    window.addEventListener('storage', on);
    return () => { bus.removeEventListener('change', on); window.removeEventListener('storage', on); };
  }, []);
  const update = (patch: Partial<DevicePrefs>) => savePrefs({ ...loadPrefs(), ...patch });
  return [prefs, update] as const;
}

// ------------------------------------------------------------------- battery

export interface BatteryState { supported: boolean; level: number | null; charging: boolean | null }

type BatteryManager = EventTarget & { level: number; charging: boolean };
const plugin = (name: string) => window.Capacitor?.Plugins?.[name];

/**
 * Battery level and charging state: the Battery Status API (Chrome, Android WebView), or the Capacitor
 * Device plugin when the app has it. Unknown elsewhere (Safari, Firefox).
 */
export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({ supported: false, level: null, charging: null });
  useEffect(() => {
    let cancelled = false;
    let bm: BatteryManager | null = null;
    let timer = 0;
    const fromBm = () => bm && !cancelled && setState({ supported: true, level: Math.round(bm.level * 100), charging: bm.charging });
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    const device = plugin('Device');
    if (nav.getBattery) {
      nav.getBattery().then((b) => {
        bm = b;
        fromBm();
        b.addEventListener('levelchange', fromBm);
        b.addEventListener('chargingchange', fromBm);
      }).catch(() => {});
    } else if (device && isNative()) {
      const poll = () => device.getBatteryInfo().then((r: { batteryLevel?: number; isCharging?: boolean }) => {
        if (!cancelled) setState({ supported: true, level: r.batteryLevel != null ? Math.round(r.batteryLevel * 100) : null, charging: r.isCharging ?? null });
      }).catch(() => {});
      poll();
      timer = window.setInterval(poll, 60_000);
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      bm?.removeEventListener('levelchange', fromBm);
      bm?.removeEventListener('chargingchange', fromBm);
    };
  }, []);
  return state;
}

export function useLandscape() {
  const q = () => window.matchMedia('(orientation: landscape)').matches;
  const [landscape, setLandscape] = useState(q);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const on = () => setLandscape(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return landscape;
}

/** Minutes since midnight of "HH:MM". */
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** True if `d` falls in [from, to), wrapping around midnight. */
export function inWindow(d: Date, from: string, to: string) {
  const m = d.getHours() * 60 + d.getMinutes();
  const a = minutesOf(from);
  const b = minutesOf(to);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

// ---------------------------------------------------------------- power saving

/** Is power saving on right now (manual, or automatic on low battery)? */
export function ecoActive(prefs: DevicePrefs, battery: BatteryState) {
  if (prefs.eco === 'on') return true;
  if (prefs.eco === 'off') return false;
  return battery.level !== null && battery.charging === false && battery.level <= prefs.ecoBelow;
}

/**
 * Applies power saving to the whole page: `html.eco` switches off blurs, glows and animations
 * (see styles.css), and the slower refresh rates read `isEco()`.
 */
export function useEcoMode() {
  const [prefs] = usePrefs();
  const battery = useBattery();
  const on = ecoActive(prefs, battery);
  useEffect(() => {
    document.documentElement.classList.toggle('eco', on);
    ecoFlag = on;
    bus.dispatchEvent(new Event('eco'));
  }, [on]);
  return { eco: on, battery, prefs };
}

let ecoFlag = false;
export const isEco = () => ecoFlag;

/** Re-renders when power saving switches on/off. */
export function useEcoFlag() {
  const [on, setOn] = useState(ecoFlag);
  useEffect(() => {
    const f = () => setOn(ecoFlag);
    bus.addEventListener('eco', f);
    return () => bus.removeEventListener('eco', f);
  }, []);
  return on;
}

// ---------------------------------------------------------------- brightness

/**
 * Real screen brightness through the ScreenBrightness plugin of the Android app (0–1, -1 = system setting).
 * In a browser there's no way to change it: night mode then darkens the page instead.
 */
export async function setBrightness(value: number) {
  const sb = plugin('ScreenBrightness');
  if (!sb || !isNative()) return false;
  await sb.setBrightness({ brightness: value }).catch(() => {});
  return true;
}
export const canSetBrightness = () => !!plugin('ScreenBrightness') && isNative();
