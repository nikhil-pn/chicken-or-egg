// Real betting for the page. The interface is fixed (see the design notes): init, onChange,
// accountId, guestAvailable, connect, guest, disconnect, me, bet, cashOut.
// All coin amounts are BigInt with 18 decimals. Errors are thrown with short human messages.

import { actions, send } from './tx.js';
import { available as guestWorks, createOrRestore, guestSigner, saved as savedGuest } from './guest.js';
import { connectWallet, disconnectWallet, onWalletChange, restoreWallet, walletSigner } from './wallet.js';
import { ftBalance, getConfig, getPlayer, getRound, getStats, humane, plain, store, waitFor } from './near.js';

const SESSION = 'chicken-or-egg.session'; // 'wallet' | 'guest'
const RESTORE_WAIT_MS = 6000; // init() never holds the page longer than this
const SIDES = ['hen', 'egg'];
const SYMBOL = { hen: '$HEN', egg: '$EGG' };

let mode = null;
let current = null;
let busy = false;
const listeners = new Set();

function setAccount(id, how) {
  mode = id ? how : null;
  if (id) store.set(SESSION, how); else store.remove(SESSION);
  if (id === current) return;
  current = id;
  for (const callback of listeners) {
    try { callback(current); } catch (error) { console.error(error); }
  }
}

onWalletChange((id) => {
  if (mode === 'wallet' || (id && !current)) setAccount(id, 'wallet');
});

/** Once at boot: restores the account of an earlier visit. Never throws. */
export async function init() {
  try {
    const how = store.get(SESSION);
    if (how === 'guest') {
      const guest = savedGuest();
      if (guest && guest.ready) setAccount(guest.accountId, 'guest'); // half-made guests wait for guest()
    } else if (how === 'wallet') {
      const restoring = restoreWallet().then((id) => {
        if (id) setAccount(id, 'wallet');
        else if (!current) store.remove(SESSION);
      });
      await Promise.race([restoring, new Promise((go) => setTimeout(go, RESTORE_WAIT_MS))]);
      restoring.catch((error) => console.warn('[play] wallet restore', error));
    }
  } catch (error) {
    console.warn('[play] init', error);
  }
}

/** callback(accountId | null) whenever the account changes. Returns a function that stops it. */
export function onChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export const accountId = () => current;

/** True when "Play without a wallet" works in this browser. */
export const guestAvailable = () => guestWorks();

/** Opens the wallet picker (testnet). Resolves the account id, or null if cancelled. */
export async function connect() {
  const id = await connectWallet();
  if (id) setAccount(id, 'wallet');
  return id;
}

/** Creates (first time) or restores the guest account kept in this browser. */
export async function guest() {
  if (mode === 'wallet') await disconnectWallet();
  const id = await createOrRestore();
  setAccount(id, 'guest');
  return id;
}

/** Forgets the session. A guest key stays in this browser, so `guest()` brings the same account back. */
export async function disconnect() {
  if (mode === 'wallet') await disconnectWallet();
  setAccount(null, null);
}

const signer = () => (mode === 'guest' ? guestSigner : walletSigner);

function who() {
  if (!current) throw plain('Connect a wallet or play as a guest first.');
  return current;
}

const big = (value) => BigInt(value ?? 0);

/** Whole coins for messages: 1,000 or 12.5. */
function coins(amount) {
  const whole = amount / 10n ** 18n;
  const cents = (amount % 10n ** 18n) / 10n ** 16n;
  const head = whole.toLocaleString('en-US');
  return cents ? `${head}.${String(cents).padStart(2, '0').replace(/0$/, '')}` : head;
}

export async function me(game) {
  const id = current;
  if (!id) return null;
  try {
    const [player, hen, egg, config] = await Promise.all([
      getPlayer(game.coop, id), ftBalance(game.hen, id), ftBalance(game.egg, id), getConfig(game.coop),
    ]);
    const roost = player && player.roost;
    return {
      accountId: id,
      hasStarter: !!(player && player.has_starter),
      starterFee: big(config.starter_fee),
      wallet: { hen, egg },
      nest: { hen: big(player && player.nest_hen), egg: big(player && player.nest_egg) },
      roost: roost ? { round: Number(roost.round), side: roost.side, amount: big(roost.amount) } : null,
      wins: (player && player.wins) || 0,
      losses: (player && player.losses) || 0,
      streak: (player && player.streak) || 0,
      bestStreak: (player && player.best_streak) || 0,
    };
  } catch (error) {
    throw humane(error);
  }
}

function assertOpen(round) {
  if (!round || round.phase !== 'roost') throw plain('Bets are closed for this round.');
}

