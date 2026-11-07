import { ArrowUpRight, Mail } from 'lucide-react';
import { GithubIcon, LinkedinIcon } from './BrandIcons';
import { Link } from 'react-router';
import { AUTHOR, SITE } from '../lib/site';
import { Logo } from './Logo';

const COLS: { title: string; links: { label: string; to?: string; href?: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Problems', to: '/problems' },
      { label: 'Daily Orbit', to: '/daily' },
      { label: 'Tracks', to: '/#tracks' },
      { label: 'How it works', to: '/how-it-works' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Create account', to: '/signup' },
      { label: 'Log in', to: '/login' },
      { label: 'Reset password', to: '/forgot-password' },
    ],
  },
  {
    title: 'Open source',
    links: [
      { label: 'Source code', href: SITE.repo },
      { label: 'Report an issue', href: `${SITE.repo}/issues` },
      { label: 'Sitemap', href: '/sitemap.xml' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-10 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-12 md:px-8">
        <div className="md:col-span-4">
          <Logo size={28} />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">{SITE.tagline} Fresh problems from real Kaggle data every week — verified on PostgreSQL 17, free forever.</p>
          <div className="mt-5 flex items-center gap-2">
            {[
              { href: AUTHOR.github, label: 'GitHub', icon: GithubIcon },
              { href: AUTHOR.linkedin, label: 'LinkedIn', icon: LinkedinIcon },
              { href: `mailto:${AUTHOR.email}`, label: 'Email', icon: Mail },
            ].map(({ href, label, icon: Icon }) => (
              <a key={label} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer me" aria-label={`${AUTHOR.name} on ${label}`} className="grid size-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-ink">
                <Icon className="size-4" />
              </a>
            ))}
          </div>
        </div>

        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title} className="md:col-span-2">
            <div className="eyebrow mb-4">{c.title}</div>
            <ul className="space-y-2.5 text-sm">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.to ? (
                    <Link to={l.to} className="text-muted transition-colors hover:text-ink">
                      {l.label}
                    </Link>
                  ) : (
                    <a href={l.href} target={l.href!.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted transition-colors hover:text-ink">
                      {l.label}
                      {l.href!.startsWith('http') && <ArrowUpRight className="size-3" />}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="md:col-span-2">
          <div className="eyebrow mb-4">Built by</div>
          <a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer me author" className="group block">
            <div className="text-sm font-medium text-ink group-hover:text-accent">{AUTHOR.name}</div>
            <div className="text-xs text-faint">{AUTHOR.role}</div>
          </a>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-faint md:px-8">
          <span>© {new Date().getFullYear()} {SITE.name} · Designed &amp; built by <a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer author" className="text-muted hover:text-ink">{AUTHOR.name}</a></span>
          <span>No ads · no tracking cookies · datasets under open licenses</span>
        </div>
      </div>
    </footer>
  );
}
