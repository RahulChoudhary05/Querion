import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, GraduationCap, Rocket, Sprout } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useMeta } from '../lib/queries';
import { useSession } from '../lib/session';
import { useApp, type Prefs } from '../lib/store';
import { LogoMark } from './Logo';
import { Button, Chip, cx, Dialog } from './ui';

const LEVELS: { key: NonNullable<Prefs['level']>; label: string; body: string; icon: typeof Sprout }[] = [
  { key: 'new', label: 'New to SQL', body: 'Start at Tier 1 — SELECT, WHERE, ORDER BY', icon: Sprout },
  { key: 'some', label: 'I know the basics', body: 'Jump in at joins & aggregation', icon: GraduationCap },
  { key: 'pro', label: 'Interview-ready', body: 'Windows, CTEs and Architect problems', icon: Rocket },
];
const GOALS = ['Crack data interviews', 'Daily practice', 'Learn from scratch', 'Analytics at work', 'System design'];

/** First-visit onboarding (3 quick choices) — drives the "What next" recommendations. */
export function Onboarding() {
  const onboarded = useApp((s) => s.onboarded);
  const setOnboarded = useApp((s) => s.setOnboarded);
  const setPrefs = useApp((s) => s.setPrefs);
  const { user } = useSession();
  const { data: meta } = useMeta();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<Prefs['level']>();
  const [domains, setDomains] = useState<string[]>([]);
  const [goal, setGoal] = useState<string>();

  // never interrupt someone who deep-linked straight into a problem
  // shown once, inside the app, right after sign-up — never over a problem someone deep-linked to
  const open = !onboarded && !!user && !pathname.startsWith('/p/');

  const finish = async () => {
    const prefs = { level, domains, goal };
    setPrefs(prefs);
    setOnboarded(true);
    if (user) void api('/me/onboarding', { method: 'PUT', json: prefs }).catch(() => {});
    nav(domains[0] ? '/problems?domain=' + domains[0] : '/dashboard');
  };

  return (
    <Dialog open={open} onClose={() => setOnboarded(true)} label="Welcome" className="max-w-lg">
      <div className="mb-5 flex items-center gap-3">
        <LogoMark size={36} />
        <div>
          <div className="font-semibold">Welcome to Querion</div>
          <div className="text-sm text-muted">Three taps to personalise your path.</div>
        </div>
        <div className="ml-auto flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong')} />
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
          {step === 0 && (
            <div className="grid gap-2">
              <div className="mb-1 text-sm font-medium">Where are you with SQL?</div>
              {LEVELS.map(({ key, label, body, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setLevel(key);
                    setStep(1);
                  }}
                  className={cx('flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:border-accent/50', level === key ? 'border-accent bg-accent-soft' : 'border-line')}
                >
                  <Icon className="size-5 text-accent" />
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted">{body}</div>
                  </div>
                  {level === key && <Check className="ml-auto size-4 text-accent" />}
                </button>
              ))}
            </div>
          )}
          {step === 1 && (
            <div>
              <div className="mb-3 text-sm font-medium">Which worlds do you want to query? <span className="text-muted">(pick any)</span></div>
              <div className="flex flex-wrap gap-2">
                {(meta?.domains ?? []).filter((d) => d.datasets.length).map((d) => (
                  <Chip key={d.key} active={domains.includes(d.key)} onClick={() => setDomains((x) => (x.includes(d.key) ? x.filter((y) => y !== d.key) : [...x, d.key]))}>
                    <span className="size-1.5 rounded-full" style={{ background: `oklch(0.72 0.15 ${d.hue})` }} />
                    {d.label}
                  </Chip>
                ))}
              </div>
              <div className="mt-6 flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
                <Button variant="primary" onClick={() => setStep(2)} icon={<ArrowRight className="size-4" />}>Continue</Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="mb-3 text-sm font-medium">What's your main goal?</div>
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <Chip key={g} active={goal === g} onClick={() => setGoal(g)}>{g}</Chip>
                ))}
              </div>
              <div className="mt-6 flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button variant="primary" onClick={finish}>Start practising</Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <button onClick={() => setOnboarded(true)} className="mt-4 text-xs text-faint hover:text-muted">Skip for now</button>
    </Dialog>
  );
}
