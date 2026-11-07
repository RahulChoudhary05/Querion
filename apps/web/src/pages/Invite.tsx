import { motion } from 'motion/react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { LogoMark } from '../components/Logo';
import { Button } from '../components/ui';
import { useMeta } from '../lib/queries';
import { Seo } from '../components/Seo';

/** Referral landing page: remembers who invited you, then routes into sign-up. */
export function Invite() {
  const { handle = '' } = useParams();
  const { data: meta } = useMeta();
  useEffect(() => {
    try {
      if (/^[a-zA-Z0-9_]{3,24}$/.test(handle)) localStorage.setItem('querion-ref', handle);
    } catch {
      /* ignore */
    }
  }, [handle]);
  return (
    <div className="grid min-h-full place-items-center px-4 py-16">
      <Seo title={`@${handle} invited you to Querion`} description="Practise SQL on real data together — fresh, verified problems every week. Free forever." path={`/invite/${handle}`} noindex />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
        <LogoMark size={64} className="mx-auto" />
        <p className="mt-6 text-sm text-accent">@{handle} invited you</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Practise SQL on real data — together.</h1>
        <p className="mt-3 text-muted">
          {meta ? `${meta.counts.problems} verified problems across ${meta.counts.datasets} real-world datasets, ` : ''}fresh ones every week, judged on hidden data with an AI tutor. Free forever.
        </p>
        <div className="mt-8 flex justify-center gap-2">
          <Link to={`/signup?ref=${encodeURIComponent(handle)}`}>
            <Button variant="primary" size="lg">Accept invite</Button>
          </Link>
          <Link to="/problems">
            <Button size="lg">Try first</Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
