// FIXTURE DATA, not from the chain.
// A made-up game for testing the layout of the page without asking any RPC node.
// It is loaded only when the address has ?fixture=1 (40/30/30 second phases),
// ?fixture=fast (8/6/6 seconds) or ?fixture=empty (a coop where nothing happened yet),
// and the page then shows a loud banner. No number in this file is real.
// It answers the same view methods as the coop and the two coins, in the same shapes.

const E18 = 10n ** 18n;
const NEAR = 10n ** 24n;
const PHASES = { 1: [40, 30, 30], fast: [8, 6, 6], empty: [40, 30, 30] };
const SETTLE_SECS = 4; // made-up time until someone settles a finished round
const ROUNDS = 34; // settled rounds that exist when the page opens
const PLAYERS = ['henmaxi', 'eggmaxi', 'trendchaser', 'contrarian', 'coinflip', 'sharpbeak'];
const QUIET = new Set([1, 2, 19]); // void: no scout reported
const SEALED = 11; // void: every report was sealed and none was opened, so all are slashed
const FEW = 12; // void: two reports opened, three are needed
const TIES = new Set([6, 23]);

/** Small seeded random generator, so every visit shows the same made-up game. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const flip = (side) => (side === 'hen' ? 'egg' : 'hen');
const ns = (ms) => String(BigInt(Math.round(ms)) * 1000000n);
const text = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v]));

/** Middle value by the coop's rule: with an even count, the mean of the two middle values, rounded down. */
function middle(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.floor((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}

export function createFixture(mode, game) {
  const empty = mode === 'empty';
  const [roostS, commitS, revealS] = PHASES[mode] || PHASES[1];
  const cycle = roostS + commitS + revealS + SETTLE_SECS;
  const rand = mulberry32(20261112);
  const name = (n) => `${n}.fixture.testnet`;

  Object.assign(game, {
    label: 'Fixture game',
    about: 'Made-up rounds for testing the layout.',
    coop: name('coop'),
    hen: name('hen'),
    egg: name('egg'),
    // The last account never joined: the leaderboard must cope with that.
    players: empty ? [] : [...PLAYERS.map(name), name('latecomer')],
  });

  const cfg = {
    hen_token: game.hen, egg_token: game.egg, roost_secs: roostS, commit_secs: commitS, reveal_secs: revealS,
    hatch_bps: 300, fry_bps: 300, tie_bps: 10, scout_pay: String(100n * E18),
    scout_bond: String((3n * NEAR) / 10n), min_bond: String((15n * NEAR) / 100n), slash_bps: 1000, tolerance_bps: 100,
    min_reveals: 3, max_scouts: 32, starter_hen: String(1000n * E18), starter_egg: String(1000n * E18),
    starter_fee: String(NEAR / 10n), starter_cap: 100,
  };

  const players = empty ? [] : PLAYERS.map((n) => ({
    account_id: name(n), nest: { hen: 1000n * E18, egg: 1000n * E18 }, wins: 0, losses: 0, streak: 0, best_streak: 0,
  }));
  // scout-6 is lazy (skips, or seals and never opens). scout-7 lies about the price.
  const scouts = empty ? [] : [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    scout_id: name(`scout-${n}`), funder: name(n <= 5 ? 'swarm' : `scout-${n}`), bond: (3n * NEAR) / 10n, benched: false,
    earned: { near: 0n, hen: 0n, egg: 0n }, honest_rounds: 0, slashed_rounds: 0,
  }));
  const tally = {
    minted_hen: 0n, minted_egg: 0n, burned_hen: 0n, burned_egg: 0n,
    hen_wins: 0, egg_wins: 0, ties: 0, voids: 0, streak_side: null, streak: 0, best_streak: 0,
  };
  const supply = { hen: 0n, egg: 0n };
  const history = [];
  const ledger = [];
  let pot = 0n;
  let last = null; // middle prices of the last decided round
  let truth = { hen: 38000, egg: 9000 }; // made-up shop prices
  let winner = 'hen';

  /** One line of the mint and burn log. */
  function book(round, kind, coin, amount, account, at) {
    ledger.push({ round, kind, coin, amount: String(amount), account: account || null, at: ns(at) });
    if (kind === 'fry') {
      supply[coin] -= amount;
      tally[`burned_${coin}`] += amount;
    } else {
      supply[coin] += amount;
      if (kind !== 'starter') tally[`minted_${coin}`] += amount;
    }
  }

  /** Decides everything that will happen in a round, the moment it opens. */
  function plan(id, start) {
    const quiet = QUIET.has(id);
    const tie = TIES.has(id) && last;
    const still = quiet || tie || id === SEALED || id === FEW || !last;
    const price = tie ? { ...last } : still ? { ...truth }
      : { hen: Math.round(truth.hen * (0.972 + rand() * 0.06)), egg: Math.round(truth.egg * (0.97 + rand() * 0.06)) };
    const real = price.hen * truth.egg >= price.egg * truth.hen ? 'hen' : 'egg';
    const roosts = players.map((p, i) => {
      const [coin, sharp, size, when, skip] = [rand(), rand(), rand(), rand(), rand()];
      const side = ['hen', 'egg', winner, flip(winner), coin < 0.5 ? 'hen' : 'egg', sharp < 0.7 ? real : flip(real)][i];
      const want = BigInt(100 + Math.floor(size * 200)) * E18;
      const amount = want < p.nest[side] ? want : p.nest[side];
      if (amount === 0n || (i === 4 && skip < 0.2)) return null;
      p.nest[side] -= amount;
      return { side, amount, at: when * 0.9 };
    });
    const reports = scouts.map((sc, i) => {
      const [seal, open, noise, mood] = [rand(), rand(), rand(), rand()];
      if (sc.benched || quiet || (id === FEW && i > 1) || (i === 5 && mood < 0.25)) return null;
      const opens = id !== SEALED && !(i === 5 && mood > 0.9);
      const skew = i === 6 ? 1.2 : tie ? 1 : 0.996 + noise * 0.008;
      return { seal: seal * 0.9, open: opens ? open * 0.9 : null, hen: Math.round(price.hen * skew), egg: Math.round(price.egg * skew) };
    });
    return { id, start, price, roosts, reports };
  }

  /** Mints, burns and scout pay of a round that one side won. */
  function pay(out, roosted, honest, at) {
    const win = out.outcome;
    const lose = flip(win);
    const count = BigInt(honest.length);
    const hatch = (roosted[win] * BigInt(cfg.hatch_bps)) / 10000n;
    const each = count ? BigInt(cfg.scout_pay) / count : 0n;
    const fry = (roosted[lose] * BigInt(cfg.fry_bps)) / 10000n;
    if (hatch > 0n) book(out.id, 'hatch', win, hatch, null, at);
    if (each > 0n) book(out.id, 'scout_pay', win, each * count, null, at);
    if (fry > 0n) book(out.id, 'fry', lose, fry, null, at);
    honest.forEach((i) => { scouts[i].earned[win] += each; });
    out[`minted_${win}`] = String(hatch + each * count);
    out[`burned_${lose}`] = String(fry);
    tally[`${win}_wins`] += 1;
    if (tally.streak_side === win) tally.streak += 1;
    else Object.assign(tally, { streak_side: win, streak: 1 });
    tally.best_streak = Math.max(tally.best_streak, tally.streak);
    winner = win;
  }

  function settle(p) {
    const at = p.start + cycle * 1000;
    const roosted = { hen: 0n, egg: 0n };
    p.roosts.forEach((r) => { if (r) roosted[r.side] += r.amount; });
    const opened = [];
    const silent = [];
    p.reports.forEach((r, i) => { if (r) (r.open === null ? silent : opened).push(i); });
    const out = {
      id: p.id, opened_at: ns(p.start), settled_at: ns(at), outcome: 'void', hen_price: '0', egg_price: '0',
      hen_move_ppm: 0, egg_move_ppm: 0, hen_roosted: String(roosted.hen), egg_roosted: String(roosted.egg),
      minted_hen: '0', minted_egg: '0', burned_hen: '0', burned_egg: '0', reveals: opened.length, honest: 0,
      slashed: [], pot_paid: '0', settled_by: scouts.length ? scouts[p.id % 5].scout_id : name('keeper'),
    };
    const slash = (i) => {
      const sc = scouts[i];
      const cut = (sc.bond * BigInt(cfg.slash_bps)) / 10000n;
      sc.bond -= cut;
      pot += cut;
      sc.slashed_rounds += 1;
      sc.benched = sc.bond < BigInt(cfg.min_bond);
      out.slashed.push(sc.scout_id);
    };
    silent.forEach(slash);
    if (opened.length >= cfg.min_reveals) {
      const mid = { hen: middle(opened.map((i) => p.reports[i].hen)), egg: middle(opened.map((i) => p.reports[i].egg)) };
      const close = (v, m) => Math.abs(v - m) * 10000 <= m * cfg.tolerance_bps;
      const honest = opened.filter((i) => close(p.reports[i].hen, mid.hen) && close(p.reports[i].egg, mid.egg));
      opened.filter((i) => !honest.includes(i)).forEach(slash);
      Object.assign(out, { hen_price: String(mid.hen), egg_price: String(mid.egg), honest: honest.length, outcome: 'baseline' });
      if (last) {
        out.hen_move_ppm = Math.trunc(((mid.hen - last.hen) * 1e6) / last.hen);
        out.egg_move_ppm = Math.trunc(((mid.egg - last.egg) * 1e6) / last.egg);
        const gap = out.hen_move_ppm - out.egg_move_ppm;
        out.outcome = Math.abs(gap) < cfg.tie_bps * 100 ? 'tie' : gap > 0 ? 'hen' : 'egg';
      }
      last = mid;
      truth = p.price;
      const share = honest.length ? pot / BigInt(honest.length) : 0n;
      honest.forEach((i) => { scouts[i].honest_rounds += 1; scouts[i].earned.near += share; });
      out.pot_paid = String(share * BigInt(honest.length));
      pot -= share * BigInt(honest.length);
    }
    const decided = out.outcome === 'hen' || out.outcome === 'egg';
    if (decided) pay(out, roosted, out.honest ? opened.filter((i) => !out.slashed.includes(scouts[i].scout_id)) : [], at);
    if (out.outcome === 'tie') tally.ties += 1;
    if (out.outcome === 'void') tally.voids += 1;
    // Roosts go back to the nests: a little more for winners, a little less for losers.
    p.roosts.forEach((r, i) => {
      if (!r) return;
      const pl = players[i];
      const won = r.side === out.outcome;
      const bit = decided ? (r.amount * BigInt(won ? cfg.hatch_bps : cfg.fry_bps)) / 10000n : 0n;
      pl.nest[r.side] += won ? r.amount + bit : r.amount - bit;
      if (decided && won) {
        pl.wins += 1;
        pl.streak += 1;
        pl.best_streak = Math.max(pl.best_streak, pl.streak);
      } else if (decided) {
        pl.losses += 1;
        pl.streak = 0;
      }
    });
    history.push(out);
  }

  // The made-up past: starter packs, then enough rounds to fill every table.
  const born = Date.now() - (empty ? 5 : ROUNDS * cycle + 5) * 1000;
  players.forEach((p) => {
    book(1, 'starter', 'hen', 1000n * E18, p.account_id, born);
    book(1, 'starter', 'egg', 1000n * E18, p.account_id, born);
  });
  let open = plan(1, born);

  /** Moves the game to now and says where the open round stands. */
  function clock() {
    while (!empty && Date.now() >= open.start + cycle * 1000) {
      settle(open);
      open = plan(open.id + 1, open.start + cycle * 1000);
    }
    const t = (Date.now() - open.start) / 1000;
    const edges = [roostS, roostS + commitS, roostS + commitS + revealS];
    const at = edges.findIndex((edge) => t < edge);
    return { t, phase: ['roost', 'commit', 'reveal', 'settle'][at < 0 ? 3 : at], left: at < 0 ? 0 : Math.ceil(edges[at] - t) };
  }
  const roostSeen = (r, t) => Boolean(r) && t >= r.at * roostS;
  const sealSeen = (r, t) => Boolean(r) && t >= roostS + r.seal * commitS;
  const openSeen = (r, t) => Boolean(r) && r.open !== null && t >= roostS + commitS + r.open * revealS;
  const page = (list, { from = 0, limit = 100 }) => list.slice(from, from + Math.min(limit, 100));

  const views = {
    get_config: () => cfg,
    get_round() {
      const { t, phase, left } = clock();
      const sum = (side) => open.roosts.reduce((s, r) => (roostSeen(r, t) && r.side === side ? s + r.amount : s), 0n);
      return {
        id: open.id, phase, seconds_left: left, opened_at: ns(open.start),
        hen_roosted: String(sum('hen')), egg_roosted: String(sum('egg')),
        commits: open.reports.filter((r) => sealSeen(r, t)).length, reveals: open.reports.filter((r) => openSeen(r, t)).length,
        scouts: scouts.length, pot: String(pot),
        last_hen_price: last ? String(last.hen) : null, last_egg_price: last ? String(last.egg) : null,
      };
    },
    get_stats() {
      clock();
      return {
        stats: { ...text(tally), starters_claimed: players.length, players: players.length + scouts.length },
        hen_supply: String(supply.hen), egg_supply: String(supply.egg),
        rounds_settled: history.length, ledger_entries: ledger.length, pot: String(pot),
      };
    },
    get_scouts() {
      const { t } = clock();
      return scouts.map((sc, i) => {
        const r = open.reports[i];
        const shown = openSeen(r, t);
        return {
          scout_id: sc.scout_id, funder: sc.funder, bond: String(sc.bond), benched: sc.benched,
          earned_near: String(sc.earned.near), earned_hen: String(sc.earned.hen), earned_egg: String(sc.earned.egg),
          sealed: sealSeen(r, t), revealed: shown, hen_price: shown ? String(r.hen) : null, egg_price: shown ? String(r.egg) : null,
          honest_rounds: sc.honest_rounds, slashed_rounds: sc.slashed_rounds,
        };
      });
    },
    get_history(args) { clock(); return page(history, args); },
    get_ledger(args) { clock(); return page(ledger, args); },
    get_player({ account_id }) {
      const { t } = clock();
      const i = players.findIndex((p) => p.account_id === account_id);
      if (i < 0) return null;
      const p = players[i];
      const r = open.roosts[i];
      const on = roostSeen(r, t);
      const nest = { ...p.nest };
      if (r && !on) nest[r.side] += r.amount; // not roosted yet: the coins still rest in the nest
      return {
        account_id, roost: on ? { round: open.id, side: r.side, amount: String(r.amount) } : null,
        nest_hen: String(nest.hen), nest_egg: String(nest.egg),
        wins: p.wins, losses: p.losses, streak: p.streak, best_streak: p.best_streak, has_starter: true,
      };
    },
    ft_total_supply: (_, account) => String(supply[account === game.hen ? 'hen' : 'egg']),
    ft_metadata: (_, account) => (account === game.hen
      ? { spec: 'ft-1.0.0', name: 'Hen (fixture)', symbol: 'HEN', decimals: 18 }
      : { spec: 'ft-1.0.0', name: 'Egg (fixture)', symbol: 'EGG', decimals: 18 }),
  };

  return {
    fixture: true,
    async view(account, method, args = {}) {
      if (!views[method]) throw new Error(`The fixture has no method ${method}`);
      return JSON.parse(JSON.stringify(views[method](args, account)));
    },
    async keys() { return { total: 0, full: 0 }; },
    info: () => ({ endpoint: 'fixture', host: 'fixture', backup: false }),
  };
}
