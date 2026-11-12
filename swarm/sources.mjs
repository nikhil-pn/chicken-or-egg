// Where a scout gets its prices. A source is ctx -> { hen, egg } | { sealed: true } | null,
// with ctx = { truth: { hen, egg }, last: { hen, egg } | null, round }.
import { makeScout, mulberry32 } from '../sim/strategies.mjs';

/** The same scripted behaviours the simulation uses: honest, noisy, lazy, liar. No LLM calls. */
export const scripted = (kind, seed) => makeScout(kind, mulberry32(seed));
