// Scripted scout and player behaviours. Everything random comes from a seeded PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const scale = (p, bps) => (p * BigInt(10000 + bps)) / 10000n;

// ---- scouts ----
// A scout is a function ctx -> { hen, egg } | { sealed: true } | null (did nothing).
// ctx = { truth: {hen, egg}, last: {hen, egg} | null, round }
export const SCOUT_KINDS = ['honest', 'noisy', 'lazy', 'liar', 'ring'];

/** A ring: all members report the SAME false number each round. The ring picks a side at random
 *  and pushes it: that coin 4% above the last good price, the other 4% below. */
export function makeRing(seed) {
  const rng = mulberry32(seed);
  const cache = new Map();
  return (ctx) => {
    if (!cache.has(ctx.round)) {
      const base = ctx.last ?? ctx.truth, henSide = rng() < 0.5;
      cache.set(ctx.round, { hen: scale(base.hen, henSide ? 400 : -400), egg: scale(base.egg, henSide ? -400 : 400) });
    }
    return { ...cache.get(ctx.round) };
  };
}
export function makeScout(kind, rng, ring) {
  switch (kind) {
    case 'honest': return ({ truth }) => ({ ...truth });
    case 'noisy': return ({ truth }) => ({
      hen: scale(truth.hen, Math.round((rng() * 2 - 1) * 50)),
      egg: scale(truth.egg, Math.round((rng() * 2 - 1) * 50)) });
    case 'lazy': return ({ truth }) => {
      const x = rng();
      if (x < 0.2) return null;                 // skips
      if (x < 0.3) return { sealed: true };     // seals, never reveals
      return { ...truth };
    };
    case 'liar': return ({ truth }) => ({ hen: scale(truth.hen, 800), egg: truth.egg }); // +8% to favour HEN
    case 'ring': return ring;
    default: throw new Error('unknown scout kind ' + kind);
  }
}

// ---- players ----
// A player is a function ctx -> 'HEN' | 'EGG'.
// ctx = { prevWinner: 'HEN'|'EGG'|null (last decisive result), truthResult }
export const PLAYER_KINDS = ['random', 'momentum', 'contrarian', 'always_hen', 'always_egg', 'sharp'];
const flip = (s) => (s === 'HEN' ? 'EGG' : 'HEN');
export function makePlayer(kind, rng) {
  const coin = () => (rng() < 0.5 ? 'HEN' : 'EGG');
  switch (kind) {
    case 'random': return coin;
    case 'momentum': return ({ prevWinner }) => prevWinner ?? coin();
    case 'contrarian': return ({ prevWinner }) => (prevWinner ? flip(prevWinner) : coin());
    case 'always_hen': return () => 'HEN';
    case 'always_egg': return () => 'EGG';
    case 'sharp': return ({ truthResult }) => {
      if (truthResult !== 'HEN' && truthResult !== 'EGG') return coin();
      return rng() < 0.65 ? truthResult : flip(truthResult);
    };
    default: throw new Error('unknown player kind ' + kind);
  }
}
