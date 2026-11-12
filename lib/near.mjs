// A thin layer over near-api-js: one provider, accounts loaded from the key folder.
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const NETWORK = process.env.NEAR_NETWORK ?? 'testnet';
export const RPC_URL = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
// Same folder and file format as the near CLI, so both tools share keys.
const KEY_DIR = process.env.NEAR_KEY_DIR ?? join(homedir(), '.near-credentials', NETWORK);

export const provider = new JsonRpcProvider({ url: RPC_URL });
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
