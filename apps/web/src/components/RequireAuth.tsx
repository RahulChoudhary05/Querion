import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../lib/session';
import { LogoMark } from './Logo';

function FullScreenLoader() {
  return (
    <div className="grid h-dvh place-items-center bg-bg" role="status" aria-label="Checking your session">
      <div className="animate-pulse">
        <LogoMark size={44} animate={false} />
      </div>
    </div>
  );
}

/** App pages: signed-in users only. Anyone else goes to /login and comes back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Login / sign-up: already signed in → straight to the dashboard. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Only allow same-site relative redirects after login (prevents open-redirect attacks). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  if (next.startsWith('/login') || next.startsWith('/signup')) return '/dashboard';
  return next;
}
