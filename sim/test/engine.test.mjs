import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoop, registerScout, topUpScout, retireScout, starterPack, roost, claim, settle, audit,
  median, movePpm, wallet, isBenched, COIN, NEAR } from '../engine.mjs';
import { mulberry32 } from '../strategies.mjs';

// A coop with `n` scouts s0..s{n-1} and a player "p" holding a starter pack.
function mk(cfg = {}, n = 5) {
  const st = createCoop({ starter_hen: 1000n * COIN, starter_egg: 1000n * COIN, ...cfg });
  for (let i = 0; i < n; i++) registerScout(st, 's' + i, 'f' + i, 10n * NEAR);
  return st;
}
const all = (st, hen, egg) => [...st.scouts.keys()].map((scout) => ({ scout, hen: BigInt(hen), egg: BigInt(egg) }));
const P = 1_000_000n; // price 1e6 makes move_ppm == price difference

test('median: odd takes the middle, even takes floor of the average', () => {
  assert.equal(median([5n, 1n, 9n]), 5n);
  assert.equal(median([1n, 2n, 4n, 100n]), 3n);   // (2+4)/2
  assert.equal(median([1n, 2n, 3n, 100n]), 2n);   // (2+3)/2 = 2.5 -> 2
});

test('tolerance edge: exactly at the tolerance is honest, one above is not', () => {
  const st = mk({ tolerance_bps: 100 }, 4);
  // three scouts at 10000, one at 10100 (=1.00%): median of 4 = 10000
  const rep = all(st, 10000, 10000); rep[3].hen = 10100n;
  let r = settle(st, rep);
  assert.equal(r.honest, 4);
  const rep2 = all(st, 10000, 10000); rep2[3].hen = 10101n;
  r = settle(st, rep2);
  assert.equal(r.honest, 3);
  assert.equal(r.slashed[0].scout, 's3');
});

test('move rounds toward zero, also for negative moves', () => {
  assert.equal(movePpm(3n, 4n), 333333n);
  assert.equal(movePpm(7n, 6n), -142857n);   // -142857.14 -> toward zero, not -142858
  assert.equal(movePpm(3n, 2n), -333333n);
  assert.equal(movePpm(1000n, 1000n), 0n);
});

test('tie threshold: gap below tie_bps*100 ppm is a tie, at the threshold is a win', () => {
  const st = mk({ tie_bps: 10 });          // 10 bps = 1000 ppm
  settle(st, all(st, P, P));               // baseline
  assert.equal(settle(st, all(st, P + 999n, P)).result, 'TIE');
  const st2 = mk({ tie_bps: 10 });
  settle(st2, all(st2, P, P));
  assert.equal(settle(st2, all(st2, P + 1000n, P)).result, 'HEN');
  assert.equal(settle(st2, all(st2, P + 1000n, P + 3000n)).result, 'EGG'); // hen -0.1%, egg +0.3%
});

test('baseline round records prices and pays nothing', () => {
  const st = mk(); starterPack(st, 'p'); roost(st, 'p', 'HEN', 100n * COIN);
  const r = settle(st, all(st, P, P));
  assert.equal(r.result, 'BASELINE');
  assert.equal(st.supply.hen, 1000n * COIN);
  assert.equal(claim(st, 'p').amount, 100n * COIN);
  assert.deepEqual(st.last, { hen: P, egg: P });
  assert.equal(r.minted_hen + r.minted_egg, 0n);
  audit(st);
});

test('void round: sealed-only scouts are slashed, revealers are not, roosts untouched, prices kept', () => {
  const st = mk({ min_reveals: 3 }); starterPack(st, 'p'); roost(st, 'p', 'EGG', 50n * COIN);
  settle(st, all(st, P, P));
  const rep = [{ scout: 's0', hen: P * 2n, egg: P * 2n }, { scout: 's1', hen: P, egg: P }, { scout: 's2', sealed: true }];
  const r = settle(st, rep);
  assert.equal(r.result, 'VOID');
  assert.deepEqual(r.slashed.map((x) => x.scout), ['s2']);
  assert.equal(st.scouts.get('s2').bond, 9n * NEAR);          // 10% of 10 NEAR
  assert.equal(st.scouts.get('s0').bond, 10n * NEAR);
  assert.deepEqual(st.last, { hen: P, egg: P });
  assert.equal(st.pot, NEAR);                                 // the slash stays in the pot (void pays nobody)
  assert.equal(r.pot_paid, 0n);
  assert.equal(claim(st, 'p').amount, 50n * COIN);
});

