import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ROOT } from './paths';

dotenv.config({ path: path.join(ROOT, 'apps/api/.env'), quiet: true });
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8787),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default('dev-only-change-me-querion-secret-0000'),
  ADMIN_TOKEN: z.string().optional(),

  /** `pglite` (zero-setup, file-backed) or `postgres` (DATABASE_URL, e.g. Neon). */
  DB_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
  DATABASE_URL: z.string().optional(),

  /** Primary AI (free): https://console.groq.com/keys */
  GROQ_API_KEY: z.string().optional(),
  /** Groq models, strongest first. Unavailable ones are skipped automatically. */
  GROQ_MODELS: z.string().default('openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b'),
  /** Main Groq model — always tried first (the rest of GROQ_MODELS are fallbacks / cross-checkers). */
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  /** Optional backup only. */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODELS: z.string().default('gemini-3.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash'),
  /** Comma-separated provider priority. Set to `groq` to never call Gemini. */
  AI_PROVIDERS: z.string().default('groq,gemini'),

  KAGGLE_USERNAME: z.string().optional(),
  KAGGLE_KEY: z.string().optional(),
  KAGGLE_DISCOVER: bool(false),

  /** Public URL of the web app (links in emails). */
  APP_URL: z.string().default('http://localhost:5173'),
  /** Resend (free: 3,000 emails/month) — https://resend.com/api-keys */
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Querion <onboarding@resend.dev>'),
  /** Shared secret for POST /api/hooks/* (GitHub Actions, n8n, cron-job.org …). */
  CRON_SECRET: z.string().optional(),
  /** Shared with the Cloudflare Pages proxy so it can vouch for the visitor's real IP. */
  PROXY_SECRET: z.string().optional(),

  SCHEDULER_ENABLED: bool(true),
  FORGE_REQUIRE_BLIND_SOLVE: bool(true),
  JUDGE_WORKERS: z.coerce.number().default(2),
  JUDGE_TIMEOUT_MS: z.coerce.number().default(8000),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';

if (isProd && env.JWT_SECRET.startsWith('dev-only')) {
  throw new Error('JWT_SECRET must be set in production.');
}
