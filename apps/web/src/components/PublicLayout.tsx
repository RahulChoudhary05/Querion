import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useSession } from '../lib/session';
import { SITE } from '../lib/site';
import { GithubIcon } from './BrandIcons';
import { Footer } from './Footer';
import { Logo } from './Logo';
import { Button, cx } from './ui';

const LINKS = [
  { to: '/#tracks', label: 'Tracks' },
  { to: '/#why', label: 'Why Querion' },
  { to: '/how-it-works', label: 'How it works' },
];

/** Marketing chrome for signed-out visitors: transparent → glass top bar, no app sidebar. */
export function PublicLayout() {
  const { user, loading } = useSession();
  const { pathname, hash } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  // native page scroll (momentum + URL-bar collapse on phones); passive + rAF-throttled
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrolled(window.scrollY > 12);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  useEffect(() => setOpen(false), [pathname, hash]);
  useEffect(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo(0, 0);
  }, [hash, pathname]);

  return (
    <div className="relative min-h-dvh">
      <div className="aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="relative z-10">
        <header className={cx('sticky top-0 z-40 transition-[background,border-color,backdrop-filter] duration-300', scrolled ? 'glass-strong !border-x-0 !border-t-0 !shadow-none' : 'border-b border-transparent')}>
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 md:px-8">
            <Link to="/" aria-label="Querion home">
              <Logo size={26} />
            </Link>
            <nav className="hidden items-center gap-6 md:flex">
              {LINKS.map((l) => (
                <NavLink key={l.to} to={l.to} className="text-sm text-muted transition-colors hover:text-ink">
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto hidden items-center gap-2 md:flex">
              <a href={SITE.repo} target="_blank" rel="noopener noreferrer" aria-label="Querion on GitHub" className="mr-1 grid size-9 place-items-center rounded-lg text-muted transition-colors hover:text-ink">
                <GithubIcon className="size-[18px]" />
              </a>
              {loading ? (
                <span className="h-9 w-40" />
              ) : user ? (
                <Link to="/dashboard">
                  <Button variant="primary" icon={<ArrowRight className="size-4" />}>Open dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link to="/login">
                    <Button variant="ghost">Log in</Button>
                  </Link>
                  <Link to="/signup">
                    <Button variant="primary">Sign up free</Button>
                  </Link>
                </>
              )}
            </div>
            <button className="ml-auto grid size-10 place-items-center rounded-lg text-muted md:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
          <AnimatePresence>
            {open && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="glass-strong overflow-hidden !border-x-0 md:hidden">
                <div className="flex flex-col gap-1 px-4 py-4">
                  {LINKS.map((l) => (
                    <Link key={l.to} to={l.to} className="rounded-lg px-3 py-3 text-[15px] text-muted hover:bg-panel-2 hover:text-ink">
                      {l.label}
                    </Link>
                  ))}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {user ? (
                      <Link to="/dashboard" className="col-span-2">
                        <Button variant="primary" size="lg" className="w-full">Open dashboard</Button>
                      </Link>
                    ) : (
                      <>
                        <Link to="/login"><Button size="lg" className="w-full">Log in</Button></Link>
                        <Link to="/signup"><Button variant="primary" size="lg" className="w-full">Sign up</Button></Link>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>
        <main>
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