test('hatch and fry round down; coop never owes more than it holds', () => {
  const st = mk({ hatch_bps: 300, fry_bps: 300, scout_pay: 0 });
  for (const a of ['a', 'b', 'c']) starterPack(st, a);
  roost(st, 'a', 'HEN', 333n); roost(st, 'b', 'HEN', 7n); roost(st, 'c', 'EGG', 1001n);
  settle(st, all(st, P, P));
  roost(st, 'a', 'HEN', 1n); // a had a settled roost; roosting again collects it first
  roost(st, 'b', 'HEN', 7n); roost(st, 'c', 'EGG', 1001n);
  const r = settle(st, all(st, P + 50_000n, P));     // HEN wins
  assert.equal(r.result, 'HEN');
  assert.equal(st.roosts.get('a').amount, 1n * 10300n / 10000n);   // 1 -> 1 (rounds down)
  assert.equal(st.roosts.get('b').amount, 7n);                      // 7*1.03 = 7.21 -> 7
  assert.equal(st.roosts.get('c').amount, (1001n * 9700n) / 10000n); // 970
  assert.equal(r.minted_hen, (8n * 300n) / 10000n);                 // hatch on 8 wei = 0
  assert.equal(r.burned_egg, (1001n * 300n) / 10000n);              // 30
  audit(st);
});

test('scout pay: split equally, rounded down, coop mints exactly what it pays', () => {
  const st = mk({ scout_pay: 100, hatch_bps: 300 }, 3);
  settle(st, all(st, P, P));
  const r = settle(st, all(st, P + 50_000n, P));
  assert.equal(r.result, 'HEN');
  assert.equal(r.honest, 3);
  for (const s of st.scouts.values()) assert.equal(s.coins_earned.hen, 33n);
  assert.equal(r.minted_hen, 99n);
  assert.equal(st.supply.hen, 99n);
  audit(st);
});

test('slash + pot: slashed NEAR joins the pot, honest scouts split it, remainder stays', () => {
  const st = mk({ slash_bps: 1000 }, 4);      // 3 honest + 1 liar
  settle(st, all(st, P, P));
  const rep = all(st, P, P); rep[3].hen = P * 2n;
  const r = settle(st, rep);
  assert.equal(r.honest, 3);
  const slashed = NEAR;                        // 10% of 10 NEAR
  assert.equal(r.slashed[0].amount, slashed);
  const share = slashed / 3n;
  assert.equal(r.pot_paid, share * 3n);
  assert.equal(st.pot, slashed - share * 3n);  // 1 yocto left
  assert.equal(st.pot, 1n);
  assert.equal(st.scouts.get('s0').near_earned, share);
  assert.equal(st.scouts.get('s3').bond, 9n * NEAR);
});

test('benched scout cannot report until topped up', () => {
  const st = mk({ slash_bps: 5000, min_bond: 6n * NEAR }, 4);
  settle(st, all(st, P, P));
  const rep = all(st, P, P); rep[3].egg = P * 3n;
  settle(st, rep);                             // s3 slashed to 5 NEAR < 6 NEAR
  assert.ok(isBenched(st, 's3'));
  assert.throws(() => settle(st, all(st, P, P)), /benched/);
  topUpScout(st, 's3', 2n * NEAR);
  assert.ok(!isBenched(st, 's3'));
  settle(st, all(st, P, P));
});

