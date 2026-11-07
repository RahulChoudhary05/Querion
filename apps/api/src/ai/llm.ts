import { z } from 'zod';
import { env } from '../env';

/**
 * Provider-agnostic LLM client.
 *
 * Groq is the primary engine (free tier, very fast). Gemini is an optional
 * backup only. Both expose OpenAI-compatible chat endpoints, so one fetch
 * client covers both — no SDK churn.
 *
 * Every (provider, model) pair is a separate "target" with its own cooldown, so
 * a rate limit on one model just shifts work to the next. Different models are
 * also used to cross-check each other (the forge's blind solve).
 */
export type ProviderName = 'groq' | 'gemini';

export interface Provider {
  /** `${name}:${model}` — unique id of this target. */
  id: string;
  name: ProviderName;
  url: string;
  key: string;
  model: string;
}

const URLS: Record<ProviderName, string> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Models confirmed to exist via the providers' /models endpoints (filled by `discoverModels`). */
let discovered: Record<ProviderName, Set<string> | null> = { groq: null, gemini: null };

export function providers(): Provider[] {
  const out: Provider[] = [];
  for (const name of list(env.AI_PROVIDERS) as ProviderName[]) {
    const key = name === 'groq' ? env.GROQ_API_KEY : name === 'gemini' ? env.GEMINI_API_KEY : undefined;
    if (!key) continue;
    const models = name === 'groq' ? [...new Set([env.GROQ_MODEL, ...list(env.GROQ_MODELS)])] : list(env.GEMINI_MODELS);
    for (const model of models) {
      const known = discovered[name];
      if (known && !known.has(model)) continue; // skip retired / unavailable models
      out.push({ id: `${name}:${model}`, name, url: URLS[name], key, model });
    }
  }
  return out;
}

