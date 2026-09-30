import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { AlertWatcher } from './components/AlertWatcher';
import { Background, Shell } from './components/Shell';
import { connectLive, disconnectLive } from './live';
import { AssistantPage } from './pages/AssistantPage';
import { CalendarPage } from './pages/CalendarPage';
import { Dashboard } from './pages/Dashboard';
import { GoalsPage } from './pages/GoalsPage';
import { KioskPage } from './pages/KioskPage';
import { Login } from './pages/Login';
import { MatrixPage } from './pages/MatrixPage';
import { SettingsPage } from './pages/SettingsPage';
import { TipsPage } from './pages/TipsPage';
import { useLocation } from './router';
import { UIProvider, useUI } from './ui';

type Session = { authenticated: boolean; authConfigured: boolean } | null;

function Routes({ path, query, onLogout }: { path: string; query: URLSearchParams; onLogout: () => void }) {
  const { newEvent } = useUI();
  let page;
  if (path.startsWith('/calendario')) page = <CalendarPage query={query} />;
  else if (path.startsWith('/matrice')) page = <MatrixPage query={query} />;
  else if (path.startsWith('/obiettivi')) page = <GoalsPage />;
  else if (path.startsWith('/assistente')) page = <AssistantPage />;
  else if (path.startsWith('/tips')) page = <TipsPage />;
  else if (path.startsWith('/impostazioni')) page = <SettingsPage onLogout={onLogout} />;
  else page = <Dashboard />;

  return (
    <Shell path={path}>
      {page}
      {!path.startsWith('/assistente') && (
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
    if (session?.authenticated) connectLive();
    else disconnectLive();
  }, [session?.authenticated]);

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
  return (
    <UIProvider>
      <Background />
      {kiosk ? <KioskPage /> : <Routes path={path} query={query} onLogout={check} />}
    </UIProvider>
  );
}
