import { api, type CalEvent } from './api';
import { effectiveReminder, hm } from './dates';

// Capacitor injects window.Capacitor when the page runs inside the Android wrapper,
// even with a remote server.url: plugins are reached through the bridge, no bundling needed.
interface CapPlugin {
  [method: string]: (...args: any[]) => Promise<any>;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins: Record<string, CapPlugin | undefined>;
}
declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const plugin = (name: string) => window.Capacitor?.Plugins?.[name];

// ------------------------------------------------------------------ web push

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  if (isNative()) {
    const ln = plugin('LocalNotifications');
    if (!ln) throw new Error('Plugin notifiche non disponibile nell’app');
    const res = await ln.requestPermissions();
    if (res.display !== 'granted') throw new Error('Permesso notifiche negato');
    return;
  }
  if (!pushSupported()) {
    throw new Error('Questo browser non supporta le notifiche push. Su iPhone/iPad aggiungi prima l’app alla schermata Home.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permesso notifiche negato: abilitalo dalle impostazioni del browser');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushStatus();
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush() {
  const sub = await currentPushSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}

// ------------------------------------------------------- native (Capacitor)

/** Keep the tablet screen on while the kiosk view is open. */
export async function keepAwake(on: boolean) {
  const ka = plugin('KeepAwake');
  if (ka) {
    await (on ? ka.keepAwake() : ka.allowSleep()).catch(() => {});
    return;
  }
  // Browser fallback: Screen Wake Lock API.
  if (on && 'wakeLock' in navigator) {
    try {
      wakeLock = await (navigator as any).wakeLock.request('screen');
    } catch {
      /* not allowed right now */
    }
  } else if (!on && wakeLock) {
    await wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
let wakeLock: { release: () => Promise<void> } | null = null;

export async function hideStatusBar() {
  await plugin('StatusBar')?.hide().catch(() => {});
}

export interface NativeNotificationStatus {
  permission: string; // 'granted' | 'denied' | 'prompt' ...
  exactAlarms: string | null; // Android 12+: may be 'denied' → reminders can arrive late
  pending: number; // reminders currently scheduled on this device
}

export async function nativeNotificationStatus(): Promise<NativeNotificationStatus | null> {
  const ln = plugin('LocalNotifications');
  if (!ln || !isNative()) return null;
  const [perm, exact, pending] = await Promise.all([
    ln.checkPermissions().catch(() => ({ display: 'unknown' })),
    ln.checkExactNotificationSetting ? ln.checkExactNotificationSetting().catch(() => null) : Promise.resolve(null),
    ln.getPending().catch(() => ({ notifications: [] })),
  ]);
  const reminders = (pending?.notifications || []).filter((n: { extra?: { calendary?: string } }) => n.extra?.calendary === 'reminder');
  return { permission: perm?.display ?? 'unknown', exactAlarms: exact?.exact_alarm ?? null, pending: reminders.length };
}

/** Opens the Android "Alarms & reminders" setting so reminders fire on time. */
export async function allowExactAlarms() {
  await plugin('LocalNotifications')?.changeExactNotificationSetting?.().catch(() => {});
}

/**
 * Local test notification, shown immediately: no alarm involved, so it works
 * even when Android hasn't granted exact alarms (those can be delayed by minutes).
 */
export async function sendNativeTest() {
  const ln = plugin('LocalNotifications');
  if (!ln) throw new Error('Plugin notifiche non disponibile nell’app');
  await ln.schedule({
    notifications: [{
      id: 1_999_999_999,
      title: '✨ Notifiche attive sul tablet',
      body: 'Riceverai qui i promemoria degli eventi ⚡ importanti.',
      extra: { calendary: 'test' },
    }],
  });
}

/**
 * Shows a notification straight from this browser's service worker, without the push service:
 * if this one appears but the server test doesn't, delivery is the problem, not the OS settings.
 */
export async function browserLocalTest() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('Notifiche non supportate da questo browser');
  if (Notification.permission !== 'granted') throw new Error('Il browser non ha il permesso di mostrare notifiche per questo sito');
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('Service worker non registrato: ricarica la pagina e riprova');
  await reg.showNotification('🔔 Prova del browser', {
    body: 'Se vedi questo messaggio, Windows/Android mostrano le notifiche di Calendary.',
    icon: '/img/icon-192.png',
    tag: `local-test-${Date.now()}`,
  });
}

function hashId(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

/**
 * Web push doesn't exist inside the Android WebView: schedule the reminders of the
 * next days as native local notifications instead (rescheduled on every refresh).
 */
export async function scheduleNativeReminders(events: CalEvent[]) {
  const ln = plugin('LocalNotifications');
  if (!ln || !isNative()) return;
  const now = Date.now();
  const notifications = events
    .filter((e) => !e.allDay)
    .map((e) => ({ e, reminder: effectiveReminder(e) }))
    .filter(({ reminder }) => reminder !== null)
    .map(({ e, reminder }) => ({ e, at: Date.parse(e.start) - (reminder as number) * 60_000 }))
    .filter(({ at }) => at > now + 5_000)
    .slice(0, 60)
    .map(({ e, at }) => ({
      id: hashId(`${e.id}|${e.start}`),
      title: `${e.important ? '⚡' : '⏰'} ${e.title}`,
      body: `${hm(e.start)} – ${hm(e.end)}${e.location ? ' · ' + e.location : ''}${e.important ? ' · 5, 4, 3, 2, 1… vai!' : ''}`,
      schedule: { at: new Date(at), allowWhileIdle: true },
      extra: { calendary: 'reminder' },
    }));
  try {
    // Replace only our reminders (a pending test notification must survive the refresh).
    const pending = await ln.getPending();
    const old = (pending?.notifications || []).filter((n: { extra?: { calendary?: string } }) => n.extra?.calendary !== 'test');
    if (old.length) await ln.cancel({ notifications: old.map((n: { id: number }) => ({ id: n.id })) });
    if (notifications.length) await ln.schedule({ notifications });
  } catch (err) {
    console.warn('Notifiche locali non pianificate', err);
  }
}
