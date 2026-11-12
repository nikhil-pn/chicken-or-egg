// Builds sim/data/daily-index.json, the price series the scouts "see".
// Usage: node sim/build-data.mjs [input.json]
// Day 0 is anchored to the median shop price. Every later day is the previous
// day's UNROUNDED level times (1 + move/100), stored rounded to a whole number.
// This is a same-product price index (aggregate only), not a list of shop prices.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2] ?? join(here, 'data', 'source-index.json');
const out = join(here, 'data', 'daily-index.json');

const raw = JSON.parse(readFileSync(input, 'utf8'));
let hen = 0, egg = 0; // unrounded levels
const rows = raw.map((r, i) => {
  if (i === 0) {
    hen = Math.round(r.ck_med * 100);          // paise per kg
    egg = Math.round(r.eg_med * 12 * 100);     // paise per dozen
  } else {
    hen *= 1 + r.rc / 100;
    egg *= 1 + r.re / 100;
  }
  return {
    d: r.d,
    hen: Math.round(hen),
    egg: Math.round(egg),
    hen_move_pct: i === 0 ? null : r.rc,
    egg_move_pct: i === 0 ? null : r.re,
  };
});
writeFileSync(out, JSON.stringify(rows) + '\n');
console.log(`wrote ${rows.length} rows to ${out}`);
