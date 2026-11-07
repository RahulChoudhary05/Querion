import { motion } from 'motion/react';
import { Bot, Brain, CheckCheck, Database, FlaskConical, Mail, Radar, ScanSearch, Shuffle, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../components/AppShell';
import { EmptyState, Skeleton } from '../components/ui';
import { useInsights, useMeta, useProblems } from '../lib/queries';
import { Seo } from '../components/Seo';

const STEPS = [
  { icon: Brain, title: 'Learn from last week', body: 'Solve rates per topic, abandoned problems, popular domains — computed per learner, not per click.' },
  { icon: Radar, title: 'Scout Kaggle', body: 'Search a rotating domain, keep open-license, well-rated, small CSV datasets we have never used.' },
  { icon: ScanSearch, title: 'Rank teachability', body: 'An LLM ranks candidates by how many related entities and real business questions they support.' },
  { icon: Database, title: 'Design & execute a schema', body: 'The LLM writes a normalised schema as SQL; it is executed on Postgres and validated (keys unique, joins resolve).' },
  { icon: Sparkles, title: 'Forge a six-tier ladder', body: 'One problem per tier plus stepping-stones for last week\'s weakest topics.' },
  { icon: FlaskConical, title: 'Verify on real Postgres', body: 'The reference runs on 4 data variants and mirrored storage order — non-deterministic answers are rejected.' },
  { icon: Bot, title: 'Blind-solve by a second model', body: 'Another model solves from the statement alone. If it disagrees, the statement is ambiguous and gets rewritten.' },
  { icon: Mail, title: 'Publish & notify', body: 'Problems go live Monday with computed expected outputs; opted-in learners get a digest.' },
];

export function Nebula() {
  const { data: insights, isLoading } = useInsights();
  const { data: meta } = useMeta();
  const { data: problems } = useProblems();
  const forged = (problems ?? []).filter((p) => p.origin === 'ai').slice(-6).reverse();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <Seo title="How Querion Forges Fresh SQL Problems — the Nebula Agent" description="Every week an AI agent scouts Kaggle, designs a relational schema and forges SQL problems — verified on real PostgreSQL, blind-solved by a second model and reviewed before publishing." path="/nebula" />
      <PageHeader eyebrow="The Nebula agent" title={<>Where fresh problems are <span className="text-nebula">forged</span></>}>
        Every week an AI agent pulls new data from Kaggle and turns it into problems. Nothing a model <i>claims</i> is trusted — only what PostgreSQL computes.
      </PageHeader>

      <div className="relative grid gap-3 md:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <motion.div key={title} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="flex gap-4 rounded-2xl border border-line bg-panel p-4">
            <div className="flex flex-col items-center">
              <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon className="size-4.5" />
              </span>
              <span className="mt-2 font-mono text-[10px] text-faint">0{i + 1}</span>
            </div>
            <div>
              <div className="font-medium">{title}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="mb-3 flex items-center gap-2 font-medium">
            <Shuffle className="size-4 text-accent" /> Last week, in numbers
          </div>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : !insights ? (
            <EmptyState icon={<Brain className="size-5" />} title="No insights yet" body="The first weekly run computes them on Sunday." />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['Learners', insights.activeLearners],
                  ['Submissions', insights.submissions],
                  ['Acceptance', `${Math.round(insights.acceptance * 100)}%`],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl bg-panel-2 p-3">
                    <div className="text-xl font-semibold">{v}</div>
                    <div className="text-[11px] text-muted">{l}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {insights.topics.slice(0, 6).map((t) => (
                  <div key={t.topic} className="grid grid-cols-[110px_1fr_40px] items-center gap-2 text-xs">
                    <span className="truncate text-muted">{t.topic}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                      <div className="h-full rounded-full bg-nebula" style={{ width: `${t.solveRate * 100}%` }} />
                    </div>
                    <span className="text-right font-mono">{Math.round(t.solveRate * 100)}%</span>
                  </div>
                ))}
              </div>
              {insights.weakTopics.length > 0 && (
                <p className="mt-3 text-xs text-muted">
                  This week's stepping-stones target: <b className="text-ink">{insights.weakTopics.join(', ')}</b>
                </p>
              )}
            </>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="mb-3 flex items-center gap-2 font-medium">
            <CheckCheck className="size-4 text-ok" /> Recently forged & verified
          </div>
          {forged.length === 0 ? (
            <EmptyState icon={<Sparkles className="size-5" />} title="The forge is warming up" body={meta?.ai.enabled ? 'The first AI problems appear after the next scheduled run.' : 'Add a free Groq or Gemini key to enable forging.'} />
          ) : (
            <div className="grid gap-1">
              {forged.map((p) => (
                <Link key={p.slug} to={`/p/${p.slug}`} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-panel-2">
                  <Sparkles className="size-3.5 text-accent" />
                  <span className="truncate">{p.title}</span>
                  <span className="ml-auto text-xs text-faint">{p.datasetName}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-4 rounded-xl bg-panel-2 p-3 text-xs text-muted">
            Runs on free tiers only: Groq / Gemini for generation, GitHub Actions for scheduling, Kaggle API for data, Resend for email.
          </div>
        </div>
      </div>
    </div>
  );
}
