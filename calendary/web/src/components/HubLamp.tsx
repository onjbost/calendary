import { useEffect, useRef } from 'react';
import { useLampMode } from '../lamp-mode';
import { navigate } from '../router';
import { Lamp } from './Lamp';

/**
 * The lamp wired to this device's modes. Outside the kiosk (which shows the night page itself),
 * reaching Night opens /notte.
 */
export function HubLamp({ size, className, nightPage = true }: { size: 'large' | 'small'; className?: string; nightPage?: boolean }) {
  const { mode, cycle } = useLampMode();
  // only a change to Night opens the night page: coming back to this page (Back button) does not bounce
  const prev = useRef(mode);
  useEffect(() => {
    if (nightPage && mode === 'night' && prev.current !== 'night') navigate('/notte');
    prev.current = mode;
  }, [nightPage, mode]);
  return <Lamp size={size} mode={mode} onToggle={cycle} className={className} light />;
}
