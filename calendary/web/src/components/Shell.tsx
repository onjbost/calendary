import type { ReactNode } from 'react';
import { isNative } from '../native';
import { Link } from '../router';

export function Background() {
  return (
    <div className="bg-scene" aria-hidden>
      <div className="bg-blob b1" />
      <div className="bg-blob b2" />
      <div className="bg-blob b3" />
      <div className="bg-grid" />
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Oggi', ico: '◉' },
  { to: '/calendario', label: 'Calendario', ico: '▦' },
  { to: '/matrice', label: 'Matrice', ico: '⊞' },
  { to: '/obiettivi', label: 'Obiettivi', ico: '◎' },
  { to: '/assistente', label: 'Assistente', ico: '✦' },
  { to: '/tips', label: 'Tips', ico: '✺' },
  { to: '/impostazioni', label: 'Impostazioni', ico: '⚙' },
];

// Inside the Android app or an installed PWA a new tab would leave the app: stay in the same window.
const inAppWindow = isNative() || window.matchMedia('(display-mode: standalone)').matches;

export function Shell({ path, children }: { path: string; children: ReactNode }) {
  const isActive = (to: string) => (to === '/' ? path === '/' : path.startsWith(to));
  return (
    <div className="shell">
      <nav className="sidebar glass">
        <Link to="/" className="brand">
          <img src="/img/icon.svg" alt="" />
          <span className="neon-cyan flicker">CALENDARY</span>
        </Link>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className={`nav-link ${isActive(n.to) ? 'active' : ''}`}>
            <span className="ico">{n.ico}</span>
            <span>{n.label}</span>
          </Link>
        ))}
        <div className="spacer nav-extra" />
        {inAppWindow ? (
          <Link to="/kiosk" className="nav-link nav-extra">
            <span className="ico">▭</span>
            <span>Vista tablet</span>
          </Link>
        ) : (
          <a href="/kiosk" className="nav-link nav-extra" target="_blank" rel="noreferrer">
            <span className="ico">▭</span>
            <span>Vista tablet ↗</span>
          </a>
        )}
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
