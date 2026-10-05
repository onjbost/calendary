import { useEffect, useState } from 'react';
import { DeviceSettings } from '../components/DeviceSettings';
import { api, type AlexaStatus, type Calendar } from '../api';
import { fmt } from '../dates';
import { useCalendars } from '../hooks';
import { notifyChanged } from '../live';
import {
  allowExactAlarms, browserLocalTest, currentPushSubscription, disablePush, enablePush, isNative, nativeNotificationStatus, pushSupported, sendNativeTest,
  type NativeNotificationStatus,
} from '../native';
import { currentTheme, setTheme, THEMES, type ThemeId } from '../theme';
import { useUI } from '../ui';

const PALETTE = ['#00e5ff', '#ff2bd6', '#a66bff', '#9dff3a', '#ffb020', '#ff3d6e', '#3d8bff', '#00d5a0'];

function CalendarRow({ cal }: { cal: Calendar }) {
  const { toast } = useUI();
  const [name, setName] = useState(cal.name);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const update = async (patch: Partial<Calendar>) => {
    try {
      await api.updateCalendar(cal.id, patch);
      notifyChanged('calendars');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.syncCalendar(cal.id);
      notifyChanged('calendars');
      toast(r.error ? `Errore: ${r.error}` : 'Calendario sincronizzato', r.error ? 'error' : 'ok');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteCalendar(cal.id);
      notifyChanged('calendars');
      toast('Calendario rimosso');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="cal-row">
      <input type="color" className="color-input" value={cal.color} onChange={(e) => update({ color: e.target.value })} title="Colore" />
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="row">
          <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== cal.name && update({ name })} style={{ maxWidth: 320 }} />
          <span className="chip">{cal.type === 'local' ? 'Interno' : 'iCal'}</span>
        </div>
        {cal.type === 'ics' && (
          <div className="faint tiny" style={{ overflowWrap: 'anywhere' }}>
            {cal.lastError ? <span style={{ color: '#ff9db5' }}>⚠ {cal.lastError}</span> : cal.lastSync ? `Sincronizzato ${fmt(cal.lastSync, "d MMM 'alle' HH:mm")}` : 'Mai sincronizzato'}
          </div>
        )}
        <div className="row small">
          <label className="switch"><input type="checkbox" checked={cal.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Visibile</label>
          <label className="row nowrap muted">Promemoria predefinito
            <select className="input" style={{ width: 'auto', padding: '5px 10px' }} value={cal.reminderMinutes ?? ''}
              onChange={(e) => update({ reminderMinutes: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Nessuno</option>
              <option value="0">All'inizio</option>
              <option value="10">10 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">1 ora</option>
            </select>
          </label>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {cal.type === 'ics' && <button className="btn sm" onClick={sync} disabled={busy}>{busy ? '…' : '⟳ Sincronizza'}</button>}
        {confirm ? (
          <button className="btn sm danger" onClick={remove}>Conferma</button>
        ) : (
          <button className="btn sm ghost" onClick={() => setConfirm(true)}>Rimuovi</button>
        )}
      </div>
    </div>
  );
}

function AddCalendar() {
  const { toast } = useUI();
  const [type, setType] = useState<'ics' | 'local'>('ics');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState(PALETTE[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createCalendar({ type, name, url: type === 'ics' ? url : null, color });
      notifyChanged('calendars');
      toast(type === 'ics' ? 'Calendario importato' : 'Calendario creato');
      setName('');
      setUrl('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={type === 'ics' ? 'on' : ''} onClick={() => setType('ics')}>Importa iCal</button>
        <button className={type === 'local' ? 'on' : ''} onClick={() => setType('local')}>Nuovo interno</button>
      </div>
      <div className="grid-2">
        <label className="field">Nome
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'ics' ? 'Es. Lavoro, Master, Google' : 'Es. Palestra'} />
        </label>
        <div className="field">
          <span>Colore</span>
          <div className="color-swatches">
            {PALETTE.map((c) => (
              <button key={c} className={color === c ? 'on' : ''} style={{ ['--sw' as string]: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </div>
      </div>
      {type === 'ics' && (
        <label className="field">Indirizzo iCal (.ics)
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… oppure webcal://…" />
        </label>
      )}
      {error && <div className="alert error">{error}</div>}
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={add} disabled={busy || !name.trim() || (type === 'ics' && !url.trim())}>
        {busy ? 'Importazione…' : type === 'ics' ? 'Importa calendario' : 'Crea calendario'}
      </button>
      {type === 'ics' && (
        <details className="help">
          <summary>Dove trovo il link iCal?</summary>
          <ol>
            <li><b>Google Calendar</b>: dal PC apri calendar.google.com → ⚙ Impostazioni → seleziona il calendario a sinistra → “Integra calendario” → copia l’<i>Indirizzo segreto in formato iCal</i>.</li>
            <li><b>Outlook / Microsoft 365</b>: outlook.office.com → ⚙ → Calendario → Calendari condivisi → “Pubblica un calendario” → scegli il calendario e “Può visualizzare tutti i dettagli” → Pubblica → copia il link <i>ICS</i>.</li>
            <li><b>Calendario di lavoro / master</b>: se usano Google o Outlook vale quanto sopra; molte piattaforme (Moodle, Teams, Zoom, portali universitari) hanno un pulsante “Esporta” o “Iscriviti” che fornisce un link .ics.</li>
            <li><b>iCloud</b>: app Calendario → ⓘ accanto al calendario → “Calendario pubblico” → copia il link webcal://.</li>
          </ol>
          <div className="faint tiny" style={{ marginTop: 6 }}>I calendari iCal sono in sola lettura e si aggiornano automaticamente ogni pochi minuti. Il link segreto dà accesso al calendario: non condividerlo.</div>
        </details>
      )}
    </div>
  );
}

/** Android app: Web Push doesn't exist in the WebView, reminders are native local notifications. */
function NativeNotifications() {
  const { toast } = useUI();
  const [st, setSt] = useState<NativeNotificationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setSt(await nativeNotificationStatus());
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const granted = st?.permission === 'granted';
  return (
    <div className="stack">
      <div className="muted small">
        Su questo tablet i promemoria sono <b>notifiche locali</b>: l'app le programma da sola per gli eventi ⚡ importanti dei prossimi 3 giorni,
        e le aggiorna ogni volta che il calendario cambia. Non serve registrare il tablet sul server.
      </div>
      <div className="row small">
        <span className="chip"><span className="dot" style={{ color: granted ? 'var(--lime)' : 'var(--red)' }} /> Permesso: {granted ? 'concesso' : st?.permission === 'denied' ? 'negato' : 'da concedere'}</span>
        <span className="chip">⏰ {st?.pending ?? 0} promemoria programmati</span>
        {st?.exactAlarms && (
          <span className="chip"><span className="dot" style={{ color: st.exactAlarms === 'granted' ? 'var(--lime)' : 'var(--amber)' }} /> Allarmi precisi: {st.exactAlarms === 'granted' ? 'sì' : 'no'}</span>
        )}
      </div>
      {st?.permission === 'denied' && (
        <div className="alert small">Permesso negato: apri <b>Impostazioni Android → App → Calendary → Notifiche</b> e attivale.</div>
      )}
      {st?.exactAlarms && st.exactAlarms !== 'granted' && (
        <div className="alert small">Senza “Allarmi e promemoria” Android può ritardare le notifiche di qualche minuto.</div>
      )}
      <div className="row">
        {!granted && <button className="btn primary" disabled={busy} onClick={() => run(enablePush, 'Notifiche consentite ✨')}>🔔 Consenti notifiche</button>}
        {st?.exactAlarms && st.exactAlarms !== 'granted' && (
          <button className="btn" disabled={busy} onClick={() => run(allowExactAlarms)}>⏰ Consenti allarmi precisi</button>
        )}
        <button className={`btn ${granted ? 'primary' : ''}`} disabled={busy || !granted}
          onClick={() => run(sendNativeTest, 'Notifica di prova inviata: controlla la barra delle notifiche')}>Invia prova su questo tablet</button>
      </div>
    </div>
  );
}

/** Browsers (PC, phone): standard Web Push through the server. */
function WebNotifications() {
  const { toast } = useUI();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [devices, setDevices] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [sub, st] = await Promise.all([currentPushSubscription().catch(() => null), api.pushStatus().catch(() => null)]);
    setSubscribed(!!sub);
    setDevices(st?.subscriptions ?? 0);
  };
  useEffect(() => {
    refresh();
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (subscribed) await disablePush();
      else await enablePush();
      await refresh();
      toast(subscribed ? 'Notifiche disattivate su questo dispositivo' : 'Notifiche attivate ✨');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const [report, setReport] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);

  const test = async () => {
    setReport(null);
    try {
      const r = await api.pushTest();
      await refresh();
      if (!r.sent && !r.failed) {
        setReport({ kind: 'error', text: 'Nessun browser registrato: premi prima “Attiva su questo dispositivo”.' });
      } else if (r.failed) {
        const details = r.errors.map((e) => `${e.service}${e.status ? ` (${e.status})` : ''}: ${e.message}`).join('\n');
        setReport({ kind: 'error', text: `Inviata a ${r.sent}, fallita per ${r.failed}:\n${details}` });
      } else {
        setReport({
          kind: 'ok',
          text: `Il server l’ha consegnata a ${r.sent} browser. Se entro pochi secondi non la vedi, il blocco è sul dispositivo: prova “Prova solo browser” e guarda i suggerimenti qui sotto.`,
        });
      }
    } catch (e) {
      setReport({ kind: 'error', text: (e as Error).message });
    }
  };

  const localTest = async () => {
    setReport(null);
    try {
      await browserLocalTest();
      setReport({ kind: 'info', text: 'Notifica mostrata dal browser senza passare dal server. Se non l’hai vista, il blocco è nelle impostazioni del sistema (vedi sotto).' });
    } catch (e) {
      setReport({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="stack">
      <div className="muted small">
        Ricevi una notifica push quando si avvicina un evento ⚡ importante (30 minuti prima, o il promemoria che imposti), più un riepilogo ogni mattina.
        Attivale su ogni browser in cui le vuoi (PC, telefono).
      </div>
      {!pushSupported() && (
        <div className="alert small">Questo browser non supporta le notifiche push. Su iPhone/iPad aggiungi prima Calendary alla schermata Home (Condividi → Aggiungi a Home).</div>
      )}
      <div className="row">
        {pushSupported() && (
          <button className={`btn ${subscribed ? '' : 'primary'}`} onClick={toggle} disabled={busy || subscribed === null}>
            {subscribed ? 'Disattiva su questo dispositivo' : '🔔 Attiva su questo dispositivo'}
          </button>
        )}
        <button className="btn" onClick={test}>Invia prova</button>
        {subscribed && <button className="btn ghost" onClick={localTest}>Prova solo browser</button>}
        <span className="faint small">{devices} {devices === 1 ? 'browser registrato' : 'browser registrati'} per le push{subscribed ? ' (incluso questo)' : ''}</span>
      </div>
      {report && <div className={`alert small ${report.kind === 'error' ? 'error' : report.kind === 'ok' ? 'ok' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{report.text}</div>}
      <details className="help">
        <summary>Non arriva nessuna notifica?</summary>
        <ol>
          <li><b>Windows</b>: Impostazioni → Sistema → Notifiche → attiva le notifiche e controlla che <i>Chrome</i> / <i>Edge</i> siano abilitati. Disattiva <i>Non disturbare</i>.</li>
          <li><b>Browser</b>: clicca sul lucchetto accanto all’indirizzo → Notifiche → <i>Consenti</i>. In Chrome controlla anche <i>chrome://settings/content/notifications</i>.</li>
          <li>Chrome riceve le push solo se è in esecuzione (anche in background): Impostazioni → Sistema → <i>Continua a eseguire app in background</i>.</li>
          <li><b>Android</b>: Impostazioni → App → Chrome (o Calendary) → Notifiche attive; disattiva l’ottimizzazione batteria se arrivano in ritardo.</li>
          <li>Le notifiche funzionano solo dall’indirizzo <b>https://calendary.gattucciocloud.it</b>, non da 192.168.x.x:8787 (lì il browser le blocca perché non è HTTPS).</li>
        </ol>
      </details>
      <div className="faint tiny">L'app Android del tablet non compare qui: usa notifiche locali, gestite dalla sua pagina Impostazioni.</div>
    </div>
  );
}

function Notifications() {
  return isNative() ? <NativeNotifications /> : <WebNotifications />;
}

const Dot = ({ ok }: { ok: boolean | null }) => (
  <span className="dot" style={{ color: ok === null ? 'var(--amber)' : ok ? 'var(--lime)' : 'var(--red)' }} />
);

/** Theme picker: colors, background and fonts, saved on this device. */
function ThemePicker() {
  const [theme, set] = useState<ThemeId>(currentTheme);
  const pick = (id: ThemeId) => {
    setTheme(id);
    set(id);
  };
  return (
    <div className="stack">
      <div className="muted small">Cambia colori, sfondo e caratteri; la disposizione resta la stessa. La scelta vale per questo dispositivo: il tablet e il PC possono avere temi diversi.</div>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-card ${theme === t.id ? 'on' : ''}`} onClick={() => pick(t.id)}>
            <div className="theme-swatch">{t.swatch.map((c) => <span key={c} style={{ background: c }} />)}</div>
            <b>{t.name}{theme === t.id ? ' ✓' : ''}</b>
            <span className="faint small">{t.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Alexa: the "Calendary" skill (voice → app) and reminders/announcements on the Echo devices (app → voice). */
function AlexaSettings() {
  const { toast } = useUI();
  const [st, setSt] = useState<AlexaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => api.alexaStatus().then(setSt).catch(() => setSt(null));
  useEffect(() => {
    refresh();
  }, []);

  const run = async (fn: () => Promise<{ ok?: boolean; error?: string } | unknown>, ok: string) => {
    setBusy(true);
    try {
      const r = (await fn()) as { ok?: boolean; error?: string };
      if (r && r.ok === false) toast(r.error || 'Operazione non riuscita', 'error');
      else toast(ok);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  if (!st) return <div className="muted small">Caricamento…</div>;
  const granted = st.permission === 'GRANTED';
  const modeLabel = { off: 'disattivati', important: 'eventi con la spunta 🔊 Alexa, pillole e promemoria vocali', all: 'tutti gli eventi con promemoria' }[st.remindersMode];

  return (
    <div className="stack">
      <div className="muted small">
        Con la skill <b>AiCal</b> puoi dire <i>“Alexa, chiedi ad AiCal di ricordarmi di chiamare Marco domani alle 18”</i>,
        <i> “Alexa, chiedi ad AiCal cosa ho domani”</i> o <i>“…aggiungi fare la spesa alla matrice”</i>.
        I promemoria di Calendary suonano sui tuoi Echo e, se colleghi Home Assistant, gli eventi importanti vengono anche annunciati a voce.
      </div>
      <div className="row small">
        <span className="chip"><Dot ok={st.skillConfigured} /> Skill: {st.skillConfigured ? 'configurata' : 'manca alexa_skill_id'}</span>
        <span className="chip"><Dot ok={st.linked ? true : st.skillConfigured ? null : false} /> {st.linked ? `Usata l'ultima volta ${st.lastSeen ? fmt(st.lastSeen, "d MMM 'alle' HH:mm") : ''}` : 'Mai usata: di’ “Alexa, apri AiCal”'}</span>
        {st.remindersMode !== 'off' && (
          <span className="chip"><Dot ok={granted ? true : st.permission ? false : null} /> Permesso promemoria: {granted ? 'concesso' : st.permission ? 'negato' : 'da concedere'}</span>
        )}
        <span className="chip">⏰ {st.scheduled} promemoria su Alexa{st.pending ? ` · ${st.pending} da aggiornare` : ''}</span>
        <span className="chip"><Dot ok={st.announce.enabled ? true : null} /> Annunci: {st.announce.enabled ? st.announce.services.join(', ') : 'non configurati'}</span>
      </div>
      <div className="faint small">Promemoria su Alexa: {modeLabel}.{st.lastSync ? ` Ultima sincronizzazione ${fmt(st.lastSync, 'HH:mm')}.` : ''}</div>
      {st.lastError && <div className="alert error small">Ultimo errore: {st.lastError}</div>}
      {st.remindersMode !== 'off' && st.linked && !st.outOfSession && (
        <div className="alert small">
          Senza <code>alexa_client_id</code> e <code>alexa_client_secret</code> i promemoria arrivano su Alexa solo quando parli con la skill.
          Aggiungili per sincronizzarli in automatico ogni volta che modifichi il calendario.
        </div>
      )}
      <div className="row">
        {st.remindersMode !== 'off' && (
          <button className="btn primary" disabled={busy || !st.linked} onClick={() => run(api.alexaSync, 'Richiesta inviata ad Alexa: i promemoria si aggiornano entro pochi secondi')}>
            ⏰ Sincronizza promemoria
          </button>
        )}
        <button className="btn" disabled={busy || !st.announce.enabled} onClick={() => run(api.alexaAnnounceTest, 'Annuncio inviato: dovresti sentirlo sull’Echo')}>📣 Prova annuncio</button>
      </div>
      <details className="help">
        <summary>Come collegare Alexa</summary>
        <ol>
          <li>Su <b>developer.amazon.com/alexa/console/ask</b> crea una skill <i>Custom</i>, lingua <i>Italiano</i>, hosting <i>Provision your own</i>.</li>
          <li>In <i>Interaction Model → JSON Editor</i> incolla <code>alexa/skill-package/interactionModels/custom/it-IT.json</code> del repository, poi <i>Build Model</i>.</li>
          <li>In <i>Endpoint</i> scegli HTTPS e inserisci <code>{st.endpoint}</code>, certificato: <i>“My development endpoint has a certificate from a trusted certificate authority”</i>.</li>
          <li>Copia lo <b>Skill ID</b> (amzn1.ask.skill…) nell’opzione <code>alexa_skill_id</code> dell’add-on e riavvialo.</li>
          <li>In <i>Permissions</i> attiva <b>Reminders</b>; in fondo alla stessa pagina copia <i>Alexa Client Id</i> e <i>Client Secret</i> in <code>alexa_client_id</code> / <code>alexa_client_secret</code>.</li>
          <li>Nella scheda <i>Test</i> attiva <i>Development</i>, poi nell’app Alexa apri <i>Altro → Skill e giochi → Le tue skill → Sviluppatore → AiCal → Impostazioni</i> e concedi il permesso <b>Promemoria</b>.</li>
          <li>Per gli annunci vocali installa <i>Alexa Media Player</i> (HACS) in Home Assistant e scrivi il servizio in <code>alexa_announce_service</code>, es. <code>notify.alexa_media_echo_cucina</code>.</li>
        </ol>
        <div className="faint tiny">Se usi Cloudflare Access, escludi il percorso <code>/api/alexa</code>: Amazon non può fare il login. La richiesta è comunque protetta dalla firma di Amazon e dallo Skill ID.</div>
      </details>
    </div>
  );
}

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const { data: calendars } = useCalendars();

  return (
    <div>
      <div className="page-head"><h1>Impostazioni</h1></div>
      <div className="dash">
        <section className="glass pad span-7">
          <div className="card-title"><h2>Calendari</h2></div>
          {calendars.map((c) => <CalendarRow key={`${c.id}-${c.name}`} cal={c} />)}
        </section>
        <section className="glass pad span-5 glow-pink">
          <div className="card-title"><h2 className="neon-pink">Aggiungi calendario</h2></div>
          <AddCalendar />
        </section>
        <section className="glass pad span-7">
          <div className="card-title"><h2>Notifiche</h2></div>
          <Notifications />
        </section>
        <section className="glass pad span-5 glow-violet">
          <div className="card-title"><h2 className="neon-violet">Tablet</h2></div>
          <div className="stack small">
            <div className="muted">La vista tablet è una bacheca sempre accesa: orologio, agenda del giorno, settimana, matrice e tips a rotazione. Si aggiorna in tempo reale quando modifichi qualcosa dal PC.</div>
            <div className="row">
              <a className="btn primary" href="/kiosk">Apri vista tablet</a>
              <code className="faint">{location.origin}/kiosk</code>
            </div>
          </div>
        </section>
        <section className="glass pad span-12 glow-cyan">
          <div className="card-title"><h2>Questo dispositivo · notte, sveglia e risparmio</h2></div>
          <DeviceSettings />
        </section>
        <section className="glass pad span-12 glow-violet">
          <div className="card-title"><h2 className="neon-violet">Aspetto</h2></div>
          <ThemePicker />
        </section>
        <section className="glass pad span-12 glow-pink">
          <div className="card-title"><h2 className="neon-pink">Alexa</h2></div>
          <AlexaSettings />
        </section>
        <section className="glass pad span-12">
          <div className="row">
            <div className="muted small grow">Calendary · dati salvati sul tuo Home Assistant</div>
            <button className="btn danger" onClick={async () => { await api.logout(); onLogout(); }}>Esci</button>
          </div>
        </section>
      </div>
    </div>
  );
}
