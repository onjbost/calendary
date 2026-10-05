import { useEffect, useState } from 'react';
import { api, type MoveoToday } from './api';
import { isEco } from './device';
import { openInSuiteApp } from './native';

// Calendary ↔ Moveo. Links to Moveo carry a single-use login ticket, so you never type the Moveo password.

let cache: { at: number; data: MoveoToday } | null = null;
const listeners = new Set<(d: MoveoToday) => void>();

async function refresh() {
  try {
    const data = await api.moveoToday();
    cache = { at: Date.now(), data };
    listeners.forEach((l) => l(data));
  } catch { /* offline: keep the last value */ }
}

/** Moveo summary, refreshed every 2 minutes while some component uses it. */
export function useMoveo() {
  const [data, setData] = useState<MoveoToday | null>(cache?.data || null);
  useEffect(() => {
    listeners.add(setData);
    if (!cache || Date.now() - cache.at > 60_000) refresh();
    // every 2 minutes, every 10 in power saving
    const id = window.setInterval(() => { if (!isEco() || !cache || Date.now() - cache.at > 600_000) refresh(); }, 120_000);
    return () => {
      listeners.delete(setData);
      window.clearInterval(id);
    };
  }, []);
  return data;
}

export const moveoPublicUrl = () => cache?.data.publicUrl || null;

/** True for links pointing at Moveo (the ▶ buttons of the events created by Moveo). */
export function isMoveoLink(url?: string | null) {
  const base = moveoPublicUrl();
  return !!url && !!base && (url === base || url.startsWith(`${base}/`));
}

/** Opens a Moveo page (path like /play/…, /pausa, /tablet) already signed in. */
export async function openMoveo(path: string) {
  // Open the tab synchronously (popup blockers), then point it at the signed link.
  const tab = window.Capacitor?.isNativePlatform?.() ? null : window.open('about:blank', '_blank');
  try {
    const { url } = await api.suiteLink(path);
    openInSuiteApp(url, 'moveo', tab);
  } catch {
    const base = moveoPublicUrl();
    if (base) openInSuiteApp(`${base}${path}`, 'moveo', tab);
    else tab?.close();
  }
}

/** Same as openMoveo, starting from a full Moveo URL (e.g. an event's linkUrl). */
export function openMoveoUrl(url: string) {
  const base = moveoPublicUrl() || '';
  return openMoveo(url.slice(base.length) || '/');
}

/** Loads the Moveo summary once at startup, so Moveo links are recognised everywhere. */
export function primeMoveo() {
  if (!cache) refresh();
}
