import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { CommandPalette } from './components/CommandPalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PublicLayout } from './components/PublicLayout';
import { GuestOnly, RequireAuth } from './components/RequireAuth';
import { TopLoader } from './components/TopLoader';
import { ConfirmHost, OrbitLoader, Skeleton, toast, Toaster } from './components/ui';
import './index.css';
import { ApiError, setUnauthorizedHandler } from './lib/api';
import { useToday } from './lib/queries';
import { SESSION_KEY } from './lib/session';
import { Landing } from './pages/Landing';

// Only the landing page ships in the entry bundle; every other route is a lazy chunk.
const routes = {
  Dashboard: () => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })),
  Problems: () => import('./pages/Problems').then((m) => ({ default: m.Problems })),
  Track: () => import('./pages/Track').then((m) => ({ default: m.Track })),
  Nebula: () => import('./pages/Nebula').then((m) => ({ default: m.Nebula })),
  Profile: () => import('./pages/Profile').then((m) => ({ default: m.Profile })),
  Settings: () => import('./pages/Settings').then((m) => ({ default: m.Settings })),
  AuthPage: () => import('./pages/AuthPage').then((m) => ({ default: m.AuthPage })),
  Invite: () => import('./pages/Invite').then((m) => ({ default: m.Invite })),
  NotFound: () => import('./pages/NotFound').then((m) => ({ default: m.NotFound })),
  // The studio pulls in CodeMirror + PGlite.
  Studio: () => import('./pages/studio/Studio').then((m) => ({ default: m.Studio })),
};
const Dashboard = lazy(routes.Dashboard);
const Problems = lazy(routes.Problems);
const Track = lazy(routes.Track);
const Nebula = lazy(routes.Nebula);
const Profile = lazy(routes.Profile);
const Settings = lazy(routes.Settings);
const AuthPage = lazy(routes.AuthPage);
const Invite = lazy(routes.Invite);
const NotFound = lazy(routes.NotFound);
const Studio = lazy(routes.Studio);

// Warm the most likely next routes once the browser is idle (instant navigation, no cost to first paint).
const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 2500));
idle(() => {
  void routes.AuthPage();
  void routes.Dashboard();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    onError: (e, q) => {
      // background refetch failures shouldn't wipe the screen — tell the user, keep stale data
      if (q.state.data !== undefined && !(e instanceof ApiError && e.status === 401)) toast.error('Could not refresh', e.message);
    },
  }),
});

// Session ended elsewhere (expired, revoked from another device, password changed) → guards send us to /login.
setUnauthorizedHandler(() => {
  if (queryClient.getQueryData<{ user: unknown }>(SESSION_KEY)?.user) {
    queryClient.setQueryData(SESSION_KEY, { user: null });
    toast.info('Your session ended', 'Please sign in again.');
  }
});

function PageFallback() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-10 md:px-8">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-28" />
      <Skeleton className="h-64" />
    </div>
  );
}

const page = (el: ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>;
const bare = (el: ReactNode) => <Suspense fallback={<div className="h-dvh bg-bg" />}>{el}</Suspense>;

function Daily() {
  const { data, isLoading } = useToday();
  if (isLoading) return <div className="grid h-full place-items-center"><OrbitLoader label="Finding today's orbit…" /></div>;
  return <Navigate to={data?.daily ? `/p/${data.daily.slug}` : '/problems'} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <TopLoader />
      <ErrorBoundary label="the app">
        <Routes>
          {/* public marketing site */}
          <Route element={<PublicLayout />}>
            <Route index element={<Landing />} />
            <Route path="how-it-works" element={page(<Nebula />)} />
            <Route path="invite/:handle" element={page(<Invite />)} />
          </Route>

          {/* auth — one page component, so the pixel grid migrates between modes */}
          {['login', 'signup', 'forgot-password'].map((p) => (
            <Route key={p} path={p} element={bare(<GuestOnly><AuthPage /></GuestOnly>)} />
          ))}
          <Route path="reset-password" element={bare(<AuthPage />)} />

          {/* the app — signed-in users only */}
          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route path="dashboard" element={page(<Dashboard />)} />
            <Route path="problems" element={page(<Problems />)} />
            <Route path="daily" element={<Daily />} />
            <Route path="tracks/:key" element={page(<Track />)} />
            <Route path="nebula" element={page(<Nebula />)} />
            <Route path="me" element={page(<Profile />)} />
            <Route path="settings" element={page(<Settings />)} />
            <Route
              path="p/:slug"
              element={
                <Suspense fallback={<div className="grid h-full place-items-center"><OrbitLoader label="Booting the studio…" /></div>}>
                  <Studio />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={bare(<NotFound />)} />
        </Routes>
      </ErrorBoundary>
      <CommandPalette />
      <ConfirmHost />
      <Toaster />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
