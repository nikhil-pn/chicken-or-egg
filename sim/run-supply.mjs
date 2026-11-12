// 60-day supply simulation: parameter grid x crowd behaviours. Prints a table, writes out/supply.json.
// Usage: node sim/run-supply.mjs
import { createCoop, registerScout, starterPack, roost, claim, settle, audit, wallet, COIN, NEAR } from './engine.mjs';
import { mulberry32, makePlayer } from './strategies.mjs';
import { loadRows, truthResults, writeOut, coins, fmt, pad } from './common.mjs';

const ROWS = loadRows();
const PLAYERS = 200, SEED = 2026, HEADLINE_ROWS = 60;
export const GRID = [[200, 200], [300, 300], [500, 300], [300, 500], [1000, 1000]];
// share = fraction of players, kind = behaviour, frac = share of coins roosted each round.
const mix = (frac) => [['random', .25], ['momentum', .25], ['contrarian', .15], ['always_hen', .1],
  ['always_egg', .1], ['sharp', .15]].map(([kind, share]) => ({ kind, share, frac }));
export const CROWDS = {
  mixed: mix(0.5),
  'all momentum': [{ kind: 'momentum', share: 1, frac: 0.5 }],
  'all sharp': [{ kind: 'sharp', share: 1, frac: 0.5 }],
  'all one side': [{ kind: 'always_hen', share: 1, frac: 0.5 }],
  'low part. 10%': mix(0.1),
  'high part. 90%': mix(0.9),
};

/** Run one scenario over `rows`; returns daily supply (index 0 = before round 1) and totals. */
export function runScenario(rows, [hatch_bps, fry_bps], crowd, extra = {}) {
  const st = createCoop({ hatch_bps, fry_bps, ...extra });
  for (let i = 0; i < 5; i++) registerScout(st, 's' + i, 'f' + i, 10n * NEAR);
  const truth = truthResults(rows, st.cfg.tie_bps);
  // assign behaviours to players by share
  const players = [];
  let n = 0;
  for (const g of crowd) {
    const count = Math.round(g.share * PLAYERS);
    for (let k = 0; k < count && n < PLAYERS; k++, n++)
      players.push({ id: 'p' + n, act: makePlayer(g.kind, mulberry32(SEED + n)), bps: BigInt(Math.round(g.frac * 10000)) });
  }
  players.forEach((p) => starterPack(st, p.id));
  const hen = [coins(st.supply.hen)], egg = [coins(st.supply.egg)];
  const start = { hen: st.supply.hen, egg: st.supply.egg };
  let prevWinner = null;
  rows.forEach((row, i) => {
    for (const p of players) {
      const side = p.act({ prevWinner, truthResult: truth[i] });
      claim(st, p.id);                       // collect last round's roost, then roost a share of the wallet
      const c = side === 'HEN' ? 'hen' : 'egg';
      const amt = (wallet(st, p.id)[c] * p.bps) / 10000n;
      if (amt > 0n) roost(st, p.id, side, amt);
    }
    settle(st, [...st.scouts.keys()].map((s) => ({ scout: s, hen: row.hen, egg: row.egg })));
    audit(st);
    if (truth[i] === 'HEN' || truth[i] === 'EGG') prevWinner = truth[i];
    hen.push(coins(st.supply.hen)); egg.push(coins(st.supply.egg));
  });
  const sum = (kind, coin, sign) => st.ledger.filter((e) => e.kind === kind && e.coin === coin)
    .reduce((a, e) => a + (sign * e.amount), 0n);
  return { st, hen, egg, start, hatched: sum('hatch', 'hen', 1n) + sum('hatch', 'egg', 1n) + sum('scout_pay', 'hen', 1n) + sum('scout_pay', 'egg', 1n),
    burned: sum('fry', 'hen', -1n) + sum('fry', 'egg', -1n) };
}

function run(label, rows) {
  console.log(`\n=== ${label}: ${rows.length} rounds (1 baseline + ${rows.length - 1} decided), ${PLAYERS} players ===`);
  console.log('Supply in coins. d30/d60 = after round 30 / 60 (round 1 is the baseline). Start = 200,000 of each coin.');
  console.log(['crowd'.padEnd(15), 'h/f'.padEnd(10), pad('HEN d30', 9), pad('HEN d60', 9), pad('HEN end', 9), pad('HEN max', 9), pad('HEN min', 9),
    pad('EGG d30', 9), pad('EGG d60', 9), pad('EGG end', 9), pad('EGG max', 9), pad('EGG min', 9), pad('minted', 8), pad('burned', 8)].join(' '));
  const out = [];
  for (const [cname, crowd] of Object.entries(CROWDS)) for (const g of GRID) {
    const r = runScenario(rows, g, crowd);
    const L = rows.length;
    const f = (x) => pad(fmt(x / 1000, 1) + 'k', 9);
    console.log([cname.padEnd(15), `${g[0]}/${g[1]}`.padEnd(10), f(r.hen[Math.min(30, L)]), f(r.hen[Math.min(60, L)]), f(r.hen[L]),
      f(Math.max(...r.hen)), f(Math.min(...r.hen)), f(r.egg[Math.min(30, L)]), f(r.egg[Math.min(60, L)]), f(r.egg[L]),
      f(Math.max(...r.egg)), f(Math.min(...r.egg)), f(coins(r.hatched)), f(coins(r.burned))].join(' '));
    out.push({ crowd: cname, hatch_bps: g[0], fry_bps: g[1], hen: r.hen.map(Math.round), egg: r.egg.map(Math.round),
      minted: Math.round(coins(r.hatched)), burned: Math.round(coins(r.burned)) });
  }
  return out;
}

/** HEN/EGG/TIE counts and longest streak on the real series, for several tie thresholds. */
export function seriesSummary(rows, tieList = [0, 5, 10, 25, 50]) {
  return tieList.map((tie) => {
    const t = truthResults(rows, tie).slice(1); // drop the baseline
    const n = { HEN: 0, EGG: 0, TIE: 0 };
    let best = { len: 0, side: null }, cur = { len: 0, side: null };
    for (const r of t) {
      n[r]++;
      cur = r === cur.side ? { len: cur.len + 1, side: r } : { len: 1, side: r };
      if (r !== 'TIE' && cur.len > best.len) best = { ...cur };
    }
    return { tie_bps: tie, pairs: t.length, ...n, longest_streak: best.len, streak_side: best.side };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Real series under the integer rules (round 1 = baseline, then one result per day-pair):');
  const series = seriesSummary(ROWS);
  for (const x of series) console.log(`  tie_bps=${pad(x.tie_bps, 2)}  pairs=${x.pairs}  HEN=${x.HEN}  EGG=${x.EGG}  TIE=${x.TIE}  longest streak=${x.longest_streak} ${x.streak_side}`);
  const headline = run(`HEADLINE (first ${HEADLINE_ROWS} priced days)`, ROWS.slice(0, HEADLINE_ROWS));
  const full = run('FULL SERIES', ROWS);
  writeOut('supply.json', { series, note: 'daily supply in coins; index 0 = before round 1', players: PLAYERS, headline, full });
  console.log('\nwrote sim/out/supply.json');
}
