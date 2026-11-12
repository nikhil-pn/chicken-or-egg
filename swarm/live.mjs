// The live game's price index. One shelf reading per round is one link of a chain:
// the first link is the middle shop price, every later link moves by the geometric
// mean of the price changes of the products that are on both shelves.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A side needs this many products on both shelves, or the reading is not used. */
export const MIN_MATCHED = 5;

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** How far one side moved between two shelves: { ratio, matched }. Null with too few products. */
export function move(before, today) {
  const ratios = Object.keys(today).filter((key) => before[key] > 0).map((key) => today[key] / before[key]);
  if (ratios.length < MIN_MATCHED) return null;
  const meanLog = ratios.reduce((sum, ratio) => sum + Math.log(ratio), 0) / ratios.length;
  return { ratio: Math.exp(meanLog), matched: ratios.length };
}

/** The link after `prev` (null for the first). Levels are paise per kg and paise per dozen. */
export function link(prev, shelf) {
  if (!prev) {
    const hen = Object.values(shelf.hen);
    const egg = Object.values(shelf.egg);
    if (hen.length < MIN_MATCHED || egg.length < MIN_MATCHED) return null;
    return {
      shelf,
      level: { hen: median(hen) * 100, egg: median(egg) * 1200 },
      matched: { hen: hen.length, egg: egg.length },
    };
  }
  const hen = move(prev.shelf.hen, shelf.hen);
  const egg = move(prev.shelf.egg, shelf.egg);
  if (!hen || !egg) return null;
  return {
    shelf,
    level: { hen: prev.level.hen * hen.ratio, egg: prev.level.egg * egg.ratio },
    matched: { hen: hen.matched, egg: egg.matched },
  };
}

/** The chain on disk, so a restart reports the same numbers. */
export class Chain {
  constructor(file) {
    this.file = file;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { last: null, rounds: {} };
  }

  /** What the scouts report in round `id`, or null before that round's reading. */
  at(id) {
    const round = this.data.rounds[id];
    return round ? { hen: BigInt(round.hen), egg: BigInt(round.egg) } : null;
  }

  /** Adds the reading of round `id`. Returns null when the reading cannot be used. */
  add(id, shelf, now = new Date()) {
    const next = link(this.data.last, shelf);
    if (!next) return null;
    this.data.last = next;
    this.data.rounds[id] = {
      at: now.toISOString(),
      hen: String(Math.round(next.level.hen)),
      egg: String(Math.round(next.level.egg)),
      matched: next.matched,
    };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 1) + '\n');
    return this.at(id);
  }
}
