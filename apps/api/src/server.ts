import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { aiEnabled, discoverModels, providers } from './ai/llm';
import { getDb } from './db';
import { env, isProd } from './env';
import { csrfGuard } from './http/auth';
import { api } from './http/routes';
import { pool } from './judge/pool';
import { datasets, reloadDatasets } from './nebula/registry';
import { startScheduler } from './nebula/scheduler';
import { seedIfEmpty } from './nebula/seed';
import { ROOT } from './paths';

const app = new Hono();
const origins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

// Strict CSP for the served web app: no inline/remote scripts. 'wasm-unsafe-eval' is required only to
// compile PostgreSQL's WebAssembly (PGlite) in the browser — it does NOT allow JS eval().
app.use(
  '*',
  secureHeaders({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: 'same-site',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  })
);
app.use('*', compress());
if (!isProd) app.use('/api/*', logger());
app.use(
  '/api/*',
  cors({
    origin: (origin) => (!origin || origins.includes(origin) || (!isProd && /^http:\/\/localhost:\d+$/.test(origin)) ? origin : null),
    allowHeaders: ['Content-Type', 'X-Client-Id', 'X-Querion-CSRF', 'X-Admin-Token', 'X-Cron-Secret'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true, // session cookie
    maxAge: 86400,
  })
);
app.use('/api/*', csrfGuard(origins));
app.route('/api', api);
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: isProd ? 'Internal error' : err.message }, 500);
});

// Single-service deploys: serve the built web app if present.
const webDist = path.join(ROOT, 'apps/web/dist');
if (fs.existsSync(webDist)) {
  const rel = path.relative(process.cwd(), webDist).replace(/\\/g, '/');
  app.use('/*', serveStatic({ root: rel }));
  app.get('*', serveStatic({ path: `${rel}/index.html` }));
}

async function main() {
  await getDb();
  await reloadDatasets();
  // Open the port first: hosts like Render kill a service that doesn't bind within a few minutes,
  // and first-boot seeding can take that long. The site works while seeding runs in the background.
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    const ai = aiEnabled() ? providers().map((p) => p.id).join(' → ') : 'off (offline tutor)';
    console.log(`\n  ✦ Querion API  http://localhost:${info.port}/api`);
    console.log(`    datasets: ${datasets().size} · db: ${env.DB_DRIVER} · AI: ${ai}\n`);
  });
  await discoverModels().catch((e) => console.warn('Model discovery failed:', (e as Error).message));
  await seedIfEmpty().catch((e) => console.error('Seeding failed:', e));
  pool.warm();
  startScheduler();

  // Close the embedded database cleanly so Ctrl+C never corrupts local data.
  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`\n${sig} — shutting down…`);
    await pool.close().catch(() => {});
    await (await getDb()).close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Tests import `app` directly and drive it with app.request() — no port, no scheduler.
export { app };
if (process.env.QUERION_NO_LISTEN !== '1') {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
