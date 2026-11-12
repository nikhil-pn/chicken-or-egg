// Shared pieces for signing: reads through the page's own rpc.js, the vendored libraries,
// waiting helpers, and short human error messages.

import { createRpc, ENDPOINTS } from '../rpc.js';

export const NETWORK = 'testnet';
export const TGAS = 10n ** 12n;
export const ONE_YOCTO = 1n;
export const SEND_ENDPOINTS = ENDPOINTS; // the same CORS-friendly nodes the page reads from

export const rpc = createRpc();

export const sleep = (ms) => new Promise((go) => setTimeout(go, ms));

/** localStorage that never throws (private windows, blocked site data). */
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* nothing to do */ } },
  works() {
    try { localStorage.setItem('coe.probe', '1'); localStorage.removeItem('coe.probe'); return true; } catch { return false; }
  },
};

const loaded = new Map();
/** Loads one vendored bundle (web/vendor/<name>.js) once, only when it is first needed. */
export function vendor(name) {
  if (!loaded.has(name)) {
    const url = new URL(`../../vendor/${name}.js`, import.meta.url).href;
    loaded.set(name, import(url).catch((error) => { loaded.delete(name); throw error; }));
  }
  return loaded.get(name);
}

/** Asks `check` again and again until it returns something truthy, or gives up. */
export async function waitFor(check, { timeoutMs = 60000, everyMs = 1500 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > until) return null;
    await sleep(everyMs);
  }
}

// ---- reads --------------------------------------------------------------------------------

const configs = new Map();
export function getConfig(coop) {
  if (!configs.has(coop)) {
    configs.set(coop, rpc.view(coop, 'get_config').catch((error) => { configs.delete(coop); throw error; }));
  }
  return configs.get(coop);
}

export const getRound = (coop) => rpc.view(coop, 'get_round');
export const getPlayer = (coop, accountId) => rpc.view(coop, 'get_player', { account_id: accountId });
export const getStats = (coop) => rpc.view(coop, 'get_stats');
export const ftBalance = async (token, accountId) =>
  BigInt((await rpc.view(token, 'ft_balance_of', { account_id: accountId })) ?? 0);

/** True when the account exists on chain. */
export async function accountExists(accountId) {
  try {
    await rpc.keys(accountId);
    return true;
  } catch (error) {
    if (error && error.missing) return false;
    throw error;
  }
}

// ---- errors -------------------------------------------------------------------------------

/** Contract messages and wallet errors, turned into one short sentence each. */
const PLAIN = [
  [/Roosting is closed/i, 'Bets are closed for this round.'],
  [/One side per round/i, 'You already backed the other side this round. One side per round.'],
  [/Not enough coins in the nest/i, 'Not enough coins in your nest.'],
  [/doesn't have enough balance|not enough balance/i, 'Not enough coins in your wallet.'],
  [/All starter packs are gone/i, 'All the free starter packs are gone.'],
  [/One starter pack per account/i, 'This account already got its starter pack.'],
  [/Attach the starter fee/i, 'The starter pack needs its fee attached.'],
  [/Join the coop first|Not a player/i, 'This account has not joined the game yet.'],
  [/Nothing to claim/i, 'Your nest is empty: nothing to cash out.'],
  [/NotEnoughBalance|LackBalanceForState|does not have enough|insufficient/i, 'This account does not have enough NEAR to pay for that.'],
  [/not registered|storage_deposit/i, 'This account is not registered on that coin yet.'],
  [/No accounts found|No wallet selected|Wallet not found/i, 'Your wallet is not connected any more. Connect it again.'],
  [/reject|cancel|denied|closed by user|User closed/i, 'You cancelled it in the wallet.'],
  [/InvalidNonce|nonce/i, 'The network was busy with your last step. Please try again.'],
  [/Failed to fetch|NetworkError|timed? ?out|HTTP 5\d\d|HTTP 429|Exceeded \d+ attempts|aborted/i,
    'The NEAR network did not answer. Please try again in a moment.'],
];

/** An Error with a short human message. Keeps the original as `cause` for the console. */
export function humane(error, fallback = 'That did not work. Please try again.') {
  if (error && error.humane) return error;
  const text = typeof error === 'string' ? error : String((error && (error.message || error.type)) || error || '');
  const hit = PLAIN.find(([pattern]) => pattern.test(text));
  const out = new Error(hit ? hit[1] : fallback);
  out.humane = true;
  out.cause = error;
  return out;
}

/** An Error whose message is already written for people. */
export function plain(message) {
  const out = new Error(message);
  out.humane = true;
  return out;
}
