// The record of a deployment: account ids and the hash of every transaction, kept in the repository.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { txLink } from './near.mjs';

/** Opens `deploy/<game>.lock.json` next to the plan `deploy/<game>.json`. */
export function openRecord(planFile) {
  const file = planFile.replace(/\.json$/, '.lock.json');
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  data.txs ??= {};
  const save = () => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  /** Writes the transaction down the moment it is final. */
  const note = (step, result) => {
    data.txs[step] = result.transaction.hash;
    save();
    console.log(`${step}: ${txLink(result.transaction.hash)}`);
  };
  return { file, data, note, save };
}