function assertSide(player, round, side) {
  const roost = player && player.roost;
  if (roost && Number(roost.round) === Number(round.id) && roost.side !== side) {
    throw plain(`You backed ${SYMBOL[roost.side]} this round. One side per round.`);
  }
}

/** Every step a bet needs, from a brand-new account to a roost. Resolves { txs }. */
export async function bet(game, side, amount, onStep = () => {}) {
  if (busy) throw plain('Still working on your last bet.');
  busy = true;
  const txs = [];
  try {
    await placeBet(game, side, amount, onStep, txs);
    return { txs };
  } catch (error) {
    const out = humane(error);
    out.txs = txs;
    throw out;
  } finally {
    busy = false;
  }
}

async function placeBet(game, side, amount, onStep, txs) {
  side = String(side).toLowerCase();
  if (!SIDES.includes(side)) throw plain('Pick a side: hen or egg.');
  let want;
  try { want = BigInt(amount); } catch { throw plain('That amount is not a number.'); }
  if (want <= 0n) throw plain('Bet more than zero.');
  const id = who();
  const sign = signer();
  const { coop } = game;
  const coin = game[side];

  const [round, config, player, held, stats] = await Promise.all([
    getRound(coop), getConfig(coop), getPlayer(coop, id), ftBalance(coin, id), getStats(coop),
  ]);
  assertOpen(round);
  assertSide(player, round, side);

  const nest = big(player && player[`nest_${side}`]);
  const fromNest = nest >= want;
  const startersLeft = stats.stats.starters_claimed < config.starter_cap;
  const takeStarter = !(player && player.has_starter) && startersLeft;
  const mustJoin = !player && !takeStarter;
  const gift = takeStarter ? big(config[`starter_${side}`]) : 0n;
  if (!fromNest && held + gift < want) {
    if (!player && !startersLeft && held === 0n) throw plain('All the free starter packs are gone.');
    throw plain(`Not enough ${SYMBOL[side]}. You have ${coins(held + gift)} in your wallet and ${coins(nest)} in your nest.`);
  }

  const plan = [];
  if (mustJoin) plan.push('Joining the game');
  if (takeStarter) plan.push('Getting your free coins', 'Waiting for your coins to land');
  plan.push('Placing your bet');
  let step = 0;
  const tell = () => {
    const label = plan[step];
    step += 1;
    try { onStep({ step, of: plan.length, label }); } catch (error) { console.error(error); }
  };
  const stillOpen = async () => {
    const now = await getRound(coop);
    assertOpen(now);
    return now;
  };

  if (mustJoin) {
    tell();
    await stillOpen();
    txs.push((await send(sign, coop, actions.join(10n ** 22n))).hash); // 0.01 NEAR pays for the record
  }
  if (takeStarter) {
    tell();
    await stillOpen();
    txs.push((await send(sign, coop, actions.claimStarter(config.starter_fee))).hash);
    tell();
    // The coins are minted by a second contract call: bet only once they are really there.
    const landed = await waitFor(async () => (await ftBalance(coin, id)) >= held + gift, { timeoutMs: 90000 });
    if (!landed) throw plain('Your free coins have not arrived yet. Wait a moment, then bet again.');
  }

  tell();
  const now = await stillOpen();
  const fresh = await getPlayer(coop, id);
  assertSide(fresh, now, side);
  const before = fresh && fresh.roost ? big(fresh.roost.amount) : 0n;
  const sent = fromNest
    ? await send(sign, coop, actions.roostFromNest(side, want))
    : await send(sign, coin, actions.roostFromWallet(coop, want));
  txs.push(sent.hash);
  // Resolve once the page's own reads show the bet, so a refresh right after is never stale.
  const seen = await waitFor(async () => {
    const p = await getPlayer(coop, id);
    return p && p.roost && p.roost.side === side && big(p.roost.amount) >= before + want;
  }, { timeoutMs: 25000 });
  if (!seen && !sent.outcome) throw plain('Your bet was sent but is not visible yet. Check again in a minute.');
}

/** `claim`: sends every coin in the nest to the wallet. Resolves { txs }. */
export async function cashOut(game) {
  const id = who();
  try {
    const player = await getPlayer(game.coop, id);
    if (!player) throw plain('This account has not joined the game yet.');
    if (big(player.nest_hen) === 0n && big(player.nest_egg) === 0n) throw plain('Your nest is empty: nothing to cash out.');
    const sent = await send(signer(), game.coop, actions.claim());
    await waitFor(async () => {
      const p = await getPlayer(game.coop, id);
      return p && big(p.nest_hen) === 0n && big(p.nest_egg) === 0n;
    }, { timeoutMs: 20000 });
    return { txs: [sent.hash] };
  } catch (error) {
    throw humane(error);
  }
}
