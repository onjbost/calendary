import { useEffect } from 'react';
import { syncNativeAlarm, useAlarm } from '../alarm';
import { hm } from '../dates';
import { setBrightness, useEcoMode } from '../device';
import { useNow } from '../hooks';

/**
 * Device-wide behaviour mounted once by the app: power saving (html.eco + lower brightness),
 * the bedside alarm (rings on any page while Calendary is open) and its backup notification.
 */
export function DeviceLayer() {
  const { eco, prefs } = useEcoMode();
  const alarm = useAlarm();

  useEffect(() => {
    // the night stand sets its own brightness while open
    if (!document.querySelector('.nightstand')) setBrightness(eco ? 0.35 : -1);
  }, [eco]);

  useEffect(() => { syncNativeAlarm(prefs); }, [prefs]);

  useEffect(() => {
    if (!alarm.ringing) return;
    setBrightness(0.7);
    return () => { setBrightness(document.querySelector('.nightstand') ? 0.05 : eco ? 0.35 : -1); };
  }, [alarm.ringing, eco]);

  return alarm.ringing ? <AlarmRinger onStop={alarm.stop} onSnooze={alarm.snooze} /> : null;
}

function AlarmRinger({ onStop, onSnooze }: { onStop: () => void; onSnooze: () => void }) {
  const now = useNow(1000);
  return (
    <div className="alarm-ring" role="alertdialog" aria-label="Sveglia">
      <div className="alarm-time">{hm(now)}</div>
      <div className="alarm-title">⏰ Sveglia</div>
      <div className="row" style={{ gap: 16, justifyContent: 'center' }}>
        <button className="btn alarm-btn" onClick={onSnooze}>Posticipa 9 min</button>
        <button className="btn primary alarm-btn" onClick={onStop}>Ferma</button>
      </div>
    </div>
  );
}
