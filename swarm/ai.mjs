// scout-8's eyes: an open-weight model on NEAR AI Cloud reads the raw shop listings of one
// shelf reading and says which are plain curry-cut chicken and which are plain hen eggs.
// The scout then prices its own picks; the model never sees or sets a number.
// Usage: node swarm/ai.mjs <reading.json>   (a saved readShelf result; needs NEAR_AI_API_KEY)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://cloud-api.near.ai/v1';
/** Open weights, served by NEAR AI itself (`owned_by: nearai` in GET /models). */
export const DEFAULT_MODEL = 'Qwen/Qwen3.8-27B';
const TIMEOUT_MS = 180_000;
/** Asked again this many times after a failure. */
const RETRIES = 2;
/** Room for a reasoning model to think before it writes the two lists. */
const MAX_TOKENS = 8000;

/** Where the model lives and which one. The key is never logged. */
export function settings(env = process.env) {
  return {
    apiKey: env.NEAR_AI_API_KEY || null,
    baseUrl: (env.NEAR_AI_BASE_URL || BASE_URL).replace(/\/+$/, ''),
    model: env.NEAR_AI_MODEL || DEFAULT_MODEL,
  };
}

const pack = (p) => [p.weightInGms && `${p.weightInGms} g`, p.unitCount && `${p.unitCount} pieces`].filter(Boolean).join(', ') || '?';

/** Every listing once, chicken search first, then the egg search. */
const listingsOf = (raw) => [...new Map([...raw.hen, ...raw.egg].map((p) => [p.key, p])).values()];

/** The two baskets in plain words, then one line per listing. */
export function prompt(raw) {
  const lines = listingsOf(raw).map((p) => `${p.key} | ${p.name} | ${pack(p)}`);
  return [
    { role: 'system', content: 'You sort grocery listings from Indian delivery apps into two baskets for a price index. You answer with JSON only.' },
    { role: 'user', content: [
      'Two baskets:',
      '- "hen": raw chicken, curry cut: bone-in pieces of a whole bird, fresh or chilled, with or without skin.',
      '  Not marinated, seasoned or cooked. Not boneless. Not one part only (breast, leg, thigh, wings, drumsticks, lollipop).',
      '  Not mince, not a combo with anything else, not country or kadaknath chicken.',
      '- "egg": packs of plain raw chicken eggs, white or brown, any brand and any pack size.',
      '  Not quail, duck or any other bird. Not boiled or peeled. Not powder or liquid egg. Not a food made with egg.',
      'Leave out every listing that fits neither basket. When unsure, leave it out.',
      '',
      'Answer with one JSON object and nothing else: {"hen": ["<key>", ...], "egg": ["<key>", ...]}.',
      'Copy each key exactly as written before the first "|".',
      '',
      'Listings (key | name | pack):',
      ...lines,
    ].join('\n') },
  ];
}

/** The JSON object in the model's answer, without any thinking around it. */
export function parseAnswer(text) {
  const body = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in the answer');
  const answer = JSON.parse(body.slice(start, end + 1));
  if (!Array.isArray(answer?.hen) || !Array.isArray(answer?.egg)) throw new Error('the answer needs a "hen" and an "egg" list');
  return answer;
}

/**
 * Keeps only real keys, never one on both sides, and only listings that carry the side's unit price:
 * chicken needs a price per kg, eggs a price per egg.
 */
export function validate(answer, raw) {
  const known = new Map(listingsOf(raw).map((p) => [p.key, p]));
  const hen = new Set(answer.hen.map(String));
  const egg = new Set(answer.egg.map(String));
  const keep = (keys, other, unit) => [...keys].filter((key) => !other.has(key) && known.get(key)?.[unit] > 0);
  const picks = { hen: keep(hen, egg, 'pricePerKg'), egg: keep(egg, hen, 'pricePerUnit') };
  return { ...picks, dropped: hen.size + egg.size - picks.hen.length - picks.egg.length };
}

/** The scout's own basket: { hen: { key: rupees per kg }, egg: { key: rupees per egg } }. */
export function basketOf(raw, picks) {
  const known = new Map(listingsOf(raw).map((p) => [p.key, p]));
  const side = (keys, unit) => Object.fromEntries(keys.map((key) => [key, known.get(key)[unit]]));
  return { hen: side(picks.hen, 'pricePerKg'), egg: side(picks.egg, 'pricePerUnit') };
}

/** One OpenAI-style chat call. Errors that asking again cannot fix are marked `fatal`. */
async function chat({ apiKey, baseUrl, model }, messages, { fetch, timeoutMs }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0, max_tokens: MAX_TOKENS, messages }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${String(body.error?.message ?? body.detail ?? 'no detail').slice(0, 120)}`);
    error.fatal = [400, 401, 403, 404].includes(response.status);
    throw error;
  }
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error('the model sent an empty answer');
  return { model: body.model ?? model, text };
}

/** Asks the model which raw listings go in each basket: { model, hen: [keys], egg: [keys] }. Throws when it cannot. */
export async function pickBaskets(raw, opts = {}) {
  const { env = process.env, fetch = globalThis.fetch, log = () => {}, timeoutMs = TIMEOUT_MS, retries = RETRIES, retryMs = 5000 } = opts;
  const config = settings(env);
  if (!config.apiKey) throw new Error('NEAR_AI_API_KEY is not set');
  const messages = prompt(raw);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { model, text } = await chat(config, messages, { fetch, timeoutMs });
      const picks = validate(parseAnswer(text), raw);
      log(`ai: ${model} picked ${picks.hen.length} of ${raw.hen.length} chicken and ${picks.egg.length} of ${raw.egg.length} egg listings`
        + (picks.dropped ? ` (${picks.dropped} keys dropped as invalid)` : ''));
      return { model, hen: picks.hen, egg: picks.egg };
    } catch (error) {
      if (error.fatal || attempt >= retries) throw error;
      log(`ai: try ${attempt + 1} failed (${error.message}), asking again`);
      await new Promise((done) => setTimeout(done, retryMs * (attempt + 1)));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reading = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const picks = await pickBaskets(reading.raw, { log: console.error });
  // How the model's picks compare with the tracker's filters on the same reading.
  for (const side of ['hen', 'egg']) {
    const filter = new Set(Object.keys(reading[side]));
    const both = picks[side].filter((key) => filter.has(key)).length;
    console.error(`${side}: model ${picks[side].length}, filter ${filter.size}, both ${both}`);
  }
  console.log(JSON.stringify(picks));
}
