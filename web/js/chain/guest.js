// "Play without a wallet": a testnet account whose key lives only in this browser.
//
// The key is made here and kept in localStorage. The account itself is created and funded by
// NEAR's public testnet helper (the faucet `near account create-account sponsor-by-faucet-service`
// uses), which answers browsers (CORS) and funds each new account with 10 testnet NEAR. Signing
// happens here with near-api-js.

import { NETWORK, SEND_ENDPOINTS, plain, store, vendor, waitFor } from './near.js';

const KEY = 'chicken-or-egg.guest.v1';
const FAUCET = 'https://helper.nearprotocol.com/account';
const FAUCET_TIMEOUT_MS = 45000;

let creating = null;
let signer = null;

/** The guest saved in this browser: { accountId, secretKey, ready } or null. `ready`: it exists on chain. */
export function saved() {
  try {
    const value = JSON.parse(store.get(KEY) || 'null');
    return value && value.accountId && value.secretKey ? value : null;
  } catch {
    return null;
  }
}

/** Guests need localStorage (to keep the key), WebCrypto randomness and fetch. */
export function available() {
  return typeof fetch === 'function' && !!(globalThis.crypto && crypto.getRandomValues) && store.works();
}

/** A fresh, readable account name such as `coe-k3j9x0a1qz.testnet`. */
function newName() {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `coe-${Array.from(bytes, (b) => letters[b % letters.length]).join('')}.${NETWORK}`;
}

async function askFaucet(accountId, publicKey) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), FAUCET_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(FAUCET, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
      signal: stop.signal,
    });
  } catch (error) {
    console.warn('[guest] faucet unreachable', error);
    throw plain('The free testnet account service did not answer. Try again, or connect a wallet.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw plain('The free testnet account service is busy. Try again in a minute, or connect a wallet.');
  if (!res.ok) {
    console.warn('[guest] faucet said', res.status, await res.text().catch(() => ''));
    throw plain('The free testnet account service is not working right now. Connect a wallet instead.');
  }
  const body = await res.json().catch(() => null);
  // The helper answers with its creation transaction. A failure, or a `false` result,
  // means it did not create the account (most likely the name was taken).
  const status = body && body.status;
  const refused = !status || status.Failure || (status.SuccessValue && atob(status.SuccessValue) === 'false');
  return { refused: !!refused, tx: body && body.transaction && body.transaction.hash, body };
}

// ---- nodes ---------------------------------------------------------------------------------

const BUSY = /fetch|network|timed? ?out|aborted|429|50[0-4]|rate limit|Exceeded \d+ attempts/i;
let provider = null;

/** One near-api-js provider over the page's nodes. A node that is down or busy hands over to the next. */
function nodes(lib) {
  if (provider) return provider;
  const list = SEND_ENDPOINTS.map((url) => new lib.JsonRpcProvider({ url }, { retries: 2, wait: 400, backoff: 1.5 }));
  let at = 0;
  provider = new Proxy(list[0], {
    get(_, name) {
      if (typeof list[at][name] !== 'function') return list[at][name];
      return async (...args) => {
        for (let tries = 0; ; tries++) {
          try {
            return await list[at][name](...args);
          } catch (error) {
            if (!BUSY.test(String((error && error.message) || error)) || tries >= list.length - 1) throw error;
            at = (at + 1) % list.length;
          }
        }
      };
    },
  });
  return provider;
}

/** True when `accountId` exists and holds `publicKey`: the only proof that the account is ours. */
async function ownsKey(lib, accountId, publicKey) {
  try {
    await nodes(lib).viewAccessKey({ accountId, publicKey, finalityQuery: { finality: 'final' } });
    return true;
  } catch (error) {
    if (/does not exist|doesn't exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY/i.test(String((error && error.message) || error))) return false;
    throw error;
  }
}

/** Marks the saved guest as created on chain, so the next visit can restore it without asking. */
function ready(guest) {
  if (!guest.ready) store.set(KEY, JSON.stringify({ ...guest, ready: true }));
  return guest.accountId;
}

/**
 * Creates the guest account, or restores the one saved in this browser.
 * Resolves the account id. Safe to call twice: the second call waits for the first.
 */
export function createOrRestore() {
  if (!creating) creating = make().finally(() => { creating = null; });
  return creating;
}

async function make() {
  if (!available()) throw plain('This browser cannot keep a guest key (private mode?). Connect a wallet instead.');
  const lib = await vendor('near-api-js');
  const publicOf = (guest) => lib.KeyPair.fromString(guest.secretKey).getPublicKey().toString();
  let guest = saved();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!guest) {
      // Saved before the faucet is asked, so a reload in the middle never loses the key.
      guest = { accountId: newName(), secretKey: lib.KeyPair.fromRandom('ed25519').toString(), createdAt: Date.now() };
      if (!store.set(KEY, JSON.stringify(guest))) throw plain('This browser cannot keep a guest key. Connect a wallet instead.');
    }
    const publicKey = publicOf(guest);
    if (await ownsKey(lib, guest.accountId, publicKey)) return ready(guest); // made in an earlier visit
    const answer = await askFaucet(guest.accountId, publicKey);
    if (!answer.refused) {
      const mine = await waitFor(() => ownsKey(lib, guest.accountId, publicKey), { timeoutMs: 30000, everyMs: 1500 });
      if (mine) return ready(guest);
      throw plain('Your guest account is not visible yet. Please try again in a moment.');
    }
    // Refused and the key is not on that account, so the key is worth nothing: try a new name.
    if (await ownsKey(lib, guest.accountId, publicKey)) return ready(guest);
    console.warn('[guest] the helper refused', guest.accountId, answer.body);
    store.remove(KEY);
    guest = null;
  }
  throw plain('Could not create a guest account. Connect a wallet instead.');
}

/** Signs and sends with the saved guest key. `actions` are in NEAR Connect's format. */
async function sendTx(receiverId, actions) {
  const lib = await vendor('near-api-js');
  const guest = saved();
  if (!guest) throw plain('The guest key is gone from this browser.');
  if (!signer || signer.accountId !== guest.accountId) {
    signer = { accountId: guest.accountId, account: new lib.Account(guest.accountId, nodes(lib), guest.secretKey) };
  }
  const list = actions.map(({ params: p }) => lib.actions.functionCall(p.methodName, p.args, BigInt(p.gas), BigInt(p.deposit)));
  return signer.account.signAndSendTransaction({
    receiverId, actions: list, throwOnFailure: false, waitUntil: 'EXECUTED_OPTIMISTIC',
  });
}

/** The signer `tx.send` expects. */
export const guestSigner = { send: sendTx };
