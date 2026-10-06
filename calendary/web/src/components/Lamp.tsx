// Arc floor lamp of the Hubitat ecosystem: it "lights" the app and cycles Normal → Power saving → Night.
// Self-contained (React + lamp.css only, no app imports) so the future Hubitat home can reuse it as is.
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import '../lamp.css';

export type LampMode = 'normal' | 'eco' | 'night';

const LABEL: Record<LampMode, string> = { normal: 'normale', eco: 'risparmio energetico', night: 'notte' };
const NEXT: Record<LampMode, LampMode> = { normal: 'eco', eco: 'night', night: 'normal' };

/**
 * `large`: the whole lamp (base, arc, shade, bulb) and its light spreading over the page.
 * `small`: just shade and bulb, for a phone header.
 */
export function Lamp({ size = 'large', mode, onToggle, light = size === 'large', className = '' }: {
  size?: 'large' | 'small';
  mode: LampMode;
  onToggle?: () => void;
  /** spread the light over the page from the bulb (fixed layer) */
  light?: boolean;
  className?: string;
}) {
  const bulb = useRef<SVGCircleElement>(null);
  const pos = useBulbPosition(bulb, light);
  const label = `Lampada: modalità ${LABEL[mode]}. Tocca per passare a ${LABEL[NEXT[mode]]}`;

  return (
    <>
      <button type="button" className={`lamp lamp-${size} ${className}`} data-mode={mode} onClick={onToggle} aria-label={label} title={label}>
        {size === 'large' ? (
          <svg viewBox="0 0 240 260" aria-hidden="true">
            <defs>
              <radialGradient id="lamp-bulb-on" cx="50%" cy="40%" r="60%">
                <stop offset="0" stopColor="#fff6dc" />
                <stop offset="0.5" stopColor="#ffbf6b" />
                <stop offset="1" stopColor="#ff8a1f" />
              </radialGradient>
              <linearGradient id="lamp-shade" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2a2622" />
                <stop offset="0.55" stopColor="#151210" />
                <stop offset="1" stopColor="#0b0908" />
              </linearGradient>
              <linearGradient id="lamp-base" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3b3530" />
                <stop offset="0.25" stopColor="#141210" />
                <stop offset="1" stopColor="#070605" />
              </linearGradient>
              <filter id="lamp-blur" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="8" /></filter>
              <linearGradient id="lamp-cone" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffb05a" stopOpacity="0.55" />
                <stop offset="1" stopColor="#ff8a1f" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* the beam under the shade */}
            <path className="lamp-cone" d="M10 70 L 126 70 L 176 250 L -40 250 Z" fill="url(#lamp-cone)" />
            {/* stem: a dark tube with a thin highlight, from the base up and over to the shade */}
            <path className="lamp-stem" d="M206 246 C 222 150, 186 48, 104 36" />
            <path className="lamp-stem-hi" d="M206 246 C 222 150, 186 48, 104 36" />
            {/* glossy rectangular base */}
            <rect x="166" y="244" width="66" height="13" rx="2.5" fill="url(#lamp-base)" />
            <rect x="168" y="244.5" width="62" height="1.6" rx="0.8" className="lamp-base-hi" />
            {/* bulb: halo, glass, filament */}
            <circle className="lamp-halo" cx="66" cy="84" r="22" filter="url(#lamp-blur)" />
            <circle ref={bulb} className="lamp-glass" cx="66" cy="80" r="11" />
            <path className="lamp-filament" d="M61 80 q2.5 -5 5 0 q2.5 5 5 0" />
            {/* conical shade: dark outside, warm rim when lit */}
            <path className="lamp-shade" d="M38 22 L 106 22 L 128 70 L 8 70 Z" fill="url(#lamp-shade)" />
            <path className="lamp-shade-hi" d="M40 23 L 104 23" />
            <path className="lamp-rim" d="M11 69 L 125 69" />
          </svg>
        ) : (
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <defs>
              <radialGradient id="lamp-bulb-on-s" cx="50%" cy="40%" r="60%">
                <stop offset="0" stopColor="#fff6dc" />
                <stop offset="1" stopColor="#ff8a1f" />
              </radialGradient>
            </defs>
            <circle className="lamp-halo" cx="24" cy="33" r="10" />
            <circle ref={bulb} className="lamp-glass lamp-glass-s" cx="24" cy="31" r="6" />
            <path className="lamp-filament" d="M21 31 q1.5 -3 3 0 q1.5 3 3 0" />
            <path className="lamp-shade" d="M15 6 L 33 6 L 42 25 L 6 25 Z" fill="#171310" />
            <path className="lamp-rim" d="M8 24.5 L 40 24.5" />
          </svg>
        )}
      </button>
      {light && pos && createPortal(
        <div className="lamp-light" data-mode={mode} aria-hidden="true" style={{ '--lx': `${pos.x}px`, '--ly': `${pos.y}px` } as CSSProperties} />,
        document.body,
      )}
    </>
  );
}

/** Viewport position of the bulb, followed on scroll and resize (the light comes from there). */
function useBulbPosition(ref: RefObject<SVGCircleElement | null>, enabled: boolean) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setPos((p) => (p && Math.abs(p.x - (r.x + r.width / 2)) < 1 && Math.abs(p.y - (r.y + r.height / 2)) < 1 ? p : { x: r.x + r.width / 2, y: r.y + r.height / 2 }));
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      ro.disconnect();
    };
  }, [ref, enabled]);
  return pos;
}
