import webpush from 'web-push';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { httpError, nowIso } from './util.js';

let publicKey = null;

export function initPush() {
  let keys = getSetting('vapid_keys');
  if (keys) {
    keys = JSON.parse(keys);
  } else {
    keys = webpush.generateVAPIDKeys();
    setSetting('vapid_keys', JSON.stringify(keys));
  }
  const subject = config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:calendary@gattucciocloud.it';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;
}

export const vapidPublicKey = () => publicKey;

export function saveSubscription(sub, userAgent) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw httpError(400, 'Sottoscrizione push non valida');
  }
  db.prepare(`INSERT INTO push_subscriptions (endpoint, data, user_agent, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data, user_agent = excluded.user_agent`)
    .run(sub.endpoint, JSON.stringify(sub), String(userAgent || '').slice(0, 300), nowIso());
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint || ''));
}

export function countSubscriptions() {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;
}

const pushService = (endpoint) => {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return '?';
  }
};

/**
 * payload: { title, body, url?, tag?, important? }
 * Returns { sent, failed, errors: [{ service, status, message }] }.
 */
export async function sendToAll(payload) {
  const subs = db.prepare('SELECT endpoint, data FROM push_subscriptions').all();
  const body = JSON.stringify(payload);
  const result = { sent: 0, failed: 0, errors: [] };
  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.data), body, { TTL: 3600, urgency: payload.important ? 'high' : 'normal' });
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      const service = pushService(row.endpoint);
      if (err.statusCode === 404 || err.statusCode === 410) {
        removeSubscription(row.endpoint); // browser unsubscribed or reinstalled
        result.errors.push({ service, status: err.statusCode, message: 'sottoscrizione scaduta, rimossa: riattiva le notifiche su quel dispositivo' });
      } else {
        const message = String(err.body || err.message || err).slice(0, 200);
        console.error(`Invio push fallito (${service}):`, err.statusCode || '', message);
        result.errors.push({ service, status: err.statusCode || null, message });
      }
    }
  }));
  return result;
}
