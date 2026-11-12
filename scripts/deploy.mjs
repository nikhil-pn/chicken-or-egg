// Deploys one game: the two coins and the coop, as sub-accounts of a home account.
// Usage: node scripts/deploy.mjs deploy/replay.json
// Safe to run again: accounts and contracts that already exist are left alone.
import { actions } from 'near-api-js';
import { readFileSync } from 'node:fs';
import { NEAR, TGAS, accountExists, call, loadAccount, newKey, provider } from '../lib/near.mjs';
import { openRecord } from '../lib/record.mjs';
import { parseAmount, withAmounts } from '../lib/units.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/deploy.mjs deploy/<game>.json');
const plan = JSON.parse(readFileSync(file, 'utf8'));
const { file: lockFile, data: lock, note } = openRecord(file);

const home = plan.home;
const ids = { hen: `hen.${home}`, egg: `egg.${home}`, coop: `coop.${home}` };
Object.assign(lock, { home, ...ids });

/** Creates `prefix.<owner>` with a fresh key and `amount` NEAR, unless it is already there. */
async function subAccount(owner, prefix, amount) {
  const id = `${prefix}.${owner}`;
  if (await accountExists(id)) return console.log(`${id} already exists`);
  const publicKey = newKey(id);
  const result = await loadAccount(owner).createSubAccount({
    accountOrPrefix: prefix, publicKey, nearToTransfer: parseAmount(amount),
  });
  note(`create ${id}`, result);
}

/** Puts the wasm on `id` and calls `new` in the same transaction, unless code is already there. */
async function deploy(id, crate, args) {
  const state = await provider.viewAccount({ accountId: id });
  if (state.code_hash !== '11111111111111111111111111111111') return console.log(`${id} already has code`);
  const code = readFileSync(new URL(`../target/near/${crate}/${crate}.wasm`, import.meta.url));
  const result = await loadAccount(id).signAndSendTransaction({
    receiverId: id,
    actions: [actions.deployContract(code), actions.functionCall('new', args, 100n * TGAS, 0n)],
  });
  note(`deploy ${id}`, result);
}

const icon = (emoji, colour) => "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E"
  + `%3Ccircle cx='48' cy='48' r='48' fill='%23${colour}'/%3E`
  + `%3Ctext x='48' y='67' font-size='54' text-anchor='middle'%3E${emoji}%3C/text%3E%3C/svg%3E`;

const dot = home.indexOf('.');
if (!(await accountExists(home))) await subAccount(home.slice(dot + 1), home.slice(0, dot), plan.fund.home);
for (const name of ['hen', 'egg', 'coop']) await subAccount(home, name, plan.fund[name]);

await deploy(ids.hen, 'coe_token', { minter: ids.coop, name: 'Hen', symbol: 'HEN', decimals: 18, icon: icon('🐔', 'ffd54a') });
await deploy(ids.egg, 'coe_token', { minter: ids.coop, name: 'Egg', symbol: 'EGG', decimals: 18, icon: icon('🥚', '7ec8e3') });
const config = { hen_token: ids.hen, egg_token: ids.egg, ...withAmounts(plan.config) };
await deploy(ids.coop, 'coe_coop', { config });

// The coop holds roosted coins, so it needs a balance line on both coins.
for (const coin of [ids.hen, ids.egg]) {
  const has = await provider.callFunction({ contractId: coin, method: 'storage_balance_of', args: { account_id: ids.coop } });
  if (has) continue;
  const result = await call(loadAccount(home), coin, 'storage_deposit', { account_id: ids.coop }, { deposit: NEAR / 100n });
  note(`register coop on ${coin}`, result);
}
console.log(`\nDeployed. Coop: ${ids.coop}\nRecord: ${lockFile}`);
