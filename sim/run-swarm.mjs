// Scout swarm market, no LLM calls: 20 scripted scouts over the full real series.
// Usage: node sim/run-swarm.mjs [--slash <bps>]
import { createCoop, registerScout, settle, audit, isBenched, NEAR } from './engine.mjs';
import { mulberry32, makeScout, makeRing } from './strategies.mjs';
import { loadRows, truthResults, writeOut, coins, near, fmt, pad } from './common.mjs';

const ROWS = loadRows(), SEED = 77;
// Recommended parameters from docs/SIMULATION.md.
const PARAMS = { hatch_bps: 300, fry_bps: 300, tie_bps: 10, tolerance_bps: 100, slash_bps: 1000,
  min_reveals: 3, scout_pay: 100n * 10n ** 18n, scout_bond: 10n * NEAR, min_bond: 5n * NEAR };
// Optional sensitivity run: node sim/run-swarm.mjs --slash 1000   (does not overwrite out/swarm.json)
const si = process.argv.indexOf('--slash');
if (si > 0) PARAMS.slash_bps = Number(process.argv[si + 1]);
export const SCENARIOS = {
  'a) healthy: 14 honest, 3 noisy, 2 lazy, 1 liar': { honest: 14, noisy: 3, lazy: 2, liar: 1 },
  'b) ring of 5 liars among 20': { honest: 11, noisy: 2, lazy: 2, ring: 5 },
  'c) ring of 11 among 20 (majority)': { honest: 6, noisy: 2, lazy: 1, ring: 11 },
};

export function runSwarm(mixture, params = PARAMS) {
  const st = createCoop(params);
  const ring = makeRing(SEED);
  const scouts = [];
  let i = 0;
  for (const [kind, n] of Object.entries(mixture)) for (let k = 0; k < n; k++, i++) {
    const id = `${kind}${k}`;
    registerScout(st, id, 'f' + id, 10n * NEAR);
    scouts.push({ id, kind, act: makeScout(kind, mulberry32(SEED + i), ring), benchedRound: null });
  }
  const truth = truthResults(ROWS, st.cfg.tie_bps);
  const counts = { HEN: 0, EGG: 0, TIE: 0, BASELINE: 0, VOID: 0 };
  let differ = 0, firstLiarBenched = null;
  ROWS.forEach((row, r) => {
    const reports = [];
    for (const s of scouts) {
      if (isBenched(st, s.id)) continue;
      const rep = s.act({ truth: { hen: row.hen, egg: row.egg }, last: st.last, round: r + 1 });
      if (rep) reports.push({ scout: s.id, ...rep });
    }
    const res = settle(st, reports);
    audit(st);
    counts[res.result]++;
    if (res.result !== truth[r]) differ++;
    for (const s of scouts) if (s.benchedRound === null && isBenched(st, s.id)) s.benchedRound = r + 1;
  });
  const byKind = {};
  for (const s of scouts) {
    const sc = st.scouts.get(s.id);
    const k = (byKind[s.kind] ??= { count: 0, bond: 0, near: 0, coins: 0, benched: 0, benchedRounds: [] });
    k.count++; k.bond += near(sc.bond); k.near += near(sc.near_earned);
    k.coins += coins(sc.coins_earned.hen + sc.coins_earned.egg);
    if (s.benchedRound !== null) { k.benched++; k.benchedRounds.push(s.benchedRound); }
  }
  for (const k of Object.values(byKind)) {
    k.avg_bond = +(k.bond / k.count).toFixed(3); k.avg_near_earned = +(k.near / k.count).toFixed(3);
    k.avg_coins_earned = +(k.coins / k.count).toFixed(1);
    k.first_benched_round = k.benchedRounds.length ? Math.min(...k.benchedRounds) : null;
    delete k.bond; delete k.near; delete k.coins;
  }
  return { rounds: ROWS.length, counts, differ_from_truth: differ, by_kind: byKind, pot_left: near(st.pot) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = {};
  for (const [name, mix] of Object.entries(SCENARIOS)) {
    const r = runSwarm(mix);
    out[name] = r;
    console.log(`\n=== ${name} ===`);
    console.log(`rounds ${r.rounds}: ` + Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(' ')
      + `  | differ from truth: ${r.differ_from_truth}  | pot left: ${r.pot_left} NEAR`);
    console.log(['kind'.padEnd(8), pad('count', 5), pad('avg bond', 9), pad('NEAR earned', 12), pad('coins earned', 13), pad('benched', 8), pad('1st benched', 12)].join(' '));
    for (const [k, v] of Object.entries(r.by_kind))
      console.log([k.padEnd(8), pad(v.count, 5), pad(v.avg_bond, 9), pad(v.avg_near_earned, 12), pad(fmt(v.avg_coins_earned, 1), 13),
        pad(`${v.benched}/${v.count}`, 8), pad(v.first_benched_round ?? '-', 12)].join(' '));
  }
  if (si > 0) process.exit(0);
  writeOut('swarm.json', { params: Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, String(v)])), scenarios: out });
  console.log('\nwrote sim/out/swarm.json');
}
