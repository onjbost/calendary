import { nextAlarm } from '../alarm';
import { capitalize, fmt } from '../dates';
import { canSetBrightness, ecoActive, useBattery, usePrefs, type EcoMode, type NightAuto } from '../device';
import { navigate } from '../router';

const DAYS: [number, string][] = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'G'], [5, 'V'], [6, 'S'], [0, 'D']];

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
      {options.map(([v, label]) => <button key={v} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

/** "Questo dispositivo": night stand, bedside alarm and power saving (saved in this browser only). */
export function DeviceSettings() {
  const [prefs, update] = usePrefs();
  const battery = useBattery();
  const eco = ecoActive(prefs, battery);
  const alarmAt = nextAlarm(prefs);
  const setAlarm = (patch: Partial<typeof prefs.alarm>) => update({ alarm: { ...prefs.alarm, ...patch } });

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="muted small">
        Valgono solo per questo dispositivo.
        {battery.supported ? ` Batteria: ${battery.level}%${battery.charging ? ' in carica ⚡' : ''}.` : ' Questo browser non comunica lo stato della batteria: la modalità notte automatica e il risparmio automatico qui non scattano.'}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <h3>🌙 Modalità notte</h3>
        <div className="muted small">Orologio a schermo intero con meteo, prossimo impegno, allenamento e calendario, come StandBy su iPhone. Scorri per cambiare vista, tocca per uscire. Di notte diventa rossa e scurisce lo schermo.</div>
        <label className="field">Si attiva da sola
          <Seg<NightAuto> value={prefs.nightAuto} onChange={(v) => update({ nightAuto: v })}
            options={[['charging', 'In carica e in orizzontale'], ['hours', 'Nelle ore notturne'], ['off', 'Solo a mano (🌙)']]} />
        </label>
        <div className="row">
          <label className="field" style={{ width: 170 }}>Dopo secondi senza tocchi
            <input className="input" type="number" min={5} max={600} value={prefs.nightIdleSec} onChange={(e) => update({ nightIdleSec: Math.max(5, Number(e.target.value) || 30) })} />
          </label>
          <label className="field" style={{ width: 130 }}>Rossa dalle
            <input className="input" type="time" value={prefs.redFrom} onChange={(e) => update({ redFrom: e.target.value || '22:30' })} />
          </label>
          <label className="field" style={{ width: 130 }}>alle
            <input className="input" type="time" value={prefs.redTo} onChange={(e) => update({ redTo: e.target.value || '06:30' })} />
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('/notte')}>🌙 Prova adesso</button>
          <span className="faint small">{canSetBrightness() ? 'Nell’app regola anche la luminosità reale dello schermo.' : 'Nel browser la luminosità dello schermo non si può cambiare: scurisce solo la pagina.'}</span>
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <h3>⏰ Sveglia</h3>
        <div className="row">
          <label className="switch"><input type="checkbox" checked={prefs.alarm.enabled} onChange={(e) => setAlarm({ enabled: e.target.checked })} /> Attiva</label>
          <input className="input" type="time" style={{ width: 130 }} value={prefs.alarm.time} onChange={(e) => setAlarm({ time: e.target.value || '07:00' })} />
          <div className="seg">
            {DAYS.map(([d, l]) => (
              <button key={d} type="button" className={prefs.alarm.days.includes(d) ? 'on' : ''}
                onClick={() => setAlarm({ days: prefs.alarm.days.includes(d) ? prefs.alarm.days.filter((x) => x !== d) : [...prefs.alarm.days, d] })}>{l}</button>
            ))}
          </div>
          <Seg value={prefs.alarm.sound} onChange={(v) => setAlarm({ sound: v })} options={[['soft', 'Dolce'], ['classic', 'Classica']]} />
        </div>
        <div className="faint small">
          {alarmAt ? `Prossima: ${capitalize(fmt(alarmAt, "EEEE 'alle' HH:mm"))}. ` : ''}
          Suona con Calendary aperto (tablet in carica sul comodino), con volume crescente, "Posticipa 9 min" e "Ferma".
          Nell’app Android c’è anche una notifica di riserva, se l’app fosse chiusa. Per sbloccare l’audio, tocca lo schermo almeno una volta dopo aver aperto la pagina.
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <h3>🔋 Risparmio energetico {eco && <span className="chip">attivo</span>}</h3>
        <div className="muted small">Spegne sfocature, bagliori e animazioni dello sfondo, usa il nero pieno, aggiorna l’orologio e i widget meno spesso e abbassa la luminosità (nell’app). Lontano dal caricatore può lasciare che lo schermo si spenga.</div>
        <label className="field">Modalità
          <Seg<EcoMode> value={prefs.eco} onChange={(v) => update({ eco: v })} options={[['auto', 'Automatico'], ['on', 'Sempre'], ['off', 'Mai']]} />
        </label>
        <div className="row">
          {prefs.eco === 'auto' && (
            <label className="field" style={{ width: 210 }}>Si attiva sotto il (%), senza carica
              <input className="input" type="number" min={5} max={90} value={prefs.ecoBelow} onChange={(e) => update({ ecoBelow: Math.min(90, Math.max(5, Number(e.target.value) || 20)) })} />
            </label>
          )}
          <label className="switch"><input type="checkbox" checked={prefs.ecoSleep} onChange={(e) => update({ ecoSleep: e.target.checked })} /> Lascia spegnere lo schermo quando non è in carica</label>
        </div>
      </div>
    </div>
  );
}
