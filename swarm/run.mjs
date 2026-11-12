// Runs the whole scout swarm against one coop.
// Usage: node swarm/run.mjs deploy/replay.json   (or deploy/live.json with TRACKER_DIR set)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAccount } from '../lib/near.mjs';
import { daily } from './daily.mjs';
import { clock as log, heartbeat } from './heartbeat.mjs';
import { Chain } from './live.mjs';
import { Scout } from './scout.mjs';
import { perRound, scripted } from './sources.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node swarm/run.mjs deploy/<game>.json');
const game = basename(file, '.json');
// The live game reads the shop shelves once a round. The replay reads the recorded series.
const live = JSON.parse(readFileSync(file, 'utf8')).prices === 'shelf';
const stateOf = (name) => fileURLToPath(new URL(`../state/${game}/${name}.json`, import.meta.url));
const { coop } = JSON.parse(readFileSync(file.replace(/\.json$/, '.lock.json'), 'utf8'));
const swarm = JSON.parse(readFileSync(new URL('../deploy/swarm.json', import.meta.url), 'utf8'));

const scouts = swarm.scouts.map(({ name, kind }, index) => {
  const id = `${name}.${swarm.parent}`;
  return new Scout({
    id, coop, log, turn: index, of: swarm.scouts.length,
    account: loadAccount(id, game), // the working key: commit, reveal, settle, collect_scout only
    source: (live ? perRound : scripted)(kind, 1000 + index),
    stateFile: stateOf(name),
  });
});
log(`${scouts.length} scouts watching ${coop}`);

const beat = live ? daily(coop, log, new Chain(stateOf('chain'))) : heartbeat(coop, log);
for await (const { round, today } of beat) {
  // In the live game the scouts seal nothing before the round's shelf reading is in.
  if (round.phase === 'commit' && !today) continue;
  const last = round.last_hen_price
    ? { hen: BigInt(round.last_hen_price), egg: BigInt(round.last_egg_price) } : null;
  const ctx = { truth: today && { hen: today.hen, egg: today.egg }, last, round: round.id };
  for (const scout of scouts) scout.step(round, ctx);
}
