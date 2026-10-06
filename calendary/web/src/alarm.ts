// Bedside alarm of the night mode. It rings from the page itself (tablet on charge with Hubitat open);
// in the Android app a local notification is also scheduled as a backup, in case the app was closed.
import { useEffect, useRef, useState } from 'react';
import { loadPrefs, type DevicePrefs } from './device';
import { isNative } from './native';

let ctx: AudioContext | null = null;

/** Browsers only allow sound after a touch: the first touch on the page unlocks it for the alarm. */
export function unlockAudioOnTouch() {
  const unlock = () => {
    try {
      ctx ||= new AudioContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch { /* no Web Audio */ }
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  return () => window.removeEventListener('pointerdown', unlock);
}

function tone(freq: number, at: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** One phrase of the alarm; `step` grows the volume over the first minutes. */
function phrase(sound: DevicePrefs['alarm']['sound'], step: number) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.05;
  const vol = Math.min(0.5, 0.06 + step * 0.03);
  if (sound === 'classic') {
    for (let i = 0; i < 4; i += 1) tone(880, t + i * 0.22, 0.14, vol, 'square');
  } else {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.28, 1.1, vol)); // soft rising chime
  }
}

const SNOOZE_MIN = 9;
const RING_MAX_MS = 10 * 60_000;
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;

/** Next time the alarm will ring after `from` (null if off or no day selected). */
export function nextAlarm(prefs: DevicePrefs, from = new Date()): Date | null {
  const a = prefs.alarm;
  if (!a.enabled || !a.days.length) return null;
  const [h, m] = a.time.split(':').map(Number);
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d > from && a.days.includes(d.getDay())) return d;
  }
  return null;
}

/**
 * Watches the clock and rings at the alarm time. Returns the ringing state plus stop/snooze.
 * Mounted once by the app, so it works on every page while Hubitat is open.
 */
export function useAlarm() {
  const [ringing, setRinging] = useState(false);
  const snoozeUntil = useRef<number | null>(null);
  const fired = useRef<string>('');
  const startedAt = useRef(0);

  useEffect(() => unlockAudioOnTouch(), []);

  useEffect(() => {
    const check = () => {
      const now = new Date();
      if (snoozeUntil.current && now.getTime() >= snoozeUntil.current) {
        snoozeUntil.current = null;
        setRinging(true);
        return;
      }
      const prefs = loadPrefs();
      const a = prefs.alarm;
      if (!a.enabled || !a.days.includes(now.getDay())) return;
      const [h, m] = a.time.split(':').map(Number);
      if (now.getHours() === h && now.getMinutes() === m && fired.current !== key(now)) {
        fired.current = key(now);
        setRinging(true);
      }
    };
    check();
    const id = window.setInterval(check, 5_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ringing) return;
    startedAt.current = Date.now();
    let step = 0;
    const sound = loadPrefs().alarm.sound;
    const play = () => {
      if (Date.now() - startedAt.current > RING_MAX_MS) { setRinging(false); return; }
      try { ctx ||= new AudioContext(); ctx.resume().catch(() => {}); } catch { /* no audio */ }
      phrase(sound, step);
      step += 1;
      navigator.vibrate?.([300, 200, 300]);
    };
    play();
    const id = window.setInterval(play, sound === 'classic' ? 1500 : 2600);
    return () => window.clearInterval(id);
  }, [ringing]);

  return {
    ringing,
    stop: () => { snoozeUntil.current = null; setRinging(false); },
    snooze: () => { snoozeUntil.current = Date.now() + SNOOZE_MIN * 60_000; setRinging(false); },
    snoozedUntil: snoozeUntil.current,
  };
}

const NATIVE_ID = 1_999_999_100;

/** Android app: keeps one local notification scheduled at the next alarm (backup if the page is closed). */
export async function syncNativeAlarm(prefs: DevicePrefs) {
  const ln = window.Capacitor?.Plugins?.LocalNotifications;
  if (!ln || !isNative()) return;
  await ln.cancel({ notifications: [{ id: NATIVE_ID }] }).catch(() => {});
  const at = nextAlarm(prefs);
  if (!at) return;
  await ln.schedule({
    notifications: [{
      id: NATIVE_ID,
      title: '⏰ Sveglia',
      body: `Sono le ${prefs.alarm.time}. Buongiorno!`,
      schedule: { at, allowWhileIdle: true },
      extra: { calendary: 'alarm' },
    }],
  }).catch(() => {});
}