/** Asks each provider which models exist so retired models are skipped instead of erroring at runtime. */
export async function discoverModels() {
  const probe = async (name: ProviderName, url: string, key?: string) => {
    if (!key) return;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return;
      const data = (await res.json()) as { data?: { id: string }[] };
      const ids = new Set((data.data ?? []).map((m) => m.id.replace(/^models\//, '')));
      if (ids.size) discovered = { ...discovered, [name]: ids };
    } catch {
      /* offline: keep configured list */
    }
  };
  await Promise.all([
    probe('groq', 'https://api.groq.com/openai/v1/models', env.GROQ_API_KEY),
    probe('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/models', env.GEMINI_API_KEY),
  ]);
  return providers().map((p) => p.id);
}

export const aiEnabled = () => providers().length > 0;

/** Targets that hit a rate/quota limit are benched for a while instead of being hammered. */
const cooldown = new Map<string, number>();
const available = (p: Provider) => (cooldown.get(p.id) ?? 0) < Date.now();
export const aiAvailable = () => providers().some(available);

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** Put targets whose id/name contains this first. */
  prefer?: string;
  /** Skip this target id (e.g. the model that wrote the problem) when alternatives exist. */
  avoid?: string;
  /** Reasoning budget for thinking models. Default: as low as possible. */
  reasoning?: 'low' | 'medium';
  /** Latency-sensitive (tutor): try smaller/faster models first. */
  fast?: boolean;
}

export class AiUnavailableError extends Error {}

const FAST = /lite|instant|8b|20b|scout|mini/i;

async function callProvider(p: Provider, messages: ChatMessage[], o: ChatOptions, withReasoning = true): Promise<string> {
  const isGemini = p.name === 'gemini';
  // Reasoning models (gpt-oss on Groq, Gemini 2.5+) spend tokens thinking; give them headroom.
  const thinks = isGemini || /gpt-oss|qwen3|deepseek|r1/i.test(p.model);
  const body: Record<string, unknown> = {
    model: p.model,
    messages,
    temperature: o.temperature ?? 0.4,
    max_tokens: (o.maxTokens ?? 1200) + (thinks && o.reasoning ? 4000 : thinks ? 1000 : 0),
    ...(o.json ? { response_format: { type: 'json_object' } } : {}),
  };
  if (withReasoning && thinks) {
    // Gemini 2.x can switch thinking off; Gemini 3.x rejects "none" (400) — "low" is its floor.
    if (isGemini) body.reasoning_effort = o.reasoning ?? (/gemini-2\./.test(p.model) ? 'none' : 'low');
    else if (/gpt-oss/i.test(p.model)) body.reasoning_effort = o.reasoning ?? 'low';
    // Qwen3 on Groq: keep the <think> trace out of the answer so JSON stays parseable
    else if (/qwen/i.test(p.model)) body.reasoning_format = 'hidden';
  }
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    // some models reject reasoning_effort values — retry once without it
    if (res.status === 400 && withReasoning && ('reasoning_effort' in body || 'reasoning_format' in body)) return callProvider(p, messages, o, false);
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'));
      const daily = /per day|daily|quota|exhausted/i.test(text);
      cooldown.set(p.id, Date.now() + (daily ? 30 * 60_000 : Number.isFinite(retry) && retry > 0 ? retry * 1000 + 500 : 60_000));
    }
    if (res.status === 404) cooldown.set(p.id, Date.now() + 24 * 3600_000); // model retired
    throw new Error(`${p.id} ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const text = data.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new Error(`${p.id}: empty response (finish_reason=${data.choices?.[0]?.finish_reason ?? '?'})`);
  return text;
}

function ordered(o: ChatOptions): Provider[] {
  let l = providers().filter(available);
  if (o.avoid && l.length > 1) l = l.filter((p) => p.id !== o.avoid);
  if (o.fast) l = [...l.filter((p) => FAST.test(p.model)), ...l.filter((p) => !FAST.test(p.model))];
  if (o.prefer) l = [...l.filter((p) => p.id.includes(o.prefer!)), ...l.filter((p) => !p.id.includes(o.prefer!))];
  return l;
}

export async function chat(messages: ChatMessage[], o: ChatOptions = {}): Promise<{ text: string; provider: string }> {
  const targets = ordered(o);
  if (!targets.length) {
    throw new AiUnavailableError(aiEnabled() ? 'All AI models are cooling down after rate limits — try again shortly.' : 'No AI provider configured (set GROQ_API_KEY).');
  }
  const errors: string[] = [];
  for (const [i, p] of targets.entries()) {
    try {
      return { text: await callProvider(p, messages, o), provider: p.id };
    } catch (e) {
      errors.push((e as Error).message);
      // Groq is primary: if its per-minute limit resets soon, wait for it instead of falling back.
      const wait = (cooldown.get(p.id) ?? 0) - Date.now();
      if (i === 0 && p.name === 'groq' && wait > 0 && wait <= 20_000) {
        await new Promise((r) => setTimeout(r, wait));
        cooldown.delete(p.id);
        try {
          return { text: await callProvider(p, messages, o), provider: p.id };
        } catch (e2) {
          errors.push((e2 as Error).message);
        }
      }
    }
  }
  throw new AiUnavailableError(`All AI models failed: ${errors.join(' | ').slice(0, 900)}`);
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw);
}

/** Chat that must return JSON matching `schema`; retries once with the validation error as feedback. */
export async function chatJson<T>(messages: ChatMessage[], schema: z.ZodType<T>, o: ChatOptions = {}): Promise<{ data: T; provider: string }> {
  let convo = [...messages];
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, provider } = await chat(convo, { ...o, json: true });
    try {
      return { data: schema.parse(extractJson(text)), provider };
    } catch (e) {
      lastErr = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
      convo = [
        ...convo,
        { role: 'assistant', content: text },
        { role: 'user', content: `Your reply was not valid for the required JSON schema:\n${lastErr}\nReply again with ONLY the corrected JSON object.` },
      ];
    }
  }
  throw new Error(`Model returned invalid JSON: ${lastErr}`);
}
