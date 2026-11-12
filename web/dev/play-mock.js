// MOCK BETTING MODULE. Fake accounts and fake bets, kept in memory; nothing reaches the chain.
// Loaded only when the address has ?mock=1, and the page then shows a loud banner.
// Same exports as js/chain/play.js (see the interface between the two agents), plus mockRound().
// ?mock=1 starts signed out with no account; ?mock=player starts signed in, with coins in the wallet and the nest.

const E18 = 10n ** 18n;
const FEE = 10n ** 23n; // 0.1 NEAR in yoctoNEAR
const wait = (ms) => new Promise((go) => setTimeout(go, ms));
const fakeTx = () => `MOCK${Math.random().toString(36).slice(2, 10).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;

let account = null;
let round = { id: 1, phase: 'roost' };
const listeners = [];
const players = new Map();

function player(id) {
  if (!players.has(id)) {
    players.set(id, {
      hasStarter: false, wallet: { hen: 0n, egg: 0n }, nest: { hen: 0n, egg: 0n }, roost: null,
      wins: 0, losses: 0, streak: 0, bestStreak: 0,
    });
  }
  return players.get(id);
}

function tell() {
  for (const fn of listeners) {
    try { fn(account); } catch (problem) { console.error(problem); }
  }
}

/** The page says which round is open, so fake roosts land in the right round. */
export function mockRound(id, phase) {
  round = { id, phase };
}

export async function init() {
  if (new URLSearchParams(location.search).get('mock') === 'player') {
    account = 'mock-player.testnet';
    const p = player(account);
    Object.assign(p, {
      hasStarter: true, wallet: { hen: 700n * E18, egg: 1000n * E18 }, nest: { hen: 309n * E18, egg: 0n },
      wins: 3, losses: 1, streak: 2, bestStreak: 3,
    });
  }
}

export function onChange(callback) { listeners.push(callback); }
export function accountId() { return account; }
export function guestAvailable() { return true; }

export async function connect() {
  await wait(700);
  account = 'mock-wallet.testnet';
  tell();
  return account;
}

export async function guest() {
  await wait(500);
  account = `mock-guest-${Math.random().toString(36).slice(2, 6)}.testnet`;
  tell();
  return account;
}

export async function disconnect() {
  account = null;
  tell();
}

export async function me() {
  if (!account) return null;
  await wait(250);
  const p = player(account);
  const roost = p.roost && p.roost.round === round.id ? { ...p.roost } : null;
  return {
    accountId: account, hasStarter: p.hasStarter, starterFee: FEE,
    wallet: { ...p.wallet }, nest: { ...p.nest }, roost,
    wins: p.wins, losses: p.losses, streak: p.streak, bestStreak: p.bestStreak,
  };
}

export async function bet(game, side, amount, onStep) {
  if (!account) throw new Error('Sign in first');
  if (round.phase !== 'roost') throw new Error('Bets are closed for this round');
  const p = player(account);
  const coin = side.toUpperCase();
  if (p.roost && p.roost.round === round.id && p.roost.side !== side) throw new Error('You already bet on the other side this round');
  const steps = (p.hasStarter ? 0 : 1) + 1;
  const txs = [];
  let step = 0;
  if (!p.hasStarter) {
    onStep({ step: ++step, of: steps, label: 'Getting your free coins' });
    await wait(1200);
    p.hasStarter = true;
    p.wallet.hen += 1000n * E18;
    p.wallet.egg += 1000n * E18;
    txs.push(fakeTx());
  }
  const fromNest = p.nest[side] >= amount;
  if (!fromNest && p.wallet[side] < amount) throw new Error(`Not enough $${coin}`);
  onStep({ step: ++step, of: steps, label: `Placing ${coin} in the coop` });
  await wait(1100);
  if (fromNest) p.nest[side] -= amount;
  else p.wallet[side] -= amount;
  const before = p.roost && p.roost.round === round.id ? BigInt(p.roost.amount) : 0n;
  p.roost = { round: round.id, side, amount: before + amount };
  txs.push(fakeTx());
  return { txs };
}

export async function cashOut() {
  if (!account) throw new Error('Sign in first');
  await wait(900);
  const p = player(account);
  p.wallet.hen += p.nest.hen;
  p.wallet.egg += p.nest.egg;
  p.nest = { hen: 0n, egg: 0n };
  return { txs: [fakeTx()] };
}
