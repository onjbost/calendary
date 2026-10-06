import { useState } from 'react';
import { api } from '../api';

export function Login({ configured, onLogin }: { configured: boolean; onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card glass glow-cyan">
        <img src="/img/icon.svg" alt="" style={{ width: 84, height: 84, margin: '0 auto' }} />
        <div className="logo neon-cyan flicker">HUBITAT</div>
        {configured ? (
          <>
            <div className="muted">Il tuo tempo, in una luce nuova.</div>
            <input className="input" type="password" placeholder="Password" value={password} autoFocus
              onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary lg" onClick={submit} disabled={busy || !password}>{busy ? 'Accesso…' : 'Entra'}</button>
          </>
        ) : (
          <div className="alert">
            Nessuna password configurata. In Home Assistant apri <b>Impostazioni → Componenti aggiuntivi → Hubitat → Configurazione</b>,
            imposta <code>password</code> e riavvia l'add-on.
          </div>
        )}
      </div>
    </div>
  );
}
