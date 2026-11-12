// Where a scout gets its prices. A source is ctx -> { hen, egg } | { sealed: true } | null,
// with ctx = { truth: { hen, egg }, last: { hen, egg } | null, round, raw }.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeScout, mulberry32 } from '../sim/strategies.mjs';
import { basketOf, pickBaskets } from './ai.mjs';
import { MIN_MATCHED, link } from './live.mjs';

/** The same scripted behaviours the simulation uses: honest, noisy, lazy, liar. No LLM calls. */
export const scripted = (kind, seed) => makeScout(kind, mulberry32(seed));

/** The same scripts, seeded again in every round, so a restart in a long round changes nothing. */
export const perRound = (kind, seed) => (ctx) => makeScout(kind, mulberry32(seed * 7919 + ctx.round))(ctx);

/**
 * The AI scout. A model picks its own products from the round's raw listings (ctx.raw), and the
 * scout keeps its own chain of them in `file`. Its first good reading starts at the shared index
 * of that round (ctx.truth); after that only its own picks move it. Null means: no report this round.
 * Each round is decided once and written down, so a restart never asks twice or reports something else.
 */
export function aiSource({ file, ask = pickBaskets, log = () => {}, now = () => new Date() }) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { last: null, rounds: {} };
  const report = (entry) => (entry.hen ? { hen: BigInt(entry.hen), egg: BigInt(entry.egg) } : null);
  const decide = (id, entry, last = data.last) => {
    data.last = last;
    data.rounds[id] = { at: now().toISOString(), ...entry };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
    return report(data.rounds[id]);
  };
  const skip = (id, why) => {
    log(`ai: no report in round ${id}: ${why}`);
    return decide(id, { skip: why });
  };

  return async (ctx) => {
    const done = data.rounds[ctx.round];
    if (done) return report(done);
    if (!ctx.raw?.hen?.length || !ctx.raw?.egg?.length) return skip(ctx.round, 'no raw listings for this round');
    if (!data.last && !ctx.truth) return skip(ctx.round, 'no shared index to start from');
    let picks;
    try {
      picks = await ask(ctx.raw, { log });
    } catch (error) {
      return skip(ctx.round, `no answer from the model (${String(error.message).slice(0, 160)})`);
    }
    const next = link(data.last, basketOf(ctx.raw, picks));
    if (!next) return skip(ctx.round, `fewer than ${MIN_MATCHED} picked products on a side${data.last ? ' match its last picks' : ''}`);
    // The first link starts in agreement with the other scouts; its level is not the median of its picks.
    if (!data.last) next.level = { hen: Number(ctx.truth.hen), egg: Number(ctx.truth.egg) };
    const entry = {
      model: picks.model, picks: { hen: picks.hen, egg: picks.egg }, matched: next.matched,
      hen: String(Math.round(next.level.hen)), egg: String(Math.round(next.level.egg)),
    };
    log(`ai: round ${ctx.round} index hen ${entry.hen} egg ${entry.egg} (matched ${next.matched.hen} + ${next.matched.egg})`);
    return decide(ctx.round, entry, next);
  };
}
