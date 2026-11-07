import { motion } from 'motion/react';
import { Link } from 'react-router';
import { LogoMark } from '../components/Logo';
import { Button } from '../components/ui';
import { Seo } from '../components/Seo';

/** Custom 404 — styled as a query that returned zero rows. */
export function NotFound() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-4">
      <Seo title="Page not found | Querion" description="This page drifted out of orbit." path={location.pathname} noindex />
      <div className="w-full max-w-lg text-center">
        <motion.div initial={{ rotate: -20, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 120 }} className="mx-auto w-fit">
          <LogoMark size={72} />
        </motion.div>
        <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-panel text-left font-mono text-[13px]">
          <div className="border-b border-line bg-panel-2 px-4 py-2 text-faint">psql — querion</div>
          <div className="space-y-1 p-4">
            <div>
              <span className="text-accent">querion=#</span> SELECT * FROM pages WHERE path = '{location.pathname}';
            </div>
            <div className="text-muted">(0 rows)</div>
          </div>
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em]">This page drifted out of orbit.</h1>
        <p className="mt-2 text-muted">The link may be old, or the problem was retired. Your progress is safe.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/problems">
            <Button variant="primary">Browse problems</Button>
          </Link>
          <Link to="/">
            <Button>Go home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
