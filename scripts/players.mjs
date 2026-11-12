// Brings the bot players into one game.
// Usage: node scripts/players.mjs deploy/replay.json
// Each player is its own account and pays the starter fee like anyone else.
import { readFileSync } from 'node:fs';
import { TGAS, accountExists, call, loadAccount, newKey, view } from '../lib/near.mjs';
import { openRecord } from '../lib/record.mjs';
import { parseAmount } from '../lib/units.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/players.mjs deploy/<game>.json');
const { data: lock, note, save } = openRecord(file);
const plan = JSON.parse(readFileSync(new URL('../deploy/players.json', import.meta.url), 'utf8'));
const coop = lock.coop;
const config = await view(coop, 'get_config');
const parent = loadAccount(plan.parent);

for (const { name } of plan.players) {
  const id = `${name}.${plan.parent}`;
  if (!(await accountExists(id))) {
    const publicKey = newKey(id);
    note(`create ${id}`, await parent.createSubAccount({
      accountOrPrefix: name, publicKey, nearToTransfer: parseAmount(plan.fund),
    }));
  }
  const me = await view(coop, 'get_player', { account_id: id });
  if (!me?.has_starter) {
    const deposit = BigInt(config.starter_fee);
    const result = await call(loadAccount(id), coop, 'claim_starter', {}, { deposit, gas: 100n * TGAS });
    note(`${id} claims its starter pack`, result);
  }
}
lock.players = plan.players.map(({ name }) => `${name}.${plan.parent}`);
save();
console.log(`\n${lock.players.length} players in ${coop}`);
