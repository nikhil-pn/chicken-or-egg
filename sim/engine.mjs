// Reference model of the coop contract. Pure, no I/O. All amounts are BigInt.
// It follows RULES.md "Exact arithmetic" step by step; see docs/SIMULATION.md for the readings
// of the few places where the rules are silent.
export const COIN = 10n ** 18n;   // 18 decimals
export const NEAR = 10n ** 24n;   // yocto
const BPS = 10000n, PPM = 1000000n;

export const DEFAULTS = {
  hatch_bps: 300n, fry_bps: 300n, tie_bps: 10n,
  scout_pay: 100n * COIN, scout_bond: 10n * NEAR, min_bond: 5n * NEAR, slash_bps: 1000n,
  tolerance_bps: 100n, min_reveals: 3n, max_scouts: 32n,
  starter_hen: 1000n * COIN, starter_egg: 1000n * COIN,
  starter_fee: NEAR / 10n, starter_cap: 10000n,
  starter_storage: 25n * 10n ** 20n, // 0.0025 NEAR kept back for storage; the rest goes to the pot
};

// ---- pure helpers (exported for tests) ----
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const abs = (x) => (x < 0n ? -x : x);
/** Middle value; even count = floor((a+b)/2) of the two middle ones. */
export function median(values) {
  const s = [...values].sort(cmp), n = s.length;
  if (n === 0) throw new Error('median of nothing');
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2n;
}
/** Move in parts per million, rounded toward zero (BigInt division truncates toward zero). */
export const movePpm = (last, now) => ((now - last) * PPM) / last;
/** TIE if the two moves are closer than tie_bps, else the bigger riser came first. */
export function decide(henMove, eggMove, tieBps) {
  if (abs(henMove - eggMove) < BigInt(tieBps) * 100n) return 'TIE';
  return henMove > eggMove ? 'HEN' : 'EGG';
}
/** Honest = both prices within tolerance of the middle values. */
export const isHonest = (rep, mid, tol) =>
  abs(rep.hen - mid.hen) * BPS <= tol * mid.hen && abs(rep.egg - mid.egg) * BPS <= tol * mid.egg;

// ---- state ----
export function createCoop(config = {}) {
  const cfg = {};
  for (const [k, v] of Object.entries({ ...DEFAULTS, ...config })) cfg[k] = BigInt(v);
  return {
    cfg, round: 1, last: null,            // last = { hen, egg } good prices, null before the baseline
    supply: { hen: 0n, egg: 0n },         // total coins in existence
    coop: { hen: 0n, egg: 0n },           // coins held by the coop (roosts + scout pay owed)
    wallets: new Map(), roosts: new Map(), scouts: new Map(), starters: new Set(),
    pot: 0n, ledger: [], history: [],
  };
}
const key = (side) => side.toLowerCase();
export const wallet = (st, a) => {
  if (!st.wallets.has(a)) st.wallets.set(a, { hen: 0n, egg: 0n });
  return st.wallets.get(a);
};
function mint(st, kind, coin, amount, account) {
  if (amount <= 0n) return;
  st.supply[coin] += amount;
  st.ledger.push({ round: st.round, kind, coin, amount, ...(account ? { account } : {}) });
}
function burn(st, kind, coin, amount) {
  if (amount <= 0n) return;
  st.supply[coin] -= amount;
  st.ledger.push({ round: st.round, kind, coin, amount: -amount });
}

// ---- scouts ----
export function registerScout(st, scoutId, funder, bond) {
  if (st.scouts.has(scoutId)) throw new Error('scout exists');
  if (BigInt(bond) < st.cfg.scout_bond) throw new Error('bond below scout_bond');
  if (BigInt(st.scouts.size) >= st.cfg.max_scouts) throw new Error('max_scouts reached');
  st.scouts.set(scoutId, { id: scoutId, funder, bond: BigInt(bond), near_earned: 0n,
    coins_earned: { hen: 0n, egg: 0n }, slashes: 0 });
}
export function topUpScout(st, scoutId, amount) { st.scouts.get(scoutId).bond += BigInt(amount); }
export const isBenched = (st, id) => st.scouts.get(id).bond < st.cfg.min_bond;
/** Funder gets bond + unpaid NEAR; owed coins go to the funder's wallet. Returns the NEAR paid. */
export function retireScout(st, scoutId) {
  const s = st.scouts.get(scoutId);
  if (!s) throw new Error('no such scout');
  const w = wallet(st, s.funder);
  for (const c of ['hen', 'egg']) { w[c] += s.coins_earned[c]; st.coop[c] -= s.coins_earned[c]; }
  st.scouts.delete(scoutId);
  return s.bond + s.near_earned;
}

