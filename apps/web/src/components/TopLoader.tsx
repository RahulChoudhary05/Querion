import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

/**
 * YouTube-style progress bar: trickles forward while anything is loading
 * (route change, queries, mutations) and snaps to 100% when it settles.
 */
export function TopLoader() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const location = useLocation();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<number>(undefined);
  const [routeBusy, setRouteBusy] = useState(false);

  useEffect(() => {
    setRouteBusy(true);
    const t = setTimeout(() => setRouteBusy(false), 250);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const busy = fetching + mutating > 0 || routeBusy;

  useEffect(() => {
    window.clearInterval(timer.current);
    if (busy) {
      setVisible(true);
      setWidth((w) => (w > 0 && w < 90 ? w : 12));
      timer.current = window.setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.08 : w)), 180);
    } else if (visible) {
      setWidth(100);
      const t = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 380);
      return () => clearTimeout(t);
    }
    return () => window.clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return <div className="top-loader" style={{ width: `${width}%`, opacity: visible ? 1 : 0 }} role="progressbar" aria-hidden={!visible} />;
}
