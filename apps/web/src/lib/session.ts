import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from './api';

export interface SessionUser {
  id: number;
  handle: string;
  email: string;
}

export const SESSION_KEY = ['session'] as const;

/** The single source of truth for "who is signed in" — asked of the server, never guessed client-side. */
export function useSession() {
  const q = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api<{ user: SessionUser | null }>('/auth/session'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return { user: q.data?.user ?? null, loading: q.isLoading, ready: q.isSuccess || q.isError };
}

export function useSignOut() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.setQueryData(SESSION_KEY, { user: null });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' && q.queryKey[0] !== 'meta' });
      nav('/', { replace: true });
    },
  });
}
