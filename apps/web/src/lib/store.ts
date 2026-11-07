import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Prefs {
  level?: 'new' | 'some' | 'pro';
  domains?: string[];
  goal?: string;
}

/**
 * Local, non-sensitive UI state only. Authentication is NOT stored here — it
 * lives in an httpOnly cookie the server controls (see lib/session.ts).
 */
interface AppState {
  clientId: string;
  /** Autosaved editor drafts per problem slug. */
  drafts: Record<string, { sql: string; at: number }>;
  /** "My queue" — problems bookmarked via bulk actions. */
  queue: string[];
  prefs: Prefs;
  onboarded: boolean;
  sidebarCollapsed: boolean;
  saveDraft: (slug: string, sql: string) => void;
  clearDraft: (slug: string) => void;
  toggleQueue: (slugs: string[], on: boolean) => void;
  setPrefs: (p: Prefs) => void;
  setOnboarded: (v: boolean) => void;
  toggleSidebar: () => void;
}

const newClientId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g, '');

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      clientId: newClientId(),
      drafts: {},
      queue: [],
      prefs: {},
      onboarded: false,
      sidebarCollapsed: false,
      saveDraft: (slug, sql) => set((s) => ({ drafts: { ...s.drafts, [slug]: { sql, at: Date.now() } } })),
      clearDraft: (slug) =>
        set((s) => {
          const { [slug]: _, ...rest } = s.drafts;
          return { drafts: rest };
        }),
      toggleQueue: (slugs, on) =>
        set((s) => ({ queue: on ? [...new Set([...s.queue, ...slugs])] : s.queue.filter((x) => !slugs.includes(x)) })),
      setPrefs: (prefs) => set({ prefs }),
      setOnboarded: (onboarded) => set({ onboarded }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: 'querion-app',
      version: 2,
      // v1 kept a bearer token in localStorage — drop it on upgrade (sessions are cookies now)
      migrate: (state) => {
        const { token: _t, user: _u, ...rest } = (state ?? {}) as Record<string, unknown>;
        return rest as unknown as AppState;
      },
    }
  )
);
