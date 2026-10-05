import { config } from './config.js';
import { tripAt } from './travel.js';
import { httpError } from './util.js';

// Spoken announcements on the Echo devices through Home Assistant, typically with the
// Alexa Media Player integration (HACS): service notify.alexa_media_<device>, data.type = announce.
// Inside the add-on the Supervisor gives us a token (homeassistant_api: true in config.yaml).

function homeAssistant() {
  if (process.env.SUPERVISOR_TOKEN) return { url: 'http://supervisor/core/api', token: process.env.SUPERVISOR_TOKEN };
  if (config.announce.haUrl && config.announce.haToken) return { url: `${config.announce.haUrl}/api`, token: config.announce.haToken };
  return null;
}

export const announceStatus = () => ({
  enabled: config.announce.services.length > 0 && !!homeAssistant(),
  services: config.announce.services,
  homeAssistant: !!homeAssistant(),
});

/** Plain text for TTS: no emoji, no line breaks. */
export function spokenText(text) {
  return String(text)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Each configured name is either a notify *entity* (the official "Alexa Devices" integration creates
// notify.<echo>_announce / notify.<echo>_speak, used with notify.send_message) or a legacy *service*
// (Alexa Media Player: notify.alexa_media_<echo> with data.type = announce; tts.*, script.* get just the message).
const entityCache = new Map(); // name -> boolean

async function isEntity(ha, name) {
  if (entityCache.has(name)) return entityCache.get(name);
  let found = false;
  try {
    const res = await fetch(`${ha.url}/states/${name}`, { headers: { authorization: `Bearer ${ha.token}` }, signal: AbortSignal.timeout(5000) });
    found = res.ok;
  } catch { /* unreachable: try it as a service */ }
  entityCache.set(name, found);
  return found;
}

async function target(ha, name, text) {
  const [domain, service] = name.split('.');
  if (domain === 'notify' && await isEntity(ha, name)) {
    return { url: `${ha.url}/services/notify/send_message`, body: { entity_id: name, message: text } };
  }
  const body = domain === 'notify' ? { message: text, data: { type: 'announce' } } : { message: text };
  return { url: `${ha.url}/services/${domain}/${service}`, body };
}

/** Speaks `message` on every configured device. Never throws unless `strict` (used by the test button). */
export async function announce(message, { strict = false } = {}) {
  const ha = homeAssistant();
  if (!strict && tripAt()) return { sent: 0, skipped: 'modalità viaggio' }; // the test button still speaks
  if (!config.announce.services.length || !ha) {
    if (strict) throw httpError(400, 'Annunci Alexa non configurati: imposta alexa_announce_service');
    return { sent: 0 };
  }
  const text = spokenText(message);
  let sent = 0;
  const errors = [];
  await Promise.all(config.announce.services.map(async (svc) => {
    try {
      const { url, body } = await target(ha, svc, text);
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 150)}`);
      sent += 1;
    } catch (err) {
      console.error(`Annuncio Alexa fallito (${svc}):`, err.message);
      errors.push(`${svc}: ${err.message}`);
    }
  }));
  if (strict && errors.length) throw httpError(502, `Home Assistant ha rifiutato l'annuncio: ${errors.join('; ')}`);
  return { sent, errors };
}
