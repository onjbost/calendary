import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ title, onClose, children, footer, wide, glow = 'cyan' }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  glow?: 'cyan' | 'pink' | 'violet' | 'amber';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to <body>: a modal opened from inside a card isn't trapped by the card's backdrop-filter.
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal glass glow-${glow} ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Chiudi">✕</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
