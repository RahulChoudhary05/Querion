import { useEffect } from 'react';

const SITE = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || (typeof location !== 'undefined' ? location.origin : '');
const DEFAULT_IMAGE = '/og.png';

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Per-route SEO: title, description, canonical, Open Graph / Twitter cards and
 * JSON-LD structured data. Static defaults live in index.html for crawlers that
 * don't execute JavaScript; Google renders the SPA and picks these up per page.
 */
export function Seo({ title, description, path, image, noindex, jsonLd }: { title: string; description: string; path: string; image?: string; noindex?: boolean; jsonLd?: Record<string, unknown> }) {
  useEffect(() => {
    const url = SITE + path;
    const img = (image ?? DEFAULT_IMAGE).startsWith('http') ? image! : SITE + (image ?? DEFAULT_IMAGE);
    document.title = title;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');
    setLink('canonical', url);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', 'Querion');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', img);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', img);

    const id = 'ld-page';
    document.getElementById(id)?.remove();
    if (jsonLd) {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.id = id;
      s.text = JSON.stringify({ '@context': 'https://schema.org', ...jsonLd });
      document.head.appendChild(s);
    }
  }, [title, description, path, image, noindex, jsonLd]);
  return null;
}
