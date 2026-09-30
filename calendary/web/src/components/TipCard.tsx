import { CATEGORY_LABEL, type Tip } from '../tips';
import { useUI } from '../ui';

export function TipCard({ tip, compact = false, className = '' }: { tip: Tip; compact?: boolean; className?: string }) {
  const { startFive } = useUI();
  return (
    <div className={`glass pad tip-card ${className}`}>
      <div className="row nowrap" style={{ alignItems: 'flex-start' }}>
        <span className="tip-icon">{tip.icon}</span>
        <div className="grow">
          <h3>{tip.title}</h3>
          <div className="faint tiny">{CATEGORY_LABEL[tip.category]}{tip.author ? ` · ${tip.author}` : ''}</div>
        </div>
      </div>
      <div>{tip.text}</div>
      {!compact && <div className="tip-how">{tip.howTo}</div>}
      {tip.id === 'five-seconds' && (
        <button className="btn pink" onClick={() => startFive()} style={{ alignSelf: 'flex-start' }}>5 · 4 · 3 · 2 · 1 · VAI</button>
      )}
    </div>
  );
}
