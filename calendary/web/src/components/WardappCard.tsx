import { openWardapp, useWardapp } from '../suite';

/** "Oggi indosso" card: what you wore today in WardApp, or a button to log it (already signed in). */
export function WardappCard({ className = '' }: { className?: string }) {
  const w = useWardapp();
  if (!w || !w.enabled) return null;

  return (
    <section className={`glass pad ${className}`}>
      <div className="card-title" style={{ marginBottom: 10 }}>
        <h2 className="neon-amber">👕 Oggi indosso</h2>
        <button className="btn sm ghost" onClick={() => openWardapp('/', w.publicUrl)}>WardApp ↗</button>
      </div>
      {w.error ? (
        <div className="muted small">{w.error}</div>
      ) : w.logged && w.items?.length ? (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {w.items.map((it) => (
            <img key={it.id} src={it.thumbUrl} alt={it.name} title={it.name} width={64} height={64}
              style={{ objectFit: 'contain', borderRadius: 12, background: 'rgba(255,255,255,0.08)' }} />
          ))}
          <button className="btn sm ghost" onClick={() => openWardapp('/today', w.publicUrl)}>Modifica</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 10, justifyContent: 'space-between' }}>
          <span className="muted small">Non hai ancora registrato cosa hai messo oggi.</span>
          <button className="btn primary" onClick={() => openWardapp('/today', w.publicUrl)}>Registra</button>
        </div>
      )}
    </section>
  );
}
