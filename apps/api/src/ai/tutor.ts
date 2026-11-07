import { z } from 'zod';
import { describeSchema, explainError, fingerprint, type Dataset, type JudgeReport, type SqlError } from '@querion/engine';
import type { ProblemRow } from '../db/repo';
import { aiEnabled, chat, chatJson } from './llm';

/**
 * The AI tutor. Every feature has a deterministic offline fallback, and every
 * AI output passes a leak guard so a hint can never hand over the answer.
 */

const TUTOR_SYSTEM = `You are the SQL tutor inside the Querion practice studio — a senior data engineer who coaches with the Socratic method. Address the learner directly as "you".
Database: PostgreSQL 17. You are precise, warm and brief. Use Markdown. Wrap identifiers in backticks.
NEVER reveal the full solution query unless explicitly allowed.`;

function problemContext(p: ProblemRow, ds: Dataset) {
  return `PROBLEM: ${p.title} (${p.difficulty}; topics: ${p.topics.join(', ')})
${p.statement}

REQUIRED OUTPUT COLUMNS (in order): ${p.output_columns.join(', ')}

SCHEMA:
${describeSchema(ds, 2)}`;
}

/** Rough token-overlap check: does `text` contain something close to the reference query? */
export function leaksSolution(text: string, referenceSql: string): boolean {
  const ref = new Set(fingerprint(referenceSql).split(' ').filter((t) => t.length > 1));
  const blocks = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  const candidates = blocks.length ? blocks : [text];
  return candidates.some((b) => {
    const toks = fingerprint(b).split(' ').filter((t) => t.length > 1);
    if (toks.length < 8) return false;
    const hit = toks.filter((t) => ref.has(t)).length;
    const complete = /\bselect\b[\s\S]*\bfrom\b/i.test(b) && !/___/.test(b);
    return complete && hit / ref.size > 0.7;
  });
}

const LEVEL_GUIDE: Record<number, string> = {
  1: 'Level 1 — NUDGE: one or two sentences pointing at the key idea or the table(s) to look at. No SQL at all.',
  2: 'Level 2 — CONCEPT: name the SQL concepts/clauses needed and the order of steps (max 4 bullets). You may mention function names, but no full clauses.',
  3: 'Level 3 — SKELETON: give a query skeleton in a ```sql block where the important parts are replaced with ___ blanks. It must NOT run as-is.',
};

export async function hint(p: ProblemRow, ds: Dataset, level: 1 | 2 | 3, userSql: string, lastError?: string) {
  const stored = p.hints[level - 1];
  if (!aiEnabled()) return { text: stored, source: 'curated' as const };
  try {
    const { text, provider } = await chat(
      [
        { role: 'system', content: TUTOR_SYSTEM },
        {
          role: 'user',
          content: `${problemContext(p, ds)}

LEARNER'S CURRENT SQL:
\`\`\`sql
${userSql || '-- (empty)'}
\`\`\`
${lastError ? `LAST RESULT/ERROR: ${lastError}\n` : ''}
Give a personalised hint for THIS learner's attempt. ${LEVEL_GUIDE[level]}
If their SQL is already on the right track, say what is right and what single thing to change next. Keep it under 90 words.`,
        },
      ],
      { temperature: 0.3, maxTokens: 400, fast: true }
    );
    if (leaksSolution(text, p.reference_sql)) return { text: stored, source: 'curated' as const };
    return { text, source: provider };
  } catch {
    return { text: stored, source: 'curated' as const };
  }
}

export async function explainFailure(p: ProblemRow, ds: Dataset, userSql: string, error: SqlError | null, verdict?: JudgeReport) {
  const insight = error ? explainError(error, userSql, ds) : null;
  if (!aiEnabled()) return { insight, ai: null };
  const failing = verdict?.cases.find((c) => c.verdict !== 'ACCEPTED');
  const evidence = error
    ? `Postgres error: ${error.message}${error.code ? ` (SQLSTATE ${error.code})` : ''}`
    : failing
      ? `Wrong answer on test "${failing.label}": ${failing.message}\nMissing rows (expected but not returned): ${JSON.stringify(failing.diff?.missing ?? []).slice(0, 600)}\nExtra rows (returned but not expected): ${JSON.stringify(failing.diff?.extra ?? []).slice(0, 600)}`
      : 'Unknown failure';
  try {
    const { text, provider } = await chat(
      [
        { role: 'system', content: TUTOR_SYSTEM },
        {
          role: 'user',
          content: `${problemContext(p, ds)}

LEARNER'S SQL:
\`\`\`sql
${userSql}
\`\`\`
WHAT HAPPENED: ${evidence}

Explain the ROOT CAUSE in plain language (2–4 sentences), then give "**Try:**" with one concrete next step. Point at the exact clause or line. Do not write the corrected full query. Under 110 words.`,
        },
      ],
      { temperature: 0.2, maxTokens: 450, fast: true }
    );
    return { insight, ai: leaksSolution(text, p.reference_sql) ? null : { text, provider } };
  } catch {
    return { insight, ai: null };
  }
}

