/**
 * pnpm mail:test you@example.com [welcome|reset|changed|weekly|all]
 *
 * Sends real emails through Resend so you can see exactly what users get.
 * Default kind is "test". Prints Resend's real error if anything fails.
 */
import { env } from '../env';
import { passwordChangedEmail, passwordResetEmail, sandboxSender, sendOne, testEmail, welcomeEmail, weeklyDigestEmail } from '../services/mail';

const [to, kind = 'test'] = process.argv.slice(2);
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error('Usage: pnpm mail:test you@example.com [test|welcome|reset|changed|weekly|all]');
  process.exit(1);
}
if (!env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY is not set in apps/api/.env');
  process.exit(1);
}

const user = { id: 0, handle: to.split('@')[0], email: to };
const app = env.APP_URL.replace(/\/$/, '');
const samples = {
  test: () => testEmail(to),
  welcome: () => welcomeEmail(user),
  reset: () => passwordResetEmail(user, `${app}/reset-password?token=sample-token-not-valid`),
  changed: () => passwordChangedEmail(user, { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', via: 'settings' }),
  weekly: () =>
    weeklyDigestEmail({ ...user, solved: 12 }, new Date().toISOString().slice(0, 10), [
      { slug: 'sample-1', title: 'Busiest depots by weekday', difficulty: 'Easy', tier: 2 },
      { slug: 'sample-2', title: 'Route delay streaks (gaps & islands)', difficulty: 'Hard', tier: 5 },
      { slug: 'sample-3', title: 'Fleet utilisation KPI under a cost budget', difficulty: 'Hard', tier: 6 },
    ]),
} as const;

const kinds = kind === 'all' ? (Object.keys(samples) as (keyof typeof samples)[]) : [kind as keyof typeof samples];
if (!kinds.every((k) => k in samples)) {
  console.error(`Unknown kind "${kind}". Use one of: ${Object.keys(samples).join(', ')}, all`);
  process.exit(1);
}

console.log(`\n✉️  Sending ${kinds.join(', ')} to ${to} from ${env.MAIL_FROM}`);
if (sandboxSender()) console.log('   (sandbox sender: Resend only delivers to your Resend account email)');
let failed = 0;
for (const k of kinds) {
  const r = await sendOne(samples[k]());
  console.log(r.sent ? `   ✅ ${k}: accepted (id ${r.ids?.[0]})` : `   ❌ ${k}: ${r.error}`);
  if (!r.sent) failed++;
  await new Promise((res) => setTimeout(res, 600)); // stay under Resend's 2 req/s
}
process.exit(failed ? 1 : 0);
