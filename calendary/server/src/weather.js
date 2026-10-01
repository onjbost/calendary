// Weather for the night-stand widget, read from a Home Assistant weather entity
// (the default install has weather.forecast_home, from Met.no). Cached for 15 minutes.
import { config } from './config.js';

const TTL = 15 * 60_000;
let cache = null;

function ha() {
  const token = process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN || '';
  const base = (process.env.HA_URL || (process.env.SUPERVISOR_TOKEN ? 'http://supervisor/core' : '')).replace(/\/$/, '');
  return token && base ? { token, base } : null;
}

async function call(path, init = {}) {
  const h = ha();
  const res = await fetch(`${h.base}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Home Assistant ${res.status}`);
  return res.json();
}

export async function weather() {
  const entity = config.weatherEntity;
  if (!entity || !ha()) return { enabled: false };
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  try {
    const st = await call(`/states/${encodeURIComponent(entity)}`);
    let daily = [];
    try {
      const r = await call('/services/weather/get_forecasts?return_response', {
        method: 'POST',
        body: JSON.stringify({ entity_id: entity, type: 'daily' }),
      });
      daily = (r?.service_response?.[entity]?.forecast || []).slice(0, 4).map((f) => ({
        date: f.datetime,
        condition: f.condition,
        high: f.temperature ?? null,
        low: f.templow ?? null,
        rain: f.precipitation_probability ?? null,
      }));
    } catch { /* forecast service missing: current conditions only */ }
    const data = {
      enabled: true,
      condition: st.state,
      temperature: st.attributes?.temperature ?? null,
      unit: st.attributes?.temperature_unit || '°C',
      humidity: st.attributes?.humidity ?? null,
      wind: st.attributes?.wind_speed ?? null,
      windUnit: st.attributes?.wind_speed_unit || 'km/h',
      daily,
      updatedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return cache?.data || { enabled: true, error: err.message };
  }
}
