// Shared by the run-* scripts: load the series and compute the "true" result of each round.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { movePpm, decide, COIN, NEAR } from './engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const loadRows = () =>
  JSON.parse(readFileSync(join(here, 'data', 'daily-index.json'), 'utf8')).map((r) => ({
    ...r, hen: BigInt(r.hen), egg: BigInt(r.egg) }));

/** True result of every round under the integer rules: round 1 is BASELINE, then HEN/EGG/TIE. */
export function truthResults(rows, tieBps) {
  return rows.map((r, i) => i === 0 ? 'BASELINE'
    : decide(movePpm(rows[i - 1].hen, r.hen), movePpm(rows[i - 1].egg, r.egg), tieBps));
}
export function writeOut(name, obj) {
  mkdirSync(join(here, 'out'), { recursive: true });
  writeFileSync(join(here, 'out', name), JSON.stringify(obj) + '\n');
}
export const coins = (b) => Number(b / (COIN / 100n)) / 100;   // BigInt wei -> number, 2 decimals
export const near = (b) => Number(b / (NEAR / 1000n)) / 1000;  // yocto -> NEAR, 3 decimals
export const fmt = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const pad = (s, n) => String(s).padStart(n);
