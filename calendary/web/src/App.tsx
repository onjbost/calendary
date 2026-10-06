import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { AlertWatcher } from './components/AlertWatcher';
import { DeviceLayer } from './components/DeviceLayer';
import { NightStand } from './components/NightStand';
import { clearLampOverride, clearNightOverride, useLampMode } from './lamp-mode';
import { Background, Shell } from './components/Shell';
import { connectLive, disconnectLive } from './live';
import { AssistantPage } from './pages/AssistantPage';
import { CalendarPage } from './pages/CalendarPage';
import { Dashboard } from './pages/Dashboard';
import { GoalsPage } from './pages/GoalsPage';
import { KioskPage } from './pages/KioskPage';
import { Login } from './pages/Login';
import { MatrixPage } from './pages/MatrixPage';
import { NotesPage } from './pages/NotesPage';
import { PillsPage } from './components/Pills';
import { SettingsPage } from './pages/SettingsPage';
import { TipsPage } from './pages/TipsPage';
import { listenDeepLinks } from './native';
import { navigate, useLocation } from './router';
import { primeMoveo } from './suite';
import { UIProvider, useUI } from './ui';

type Session = { authenticated: boolean; authConfigured: boolean } | null;

function Routes({ path, query, onLogout }: { path: string; query: URLSearchParams; onLogout: () => void }) {
  const { newEvent } = useUI();
  let page;
  if (path.startsWith('/calendario')) page = <CalendarPage query={query} />;
  else if (path.startsWith('/matrice')) page = <MatrixPage query={query} />;
  else if (path.startsWith('/obiettivi')) page = <GoalsPage />;
  else if (path.startsWith('/note')) page = <NotesPage />;
  else if (path.startsWith('/pillole')) page = <PillsPage />;
  else if (path.startsWith('/assistente')) page = <AssistantPage />;
  else if (path.startsWith('/tips')) page = <TipsPage />;
  else if (path.startsWith('/impostazioni')) page = <SettingsPage onLogout={onLogout} />;
  else page = <Dashboard />;

  return (
    <Shell path={path}>
      {page}
      {!path.startsWith('/assistente') && !path.startsWith('/note') && (
        <button className="btn primary fab" onClick={() => newEvent()} aria-label="Nuovo evento" title="Nuovo evento">＋</button>
      )}
      <AlertWatcher />
    </Shell>
  );
}

export function App() {
  const { path, query } = useLocation();
  const [session, setSession] = useState<Session>(null);

  const check = useCallback(() => {
    api.session()
      .then(setSession)
      .catch(() => setSession({ authenticated: false, authConfigured: true }));
  }, []);

  useEffect(() => {
    check();
    const onUnauthorized = () => setSession((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener('calendary:unauthorized', onUnauthorized);
    return () => window.removeEventListener('calendary:unauthorized', onUnauthorized);
  }, [check]);

  useEffect(() => {
    if (session?.authenticated) {
      connectLive();
      primeMoveo();
    } else disconnectLive();
  }, [session?.authenticated]);

  // Android app: links from Moveo (calendary://open?url=…) land on the right page.
  useEffect(() => listenDeepLinks(), []);

  if (!session) return <Background />;

  if (!session.authenticated) {
    return (
      <>
        <Background />
        <Login configured={session.authConfigured} onLogin={check} />
      </>
    );
  }

  const kiosk = path.startsWith('/kiosk');
  const night = path.startsWith('/notte');
  return (
    <UIProvider>
      <Background />
      {night ? <NightRoute />
        : kiosk ? <KioskPage /> : <Routes path={path} query={query} onLogout={check} />}
      <DeviceLayer />
    </UIProvider>
  );
}

/** /notte outside the kiosk: a tap goes back to the automatic mode, a tap on the lamp switches it on. */
function NightRoute() {
  const lamp = useLampMode();
  const back = () => navigate('/', { replace: true });
  useEffect(() => () => clearNightOverride(), []);
  return (
    <NightStand
      onExit={() => { clearLampOverride(); back(); }}
      onWake={() => { lamp.set('normal'); back(); }}
    />
  );
}
