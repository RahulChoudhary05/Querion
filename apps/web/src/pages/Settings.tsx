import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Laptop, LogOut, Mail, MonitorSmartphone, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Seo } from '../components/Seo';
import { Button, confirmAction, cx, Skeleton, toast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { timeAgo } from '../lib/hooks';
import { useSignOut } from '../lib/session';
import { useApp } from '../lib/store';

interface Session {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

function device(ua: string | null) {
  if (!ua) return { name: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { name: `${browser}${os ? ` on ${os}` : ''}`, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

function Section({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="glass grid gap-6 rounded-2xl p-5 md:grid-cols-[260px_1fr] md:p-6">
      <div>
        <div className="flex items-center gap-2 font-medium">
          <span className="text-accent">{icon}</span> {title}
        </div>
        <p className="mt-1.5 text-sm text-muted">{desc}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function Settings() {
  const qc = useQueryClient();
  const signOut = useSignOut();
  const drafts = useApp((s) => s.drafts);
  const account = useQuery({ queryKey: ['account'], queryFn: () => api<{ handle: string; email: string; email_opt_in: boolean; created_at: string; last_login_at: string | null; password_changed_at: string | null }>('/me/account') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<Session[]>('/me/sessions') });

  const revoke = useMutation({
    mutationFn: (id: number) => api(`/me/sessions/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      // optimistic: drop the row immediately
      const prev = qc.getQueryData<Session[]>(['sessions']);
      qc.setQueryData<Session[]>(['sessions'], (s) => s?.filter((x) => x.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      qc.setQueryData(['sessions'], ctx?.prev);
      toast.error('Could not sign out that device');
    },
    onSuccess: () => toast.success('Device signed out'),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ revoked: number }>('/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.revoked ? `Signed out ${r.revoked} other device${r.revoked === 1 ? '' : 's'}` : 'No other devices were signed in');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const email = useMutation({
    mutationFn: (optIn: boolean) => api('/me/email', { method: 'PUT', json: { optIn } }),
    onSuccess: (_r, optIn) => {
      toast.success(optIn ? 'Weekly digest on' : 'Weekly digest off');
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });

  const [pw, setPw] = useState({ current: '', next: '' });
  const changePw = useMutation({
    mutationFn: () => api('/me/password', { method: 'PUT', json: pw }),
    onSuccess: () => {
      setPw({ current: '', next: '' });
      toast.success('Password updated', 'Every other device has been signed out.');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });

  const others = (sessions.data ?? []).filter((s) => !s.current).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <Seo title="Settings | Querion" description="Account settings." path="/settings" noindex />
      <PageHeader eyebrow="Account" title="Settings" />
      <div className="space-y-4">
        <Section icon={<ShieldCheck className="size-4" />} title="Account" desc="Your sign-in identity.">
          {account.isLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                ['Handle', `@${account.data?.handle}`],
                ['Email', account.data?.email],
                ['Member since', account.data ? new Date(account.data.created_at).toLocaleDateString() : ''],
                ['Password last changed', account.data?.password_changed_at ? timeAgo(account.data.password_changed_at) : 'Never'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-panel-2/60 px-3.5 py-2.5">
                  <dt className="text-xs text-faint">{k}</dt>
                  <dd className="mt-0.5 truncate">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>

        <Section icon={<KeyRound className="size-4" />} title="Password" desc="Changing it signs out every other device.">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              changePw.mutate();
            }}
          >
            {(['current', 'next'] as const).map((k) => (
              <label key={k} className="block text-sm">
                <span className="mb-1.5 block text-xs text-muted">{k === 'current' ? 'Current password' : 'New password'}</span>
                <input
                  type="password"
                  value={pw[k]}
                  autoComplete={k === 'current' ? 'current-password' : 'new-password'}
                  onChange={(e) => setPw((p) => ({ ...p, [k]: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-line-strong bg-bg/70 px-3 outline-none focus:border-accent/70"
                />
              </label>
            ))}
            <Button type="submit" disabled={!pw.current || pw.next.length < 8} loading={changePw.isPending}>
              Update
            </Button>
          </form>
          {changePw.error && <p className="mt-2 text-sm text-bad">{changePw.error instanceof ApiError ? changePw.error.message : 'Could not update password'}</p>}
        </Section>

        <Section icon={<MonitorSmartphone className="size-4" />} title="Devices & sessions" desc="Everywhere you're signed in. Sessions expire after 30 days of inactivity.">
          {sessions.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="space-y-2">
              {sessions.data?.map((s) => {
                const d = device(s.userAgent);
                return (
                  <div key={s.id} className={cx('flex items-center gap-3 rounded-xl border px-3.5 py-3', s.current ? 'border-accent/35 bg-accent-soft' : 'border-line')}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-muted">{d.mobile ? <Smartphone className="size-4" /> : <Laptop className="size-4" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{d.name}</span>
                        {s.current && <span className="rounded-md bg-accent-strong px-1.5 py-0.5 text-[10px] font-semibold text-white">This device</span>}
                      </div>
                      <div className="truncate text-xs text-faint">
                        Active {timeAgo(s.lastSeenAt)} · signed in {timeAgo(s.createdAt)}
                        {s.ip ? ` · ${s.ip}` : ''}
                      </div>
                    </div>
                    {!s.current && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} aria-label="Sign out this device">
                        Sign out
                      </Button>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  disabled={!others}
                  loading={revokeOthers.isPending}
                  onClick={async () => {
                    if (await confirmAction({ title: 'Sign out all other devices?', body: `This ends ${others} other session${others === 1 ? '' : 's'}. You stay signed in here.`, confirm: 'Sign them out' })) revokeOthers.mutate();
                  }}
                >
                  Sign out other devices
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<LogOut className="size-3.5" />}
                  onClick={async () => {
                    if (await confirmAction({ title: 'Sign out?', body: 'Your progress is saved to your account.', confirm: 'Sign out' })) signOut.mutate();
                  }}
                >
                  Sign out of this device
                </Button>
              </div>
            </div>
          )}
        </Section>

        <Section icon={<Mail className="size-4" />} title="Email" desc="One digest a week when new problems land. Never anything else.">
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line px-4 py-3">
            <span className="text-sm">Weekly constellation digest</span>
            <button
              role="switch"
              aria-checked={!!account.data?.email_opt_in}
              onClick={() => email.mutate(!account.data?.email_opt_in)}
              className={cx('relative h-6 w-11 rounded-full transition-colors', account.data?.email_opt_in ? 'bg-accent-strong' : 'bg-line-strong')}
            >
              <span className={cx('absolute top-0.5 size-5 rounded-full bg-white transition-transform', account.data?.email_opt_in ? 'translate-x-[22px]' : 'translate-x-0.5')} />
            </button>
          </label>
        </Section>

        <Section icon={<Trash2 className="size-4" />} title="Local data" desc="Autosaved editor drafts live only in this browser.">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-bad/25 px-4 py-3">
            <span className="text-sm">{Object.keys(drafts).length} saved drafts</span>
            <Button
              size="sm"
              variant="danger"
              disabled={!Object.keys(drafts).length}
              onClick={async () => {
                if (await confirmAction({ title: 'Delete all drafts?', body: 'Unsubmitted code on this device will be erased. Submissions stay in your history.', confirm: 'Delete drafts', typed: 'delete' })) {
                  useApp.setState({ drafts: {} });
                  toast.success('Drafts deleted');
                }
              }}
            >
              Delete all
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
