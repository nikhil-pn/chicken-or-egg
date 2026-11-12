// A thin layer over near-api-js: one provider, accounts loaded from the key folder.
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const NETWORK = process.env.NEAR_NETWORK ?? 'testnet';
// Free public nodes limit how fast one address may ask. Several nodes, comma separated, tried in turn.
const RPC_URLS = (process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org').split(',');
export const RPC_URL = RPC_URLS[0];
// Same folder and file format as the near CLI, so both tools share keys.
const KEY_DIR = process.env.NEAR_KEY_DIR ?? join(homedir(), '.near-credentials', NETWORK);

const nodes = RPC_URLS.map((url) => new JsonRpcProvider({ url }));
let node = 0;
const busy = (error) =>
  [408, 429, 500, 502, 503].includes(error?.cause) || /fetch failed|rate limit|timed? ?out/i.test(String(error?.message ?? error));

/** One provider over all nodes. A node that is busy or down hands the request to the next one. */
export const provider = new Proxy(nodes[0], {
  get(_, name) {
    if (typeof nodes[node][name] !== 'function') return nodes[node][name];
    return async (...args) => {
      for (let tries = 0; ; tries++) {
        try {
          return await nodes[node][name](...args);
        } catch (error) {
          if (!busy(error) || tries >= nodes.length * 2) throw error;
          node = (node + 1) % nodes.length;
          await new Promise((resolve) => setTimeout(resolve, 250 * (tries + 1)));
        }
      }
    };
  },
});
export const TGAS = 10n ** 12n;
export const NEAR = 10n ** 24n;
export const COIN = 10n ** 18n;

/** Where the key of `id` lives. A `tag` names an extra, limited key of the same account. */
export const keyPath = (id, tag) => join(KEY_DIR, tag ? `${id}.${tag}.json` : `${id}.json`);
export const hasKey = (id, tag) => existsSync(keyPath(id, tag));

export function saveKey(id, keyPair, tag) {
  const file = keyPath(id, tag);
  mkdirSync(dirname(file), { recursive: true });
  const body = { account_id: id, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() };
  writeFileSync(file, JSON.stringify(body) + '\n', { mode: 0o600 });
}

/** A fresh key pair for `id`, written to the key folder before it is ever used. */
export function newKey(id, tag) {
  const keyPair = KeyPair.fromRandom('ed25519');
  saveKey(id, keyPair, tag);
  return keyPair.getPublicKey().toString();
}

/** An account that can sign with the key stored for it. */
export function loadAccount(id, tag) {
  const file = keyPath(id, tag);
  if (!existsSync(file)) throw new Error(`No key for ${id} at ${file}`);
  return new Account(id, provider, JSON.parse(readFileSync(file, 'utf8')).private_key);
}

export const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });

export const call = (account, contractId, methodName, args = {}, { gas = 30n * TGAS, deposit = 0n } = {}) =>
  account.callFunctionRaw({ contractId, methodName, args, gas, deposit });

export async function accountExists(id) {
  try {
    await provider.viewAccount({ accountId: id });
    return true;
  } catch (error) {
    if (/does not exist|UNKNOWN_ACCOUNT|doesn't exist/i.test(String(error?.message ?? error))) return false;
    throw error;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Whole NEAR, as a short string for logs. */
export const near = (yocto) => (Number(BigInt(yocto) / 10n ** 20n) / 10000).toString();
export const txLink = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;
