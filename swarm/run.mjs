// Runs the whole scout swarm against one coop.
// Usage: node swarm/run.mjs deploy/replay.json
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAccount } from '../lib/near.mjs';
import { clock as log, heartbeat } from './heartbeat.mjs';
import { Scout } from './scout.mjs';
import { scripted } from './sources.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node swarm/run.mjs deploy/<game>.json');
const game = basename(file, '.json');
const { coop } = JSON.parse(readFileSync(file.replace(/\.json$/, '.lock.json'), 'utf8'));
const swarm = JSON.parse(readFileSync(new URL('../deploy/swarm.json', import.meta.url), 'utf8'));

const scouts = swarm.scouts.map(({ name, kind }, index) => {
  const id = `${name}.${swarm.parent}`;
  return new Scout({
    id, coop, log, turn: index, of: swarm.scouts.length,
    account: loadAccount(id, game), // the working key: commit, reveal, settle, collect_scout only
    source: scripted(kind, 1000 + index),
    stateFile: fileURLToPath(new URL(`../state/${game}/${name}.json`, import.meta.url)),
  });
});
log(`${scouts.length} scouts watching ${coop}`);

for await (const { round, today } of heartbeat(coop, log)) {
  const last = round.last_hen_price
    ? { hen: BigInt(round.last_hen_price), egg: BigInt(round.last_egg_price) } : null;
  const ctx = { truth: { hen: today.hen, egg: today.egg }, last, round: round.id };
  for (const scout of scouts) scout.step(round, ctx);
}
