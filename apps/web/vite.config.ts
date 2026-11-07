import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * SEO plugin: fills absolute URLs into index.html and emits robots.txt +
 * sitemap.xml for the deploy's real domain (VITE_SITE_URL). Problem pages are
 * listed by the API's live sitemap (they change every week).
 */
function seo(env: Record<string, string>): Plugin {
  const site = (env.VITE_SITE_URL || 'http://localhost:5173').replace(/\/$/, '');
  const apiUrl = env.VITE_API_URL || '';
  const apiOrigin = /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : site;
  const apiBase = /^https?:\/\//.test(apiUrl) ? apiUrl.replace(/\/$/, '') : `${site}/api`;
  const pages = ['/', '/problems', '/daily', '/nebula', '/tracks/transit', '/tracks/autohaus', '/tracks/shipfast', '/tracks/carepoint', '/tracks/shopwave', '/tracks/streamflix', '/tracks/olympics'];
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: 'querion-seo',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%VITE_SITE_URL%', site).replaceAll('%VITE_API_ORIGIN%', apiOrigin),
    },
    generateBundle() {
      // Cloudflare Pages / Netlify security headers (Vercel uses vercel.json).
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        `connect-src 'self' ${apiOrigin}`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ');
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\nDisallow: /me\nDisallow: /login\nDisallow: /signup\nDisallow: /invite/\n\nSitemap: ${site}/sitemap.xml\nSitemap: ${apiBase}/sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          pages.map((p) => `  <url><loc>${site}${p}</loc><lastmod>${today}</lastmod><changefreq>${p === '/' || p === '/daily' ? 'daily' : 'weekly'}</changefreq><priority>${p === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n') +
          `\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), seo(env)],
    // PGlite ships its own WASM + data bundle; let Vite serve it as-is.
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    worker: { format: 'es' },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': 'http://localhost:8787' },
    },
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router'],
            query: ['@tanstack/react-query', 'zustand'],
            motion: ['motion'],
            markdown: ['react-markdown', 'remark-gfm'],
            codemirror: ['@uiw/react-codemirror', '@codemirror/lang-sql', '@codemirror/view', '@codemirror/state'],
          },
        },
      },
    },
  };
});