// ---- players ----
export function starterPack(st, account) {
  if (st.starters.has(account)) throw new Error('starter pack already taken');
  if (BigInt(st.starters.size) >= st.cfg.starter_cap) throw new Error('starter packs are gone');
  if (st.cfg.starter_fee < st.cfg.starter_storage) throw new Error('fee below storage cost');
  st.starters.add(account);
  st.pot += st.cfg.starter_fee - st.cfg.starter_storage;
  const w = wallet(st, account);
  w.hen += st.cfg.starter_hen; w.egg += st.cfg.starter_egg;
  mint(st, 'starter', 'hen', st.cfg.starter_hen, account);
  mint(st, 'starter', 'egg', st.cfg.starter_egg, account);
}
/** Lock coins on a side for the current round. One side per account per round. */
export function roost(st, account, side, amount) {
  amount = BigInt(amount);
  if (side !== 'HEN' && side !== 'EGG') throw new Error('side must be HEN or EGG');
  if (amount <= 0n) throw new Error('nothing to roost');
  let r = st.roosts.get(account);
  if (r && r.settled) { claim(st, account); r = null; }       // roosting again collects the old roost
  if (r && r.side !== side) throw new Error('one side per account per round');
  const w = wallet(st, account), c = key(side);
  if (w[c] < amount) throw new Error('not enough coins');
  w[c] -= amount; st.coop[c] += amount;
  if (r) r.amount += amount; else st.roosts.set(account, { side, amount, round: st.round, settled: false });
}
/** Move a settled roost (grown, shrunk or unchanged) back to the wallet. */
export function claim(st, account) {
  const r = st.roosts.get(account);
  if (!r) return null;
  if (!r.settled) throw new Error('round not settled yet');
  const c = key(r.side);
  st.coop[c] -= r.amount; wallet(st, account)[c] += r.amount;
  st.roosts.delete(account);
  return { side: r.side, amount: r.amount };
}

