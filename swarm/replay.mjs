// The replay clock: which recorded day the open round stands for.
import { loadRows } from '../sim/common.mjs';

const rows = loadRows();
export const DAYS = rows.length;

/** A void round is played again, so void rounds do not use up a day. */
export const dayOf = (round, stats) => round.id - 1 - stats.stats.voids;

/** The recorded prices of day `day` (0 is the first), or null when the series is over. */
export const pricesOf = (day) => (rows[day] ? { date: rows[day].d, hen: rows[day].hen, egg: rows[day].egg } : null);