test('retire pays the funder bond + earnings', () => {
  const st = mk({}, 4);
  settle(st, all(st, P, P)); settle(st, all(st, P + 50_000n, P));
  const coins = st.scouts.get('s0').coins_earned.hen;
  assert.ok(coins > 0n);
  assert.equal(retireScout(st, 's0'), 10n * NEAR);
  assert.equal(wallet(st, 'f0').hen, coins);
  audit(st);
});

test('starter pack: once per account, stops at the cap, fee minus storage goes to the pot', () => {
  const st = mk({ starter_cap: 2, starter_fee: 100n, starter_storage: 30n });
  starterPack(st, 'a');
  assert.throws(() => starterPack(st, 'a'), /already/);
  starterPack(st, 'b');
  assert.throws(() => starterPack(st, 'c'), /gone/);
  assert.equal(st.pot, 140n);
  assert.equal(st.supply.hen, 2000n * COIN);
  assert.equal(wallet(st, 'a').egg, 1000n * COIN);
});

test('roost: one side per account per round; coins must exist', () => {
  const st = mk(); starterPack(st, 'a');
  roost(st, 'a', 'HEN', 10n);
  assert.throws(() => roost(st, 'a', 'EGG', 10n), /one side/);
  assert.throws(() => roost(st, 'a', 'HEN', 10000n * COIN), /not enough/);
  assert.throws(() => claim(st, 'a'), /not settled/);
});

test('random 200-round run: supply == ledger every round, coop never owes more than it holds', () => {
  const rng = mulberry32(42);
  const st = mk({ hatch_bps: 700, fry_bps: 500, scout_pay: 37, tolerance_bps: 50, min_reveals: 3 }, 7);
  const accts = Array.from({ length: 20 }, (_, i) => 'p' + i);
  accts.forEach((a) => starterPack(st, a));
  let hen = 38000n, egg = 13600n;
  for (let round = 0; round < 200; round++) {
    for (const a of accts) {
      if (rng() < 0.3) continue;
      const side = rng() < 0.5 ? 'HEN' : 'EGG', c = side.toLowerCase();
      if (st.roosts.get(a)?.settled) claim(st, a);
      const amt = BigInt(Math.floor(rng() * 1e6)) * 7919n + 1n;
      const w = wallet(st, a)[c];
      if (w >= amt) roost(st, a, side, amt > w / 2n ? w / 2n || 1n : amt);
    }
    hen = hen * BigInt(9900 + Math.floor(rng() * 200)) / 10000n;
    egg = egg * BigInt(9900 + Math.floor(rng() * 200)) / 10000n;
    const reps = [];
    for (const s of st.scouts.keys()) {
      if (isBenched(st, s)) { topUpScout(st, s, 5n * NEAR); }
      const x = rng();
      if (x < 0.1) continue;
      if (x < 0.2) reps.push({ scout: s, sealed: true });
      else if (x < 0.3) reps.push({ scout: s, hen: hen * 11n / 10n, egg });
      else reps.push({ scout: s, hen, egg });
    }
    settle(st, reps);
    audit(st);   // supply == ledger, wallets + coop == supply, owed <= held
  }
  const kinds = new Set(st.history.map((h) => h.result));
  assert.ok(kinds.has('HEN') && kinds.has('EGG'));
  for (const a of accts) if (st.roosts.get(a)) claim(st, a);
  audit(st);
});

test('supply equals the sum of ledger mints minus burns after every round', () => {
  const st = mk(); starterPack(st, 'a'); starterPack(st, 'b');
  settle(st, all(st, P, P));
  for (let i = 1; i <= 6; i++) {
    roost(st, 'a', 'HEN', 100n * COIN); roost(st, 'b', 'EGG', 100n * COIN);
    settle(st, all(st, P + BigInt(i % 2 ? 50_000 : 0), P + BigInt(i % 2 ? 0 : 50_000)));
    for (const coin of ['hen', 'egg'])
      assert.equal(st.ledger.filter((e) => e.coin === coin).reduce((t, e) => t + e.amount, 0n), st.supply[coin]);
    claim(st, 'a'); claim(st, 'b');
  }
});
