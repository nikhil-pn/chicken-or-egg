// Throws away every access key of the two coins and the coop.
// After this nobody, including us, can change their code or move their funds.
// Usage: node scripts/lock.mjs deploy/replay.json
import { hasKey, loadAccount, provider } from '../lib/near.mjs';
import { openRecord } from '../lib/record.mjs';

const record = openRecord(process.argv[2] ?? 'deploy/replay.json');
const keysOf = async (accountId) => (await provider.viewAccessKeyList({ accountId })).keys.map((key) => key.public_key);

for (const id of [record.data.hen, record.data.egg, record.data.coop]) {
  let keys = await keysOf(id);
  if (keys.length && !hasKey(id)) throw new Error(`${id} still has keys, and we hold none of them`);
  if (keys.length) {
    const account = loadAccount(id);
    const own = (await account.getSigner().getPublicKey()).toString();
    // The key that signs goes last.
    for (const key of [...keys.filter((k) => k !== own), own]) {
      record.note(`${id} drops key ${key.slice(8, 16)}`, await account.deleteKey(key));
    }
    keys = await keysOf(id);
  }
  if (keys.length) throw new Error(`${id} still has ${keys.length} keys`);
  console.log(`${id}: no access keys left`);
}
record.data.locked = true;
record.save();
