import fs from 'node:fs';
import path from 'node:path';

// In Home Assistant the add-on options live in /data/options.json.
// In local development we fall back to ./data and environment variables.
const dataDir = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.resolve('data'));

let options = {};
const optionsFile = path.join(dataDir, 'options.json');
if (fs.existsSync(optionsFile)) {
  try {
    options = JSON.parse(fs.readFileSync(optionsFile, 'utf8'));
  } catch (err) {
    console.error('Impossibile leggere options.json:', err.message);
  }
}

const pick = (envName, optName, fallback) => {
  const env = process.env[envName];
  if (env !== undefined && env !== '') return env;
  const opt = options[optName];
  if (opt !== undefined && opt !== null && opt !== '') return opt;
  return fallback;
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export const config = {
  dataDir,
  port: Number(pick('PORT', 'port', 8787)),
  password: String(pick('CALENDARY_PASSWORD', 'password', '')),
  noAuth: process.env.CALENDARY_NO_AUTH === '1',
  // Server-to-server access for other add-ons (e.g. Moveo): "Authorization: Bearer <api_token>".
  apiToken: String(pick('CALENDARY_API_TOKEN', 'api_token', '')),
  // MCP server for Claude (notes only): /api/mcp/<mcp_token> or "Authorization: Bearer <mcp_token>". Min. 24 characters.
  mcpToken: String(pick('CALENDARY_MCP_TOKEN', 'mcp_token', '')).trim(),
  // Suite: the training app Moveo (internal address for the API, public one for the links).
  moveo: {
    url: String(pick('MOVEO_URL', 'moveo_url', '')).replace(/\/$/, ''),
    publicUrl: String(pick('MOVEO_PUBLIC_URL', 'moveo_public_url', 'https://moveo.gattucciocloud.it')).replace(/\/$/, ''),
  },
  // Weather widget of the night mode (Home Assistant weather entity, empty = off).
  weatherEntity: String(pick('WEATHER_ENTITY', 'weather_entity', 'weather.forecast_home')).trim(),
  publicUrl: String(pick('PUBLIC_URL', 'public_url', 'https://calendary.gattucciocloud.it')).replace(/\/$/, ''),
  timezone: String(pick('TZ_OVERRIDE', 'timezone', process.env.TZ || 'Europe/Rome')),
  icsSyncMinutes: Math.max(5, Number(pick('ICS_SYNC_MINUTES', 'ics_sync_minutes', 15))),
  morningSummary: String(pick('MORNING_SUMMARY', 'morning_summary', '07:30')),
  ai: {
    baseUrl: String(pick('AI_BASE_URL', 'ai_base_url', 'https://generativelanguage.googleapis.com/v1beta/openai')).replace(/\/$/, ''),
    apiKey: String(pick('AI_API_KEY', 'ai_api_key', '')),
    model: String(pick('AI_MODEL', 'ai_model', 'gemini-2.5-flash')),
    // Tried in order when the main model is overloaded / rate-limited (comma separated).
    fallbackModels: String(pick('AI_FALLBACK_MODELS', 'ai_fallback_models', 'gemini-2.5-flash-lite'))
      .split(',').map((s) => s.trim()).filter(Boolean),
  },
  alexa: {
    // Custom skill "Calendary": its id comes from the Alexa developer console.
    skillId: String(pick('ALEXA_SKILL_ID', 'alexa_skill_id', '')).trim(),
    // Skill Messaging credentials (console → Permissions): let the server push reminders to Alexa on its own.
    clientId: String(pick('ALEXA_CLIENT_ID', 'alexa_client_id', '')).trim(),
    clientSecret: String(pick('ALEXA_CLIENT_SECRET', 'alexa_client_secret', '')).trim(),
    // Which events ring on the Echo devices as Alexa reminders: off | important | all
    reminders: oneOf(pick('ALEXA_REMINDERS', 'alexa_reminders', 'important'), ['off', 'important', 'all'], 'important'),
    // Development only: accept requests without Amazon's signature (curl tests).
    skipVerify: process.env.ALEXA_SKIP_VERIFY === '1',
  },
  announce: {
    // "Alexa Devices" notify entities that speak on the Echo, e.g. notify.echo_dot_announce (comma separated)
    services: String(pick('ALEXA_ANNOUNCE_SERVICE', 'alexa_announce_service', ''))
      .split(',').map((s) => s.trim()).filter((s) => /^notify\.[a-z0-9_]+$/.test(s)),
    // Outside the add-on (plain Docker / PC) Home Assistant is reached with a long-lived token.
    haUrl: String(pick('HA_URL', 'ha_url', '')).replace(/\/$/, ''),
    haToken: String(pick('HA_TOKEN', 'ha_token', '')),
  },
};

// Every date computation on the server (planner windows, all-day events) uses local time.
process.env.TZ = config.timezone;
