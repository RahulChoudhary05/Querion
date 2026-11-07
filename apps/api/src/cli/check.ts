/** Verifies every curated reference solution against all dataset variants (CI-friendly). */
import { PGlite } from '@electric-sql/pglite';
import { buildTestCases, inferTier } from '@querion/engine';
import { tierProfileIssue } from '../nebula/forge';
import { CURATED } from '../nebula/curated';
import { getDataset } from '../nebula/registry';

const db = await PGlite.create();
let failed = 0;
for (const p of CURATED) {
  const ds = getDataset(p.dataset);
  if (!ds) {
    console.log(`✗ ${p.title}: unknown dataset ${p.dataset}`);
    failed++;
    continue;
  }
  const check = await buildTestCases(db, ds, p.sql);
  const rows = check.testCases.map((t) => t.expected.rows.length).join('/');
  const tierIssue = check.ok ? tierProfileIssue(p.sql, p.tier ?? inferTier(p.topics)) : null;
  if (tierIssue) {
    failed++;
    console.log(`✗ ${p.title}: ${tierIssue}`);
  } else if (check.ok) console.log(`✓ [${p.difficulty.padEnd(6)}] ${p.title.padEnd(34)} rows ${rows}`);
  else {
    failed++;
    console.log(`✗ ${p.title}: ${check.reason}`);
  }
}
console.log(failed ? `\n${failed} problem(s) failed verification` : `\nAll ${CURATED.length} curated problems verified.`);
process.exit(failed ? 1 : 0);
