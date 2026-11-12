// Enrols the scout swarm in one game.
// Usage: node scripts/scouts.mjs deploy/replay.json
// Each scout gets its own account, posts its own bond, and from then on works with a
// key that can only call commit, reveal, settle and collect_scout on that one coop.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { NEAR, accountExists, call, hasKey, loadAccount, newKey, view } from '../lib/near.mjs';
import { openRecord } from '../lib/record.mjs';
import { parseAmount } from '../lib/units.mjs';

/** The only methods a scout's working key may call. */
export const SCOUT_METHODS = ['commit', 'reveal', 'settle', 'collect_scout'];

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/scouts.mjs deploy/<game>.json');
const game = basename(file, '.json');
const { data: lock, note, save } = openRecord(file);
const swarm = JSON.parse(readFileSync(new URL('../deploy/swarm.json', import.meta.url), 'utf8'));
const coop = lock.coop;
const config = await view(coop, 'get_config');
const parent = loadAccount(swarm.parent);

for (const { name } of swarm.scouts) {
  const id = `${name}.${swarm.parent}`;
  if (!(await accountExists(id))) {
    const publicKey = newKey(id);
    note(`create ${id}`, await parent.createSubAccount({
      accountOrPrefix: name, publicKey, nearToTransfer: parseAmount(swarm.fund),
    }));
  }
  const scout = loadAccount(id);
  if (!(await view(coop, 'get_scout', { scout_id: id }))) {
    const deposit = BigInt(config.scout_bond);
    note(`${id} posts its bond`, await call(scout, coop, 'register_scout', { scout_id: id }, { deposit }));
  }
  // A scout is paid in coins too, and coins need a nest to land in.
  if (!(await view(coop, 'get_player', { account_id: id }))) {
    note(`${id} joins the coop`, await call(scout, coop, 'join', {}, { deposit: NEAR / 100n }));
  }
  if (!hasKey(id, game)) {
    const publicKey = newKey(id, game);
    note(`${id} gets its working key`, await scout.addFunctionCallAccessKey({
      publicKey, contractId: coop, methodNames: SCOUT_METHODS, allowance: NEAR,
    }));
  }
}
lock.scouts = swarm.scouts.map(({ name }) => `${name}.${swarm.parent}`);
save();
console.log(`\n${lock.scouts.length} scouts enrolled in ${coop}`);
