// Checks a game against RULES.md, using nothing but what the chain says.
// Usage: node scripts/audit.mjs deploy/replay.json [--replay]
// With --replay it also checks every round against the recorded days.
import { readFileSync, writeFileSync } from 'node:fs';
import { view } from '../lib/near.mjs';
import { show } from '../lib/units.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/audit.mjs deploy/<game>.json [--replay]');
const lock = JSON.parse(readFileSync(file.replace(/\.json$/, '.lock.json'), 'utf8'));
const { coop, hen, egg } = lock;
const B = BigInt;
const abs = (x) => (x < 0n ? -x : x);

async function all(method) {
  const rows = [];
  for (;;) {
    const page = await view(coop, method, { from: rows.length, limit: 100 });
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

const config = await view(coop, 'get_config');
const stats = await view(coop, 'get_stats');
const history = (await all('get_history')).slice(0, stats.rounds_settled);
const ledger = await all('get_ledger');
const failures = [];
const check = (ok, text) => ok || failures.push(text);

// 1. Every round: the result follows from the prices, and the coins follow from the result.
const tally = { baseline: 0, void: 0, tie: 0, hen: 0, egg: 0 };
const decided = []; // rounds that had prices, in order
let last = null;
for (const r of history) {
  tally[r.outcome] += 1;
  const minted = { hen: B(r.minted_hen), egg: B(r.minted_egg) };
  const burned = { hen: B(r.burned_hen), egg: B(r.burned_egg) };
  const roosted = { hen: B(r.hen_roosted), egg: B(r.egg_roosted) };
  if (r.outcome === 'void') {
    check(r.reveals < config.min_reveals, `round ${r.id}: void with ${r.reveals} reports`);
  } else {
    const now = { hen: B(r.hen_price), egg: B(r.egg_price) };
    let expected = 'baseline';
    if (last) {
      const henMove = ((now.hen - last.hen) * 1_000_000n) / last.hen;
      const eggMove = ((now.egg - last.egg) * 1_000_000n) / last.egg;
      check(henMove === B(r.hen_move_ppm) && eggMove === B(r.egg_move_ppm), `round ${r.id}: moves`);
      expected = abs(henMove - eggMove) < B(config.tie_bps) * 100n ? 'tie' : henMove > eggMove ? 'hen' : 'egg';
    }
    check(r.outcome === expected, `round ${r.id}: outcome ${r.outcome}, the prices say ${expected}`);
    last = now;
    decided.push(r);
  }
  const won = r.outcome === 'hen' || r.outcome === 'egg' ? r.outcome : null;
  for (const side of ['hen', 'egg']) {
    const pay = won === side && r.honest > 0 ? (B(config.scout_pay) / B(r.honest)) * B(r.honest) : 0n;
    const hatch = won === side ? (roosted[side] * B(config.hatch_bps)) / 10_000n : 0n;
    const fry = won && won !== side ? (roosted[side] * B(config.fry_bps)) / 10_000n : 0n;
    check(minted[side] === hatch + pay, `round ${r.id}: minted ${side}`);
    check(burned[side] === fry, `round ${r.id}: burned ${side}`);
  }
}

// 2. The mint and burn log adds up to the rounds, and to the supply of each coin.
const supply = { hen: B(await view(hen, 'ft_total_supply')), egg: B(await view(egg, 'ft_total_supply')) };
const logged = { hen: { in: 0n, out: 0n }, egg: { in: 0n, out: 0n } };
for (const line of ledger) logged[line.coin][line.kind === 'fry' ? 'out' : 'in'] += B(line.amount);
for (const side of ['hen', 'egg']) {
  check(logged[side].in === B(stats.stats[`minted_${side}`]), `${side}: log mints differ from the stats`);
  check(logged[side].out === B(stats.stats[`burned_${side}`]), `${side}: log burns differ from the stats`);
  check(logged[side].in - logged[side].out === supply[side], `${side}: supply differs from mints minus burns`);
  const rounds = history.reduce((sum, r) => sum + B(r[`minted_${side}`]), 0n);
  const starters = ledger.filter((l) => l.kind === 'starter' && l.coin === side).reduce((s, l) => s + B(l.amount), 0n);
  check(rounds + starters === logged[side].in, `${side}: rounds plus starter packs differ from the log`);
}

// 3. The coop holds at least every coin it owes to the accounts we know.
const dust = {};
const people = [...new Set([...(lock.players ?? []), ...(lock.scouts ?? [])])];
const round = await view(coop, 'get_round');
for (const [side, coin] of [['hen', hen], ['egg', egg]]) {
  let owed = 0n;
  for (const id of people) {
    const p = await view(coop, 'get_player', { account_id: id });
    if (p) owed += B(p[`nest_${side}`]) + (p.roost?.side === side ? B(p.roost.amount) : 0n);
  }
  for (const s of await view(coop, 'get_scouts')) owed += B(s[`earned_${side}`]);
  dust[side] = B(await view(coin, 'ft_balance_of', { account_id: coop })) - owed;
  check(dust[side] >= 0n, `${side}: the coop owes more than it holds`);
}

// 4. Replay only: each round with prices is the next recorded day.
let days = null;
if (process.argv.includes('--replay')) {
  const { pricesOf, truths } = await import('../swarm/replay.mjs');
  const truth = truths(config.tie_bps);
  decided.forEach((r, day) => {
    const want = pricesOf(day);
    check(B(r.hen_price) === want.hen && B(r.egg_price) === want.egg, `round ${r.id}: prices differ from ${want.date}`);
    check(r.outcome.toUpperCase() === truth[day], `round ${r.id}: ${r.outcome}, the record says ${truth[day]}`);
  });
  days = decided.length;
}

const report = {
  coop, checked_at_round: round.id, rounds_settled: history.length, log_lines: ledger.length,
  ...(days === null ? {} : { recorded_days_played: days }),
  outcomes: tally,
  supply: { hen: show(supply.hen, 18, 2), egg: show(supply.egg, 18, 2) },
  minted: { hen: show(logged.hen.in, 18, 2), egg: show(logged.egg.in, 18, 2) },
  burned: { hen: show(logged.hen.out, 18, 2), egg: show(logged.egg.out, 18, 2) },
  dust_left_in_the_coop: { hen: dust.hen.toString(), egg: dust.egg.toString() },
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--write')) writeFileSync(file.replace(/\.json$/, '.audit.json'), JSON.stringify(report, null, 2) + '\n');
process.exit(failures.length ? 1 : 0);
