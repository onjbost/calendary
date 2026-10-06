import { config } from './config.js';
import { travelPeriodAt } from './travel.js';
import { httpError } from './util.js';

// Spoken announcements on the Echo devices through Home Assistant's official "Alexa Devices" integration:
// it creates notify entities per Echo (notify.<echo>_announce, notify.<echo>_speak) used with notify.send_message.
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

/** Speaks `message` on every configured device. Never throws unless `strict` (used by the test button). */
export async function announce(message, { strict = false } = {}) {
  const ha = homeAssistant();
  if (!strict && travelPeriodAt()) return { sent: 0, skipped: 'modalità viaggio' }; // the test button still speaks
  if (!config.announce.services.length || !ha) {
    if (strict) throw httpError(400, "Annunci Alexa non configurati: imposta in alexa_announce_service l'entità notify del tuo Echo (Alexa Devices)");
    return { sent: 0 };
  }
  const text = spokenText(message);
  let sent = 0;
  const errors = [];
  await Promise.all(config.announce.services.map(async (svc) => {
    try {
      const res = await fetch(`${ha.url}/services/notify/send_message`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ entity_id: svc, message: text }),
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