const ReviewSchema = z.object({
  verdict_summary: z.string(),
  strengths: z.array(z.string()).max(4),
  improvements: z.array(z.string()).max(4),
  complexity: z.string(),
  alternative_approach: z.string().nullable().optional(),
  alternative_sql: z.string().nullable().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;

/** Code review after an accepted solution — compares against the reference and the planner costs. */
export async function review(p: ProblemRow, ds: Dataset, userSql: string, report: JudgeReport): Promise<Review & { provider: string }> {
  const eff = report.efficiency;
  const fallback = (): Review & { provider: string } => ({
    verdict_summary: 'Accepted — your query returns the right answer on every hidden dataset.',
    strengths: ['Correct on all test cases, including the hidden ones.'],
    improvements: eff && eff.ratio > 1.25 ? [`Your plan is ~${eff.ratio.toFixed(1)}× the reference cost. Look for repeated subqueries or joins that could be aggregated earlier.`] : [],
    complexity: eff ? `Planner cost ${eff.userCost.toFixed(1)} vs reference ${eff.referenceCost.toFixed(1)}.` : 'n/a',
    alternative_approach: p.explanation,
    alternative_sql: p.reference_sql,
    provider: 'offline',
  });
  if (!aiEnabled()) return fallback();
  try {
    const { data, provider } = await chatJson(
      [
        { role: 'system', content: `${TUTOR_SYSTEM}\nThe learner SOLVED the problem, so you may now show alternative SQL.` },
        {
          role: 'user',
          content: `${problemContext(p, ds)}

LEARNER'S ACCEPTED SQL:
\`\`\`sql
${userSql}
\`\`\`
REFERENCE SQL:
\`\`\`sql
${p.reference_sql}
\`\`\`
PLANNER COST: learner ${eff?.userCost ?? 'n/a'} vs reference ${eff?.referenceCost ?? 'n/a'}

Review like a senior engineer in a code review. Return JSON:
{"verdict_summary": string (1 sentence), "strengths": string[] (<=3), "improvements": string[] (<=3, concrete: readability, NULL-safety, performance, portability),
 "complexity": string (1-2 sentences on how Postgres executes it and the cost difference),
 "alternative_approach": string|null (a genuinely different technique, 1-2 sentences), "alternative_sql": string|null}`,
        },
      ],
      ReviewSchema,
      { temperature: 0.3, maxTokens: 900 }
    );
    return { ...data, provider };
  } catch {
    return fallback();
  }
}

/** Free-form question to the tutor about the current problem. */
export async function ask(p: ProblemRow, ds: Dataset, question: string, userSql: string, solved: boolean) {
  if (!aiEnabled()) {
    return {
      text: 'The AI tutor needs a free Groq or Gemini key on the server. Meanwhile: use the hint ladder, the schema explorer, and the error insights.',
      provider: 'offline',
    };
  }
  const { text, provider } = await chat(
    [
      { role: 'system', content: TUTOR_SYSTEM + (solved ? '\nThe learner already solved it; full solutions are allowed.' : '') },
      {
        role: 'user',
        content: `${problemContext(p, ds)}

LEARNER'S CURRENT SQL:
\`\`\`sql
${userSql || '-- (empty)'}
\`\`\`
LEARNER ASKS: ${question.slice(0, 800)}

Answer helpfully in under 150 words. ${solved ? '' : 'Teach the concept with a tiny example on a DIFFERENT toy table if useful, but do not solve this problem.'}`,
      },
    ],
    { temperature: 0.4, maxTokens: 600, fast: true }
  );
  if (!solved && leaksSolution(text, p.reference_sql)) {
    return { text: "I'd be giving the answer away there 🙂 — try the level 3 hint for a skeleton instead.", provider };
  }
  return { text, provider };
}