// ---- settle ----
/** reports: { scout, hen, egg } (revealed) | { scout, sealed: true } (committed, never revealed). */
export function settle(st, reports) {
  const c = st.cfg, id = st.round;
  const revealed = [], sealedOnly = [], seen = new Set();
  for (const r of reports) {
    const s = st.scouts.get(r.scout);
    if (!s) throw new Error(`unknown scout ${r.scout}`);
    if (seen.has(r.scout)) throw new Error(`duplicate report from ${r.scout}`);
    if (isBenched(st, r.scout)) throw new Error(`scout ${r.scout} is benched`);
    seen.add(r.scout);
    if (r.sealed) sealedOnly.push(s);
    else {
      if (r.hen <= 0n || r.egg <= 0n) throw new Error('prices must be positive');
      revealed.push({ s, hen: BigInt(r.hen), egg: BigInt(r.egg) });
    }
  }
  const res = { id, result: null, hen_price: null, egg_price: null, hen_move_ppm: null, egg_move_ppm: null,
    hen_roosted: 0n, egg_roosted: 0n, minted_hen: 0n, minted_egg: 0n, burned_hen: 0n, burned_egg: 0n,
    reveals: revealed.length, honest: 0, slashed: [], pot_paid: 0n };
  const slash = (s, reason) => {
    const amt = (s.bond * c.slash_bps) / BPS;
    s.bond -= amt; s.slashes++; st.pot += amt;
    res.slashed.push({ scout: s.id, amount: amt, reason });
  };

  let honest = [];
  const void_ = BigInt(revealed.length) < c.min_reveals;
  if (void_) {
    res.result = 'VOID';
    for (const s of sealedOnly) slash(s, 'sealed_no_reveal');
  } else {
    // 1-2. middle values; 3. honest scouts; 4. slash; 5. pay the pot
    const mid = { hen: median(revealed.map((r) => r.hen)), egg: median(revealed.map((r) => r.egg)) };
    res.hen_price = mid.hen; res.egg_price = mid.egg;
    for (const r of revealed) (isHonest(r, mid, c.tolerance_bps) ? honest.push(r.s) : slash(r.s, 'out_of_tolerance'));
    for (const s of sealedOnly) slash(s, 'sealed_no_reveal');
    res.honest = honest.length;
    if (honest.length) {
      const share = st.pot / BigInt(honest.length);
      for (const s of honest) s.near_earned += share;
      res.pot_paid = share * BigInt(honest.length); st.pot -= res.pot_paid;
    }
    // 6. decide the result
    if (!st.last) res.result = 'BASELINE';
    else {
      res.hen_move_ppm = movePpm(st.last.hen, mid.hen);
      res.egg_move_ppm = movePpm(st.last.egg, mid.egg);
      res.result = decide(res.hen_move_ppm, res.egg_move_ppm, c.tie_bps);
    }
    st.last = mid;
  }

  // 7. mint and burn, and settle every roost of this round
  const win = res.result === 'HEN' || res.result === 'EGG';
  const winSide = res.result, loseSide = win ? (winSide === 'HEN' ? 'EGG' : 'HEN') : null;
  const totals = { HEN: 0n, EGG: 0n };
  for (const r of st.roosts.values()) if (r.round === id) totals[r.side] += r.amount;
  res.hen_roosted = totals.HEN; res.egg_roosted = totals.EGG;
  if (win) {
    for (const r of st.roosts.values()) {
      if (r.round !== id) continue;
      r.amount = r.side === winSide
        ? (r.amount * (BPS + c.hatch_bps)) / BPS
        : (r.amount * (BPS - c.fry_bps)) / BPS;
    }
    const hatch = (totals[winSide] * c.hatch_bps) / BPS, fry = (totals[loseSide] * c.fry_bps) / BPS;
    const wc = key(winSide), lc = key(loseSide);
    mint(st, 'hatch', wc, hatch); res['minted_' + wc] += hatch; st.coop[wc] += hatch;
    if (honest.length) {
      const share = c.scout_pay / BigInt(honest.length);
      for (const s of honest) { s.coins_earned[wc] += share; mint(st, 'scout_pay', wc, share, s.id); }
      res['minted_' + wc] += share * BigInt(honest.length); st.coop[wc] += share * BigInt(honest.length);
    }
    burn(st, 'fry', lc, fry); res['burned_' + lc] += fry; st.coop[lc] -= fry;
  }
  for (const r of st.roosts.values()) if (r.round === id) r.settled = true;
  st.round++;
  st.history.push(res);
  return res;
}

// ---- audits ----
/** Coins the coop owes right now: unclaimed roosts + scout pay not yet withdrawn. */
export function owed(st, coin) {
  let t = 0n;
  for (const r of st.roosts.values()) if (key(r.side) === coin) t += r.amount;
  for (const s of st.scouts.values()) t += s.coins_earned[coin];
  return t;
}
/** supply == ledger; supply == wallets + coop; coop owes no more than it holds. Throws on failure. */
export function audit(st) {
  for (const coin of ['hen', 'egg']) {
    const led = st.ledger.filter((e) => e.coin === coin).reduce((a, e) => a + e.amount, 0n);
    let w = 0n; for (const x of st.wallets.values()) w += x[coin];
    if (led !== st.supply[coin]) throw new Error(`${coin}: ledger ${led} != supply ${st.supply[coin]}`);
    if (w + st.coop[coin] !== st.supply[coin]) throw new Error(`${coin}: wallets+coop != supply`);
    if (owed(st, coin) > st.coop[coin]) throw new Error(`${coin}: coop owes more than it holds`);
  }
  return true;
}
