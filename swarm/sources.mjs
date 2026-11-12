// Where a scout gets its prices. A source is ctx -> { hen, egg } | { sealed: true } | null,
// with ctx = { truth: { hen, egg }, last: { hen, egg } | null, round }.
import { makeScout, mulberry32 } from '../sim/strategies.mjs';

/** The same scripted behaviours the simulation uses: honest, noisy, lazy, liar. No LLM calls. */
export const scripted = (kind, seed) => makeScout(kind, mulberry32(seed));

/** The same scripts, seeded again in every round, so a restart in a long round changes nothing. */
export const perRound = (kind, seed) => (ctx) => makeScout(kind, mulberry32(seed * 7919 + ctx.round))(ctx);
