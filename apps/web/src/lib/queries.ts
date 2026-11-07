import { useQuery } from '@tanstack/react-query';
import { api, type Dataset, type Insights, type Meta, type Problem, type ProblemListItem, type Rec, type Stats, type Submission, type Today, type Track } from './api';
import { useApp } from './store';

export const qk = {
  meta: ['meta'] as const,
  problems: ['problems'] as const,
  problem: (slug: string) => ['problem', slug] as const,
  submissions: (slug: string) => ['submissions', slug] as const,
  dataset: (key: string) => ['dataset', key] as const,
  today: ['today'] as const,
  next: ['next'] as const,
  stats: ['stats'] as const,
  track: (key: string) => ['track', key] as const,
  insights: ['insights'] as const,
};

export const useMeta = () => useQuery({ queryKey: qk.meta, queryFn: () => api<Meta>('/meta'), staleTime: 5 * 60_000 });
export const useProblems = () => useQuery({ queryKey: qk.problems, queryFn: () => api<ProblemListItem[]>('/problems'), staleTime: 30_000 });
export const useProblem = (slug: string) => useQuery({ queryKey: qk.problem(slug), queryFn: () => api<Problem>(`/problems/${slug}`), staleTime: 60_000 });
export const useSubmissions = (slug: string) => useQuery({ queryKey: qk.submissions(slug), queryFn: () => api<Submission[]>(`/problems/${slug}/submissions`) });
export const useDataset = (key: string | undefined) =>
  useQuery({ queryKey: qk.dataset(key ?? ''), queryFn: () => api<Dataset>(`/datasets/${key}`), enabled: !!key, staleTime: Infinity });
export const useToday = () => useQuery({ queryKey: qk.today, queryFn: () => api<Today>('/today'), staleTime: 60_000 });
export const useStats = () => useQuery({ queryKey: qk.stats, queryFn: () => api<Stats>('/me/stats') });
export const useTrack = (key: string) => useQuery({ queryKey: qk.track(key), queryFn: () => api<Track>(`/tracks/${key}`) });
export const useInsights = () => useQuery({ queryKey: qk.insights, queryFn: () => api<Insights | null>('/insights'), staleTime: 10 * 60_000 });
export function useNext(enabled = true) {
  const prefs = useApp((s) => s.prefs);
  const q = new URLSearchParams();
  if (prefs.level) q.set('level', prefs.level);
  if (prefs.domains?.length) q.set('domains', prefs.domains.join(','));
  return useQuery({ queryKey: [...qk.next, prefs], queryFn: () => api<Rec[]>(`/me/next?${q}`), enabled });
}
