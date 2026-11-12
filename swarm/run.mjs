// Runs the whole scout swarm against one coop.
// Usage: node swarm/run.mjs deploy/replay.json
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAccount, sleep, view } from '../lib/near.mjs';
import { DAYS, dayOf, pricesOf } from './replay.mjs';
import { Scout } from './scout.mjs';
import { scripted } from './sources.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node swarm/run.mjs deploy/<game>.json');
const game = basename(file, '.json');
const { coop } = JSON.parse(readFileSync(file.replace(/\.json$/, '.lock.json'), 'utf8'));
const swarm = JSON.parse(readFileSync(new URL('../deploy/swarm.json', import.meta.url), 'utf8'));
const log = (text) => console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);

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

let seen = 0;
let day = 0;
for (;;) {
  try {
    const round = await view(coop, 'get_round');
    if (round.id !== seen) {
      day = dayOf(round, await view(coop, 'get_stats'));
      seen = round.id;
      const today = pricesOf(day);
      if (today) log(`round ${round.id} = day ${day + 1} of ${DAYS} (${today.date}): hen ${today.hen} egg ${today.egg}`);
    }
    const today = pricesOf(day);
    if (!today) {
      log('The recorded days are over. The swarm goes home.');
      break;
    }
    const last = round.last_hen_price
      ? { hen: BigInt(round.last_hen_price), egg: BigInt(round.last_egg_price) } : null;
    const ctx = { truth: { hen: today.hen, egg: today.egg }, last, round: round.id };
    for (const scout of scouts) scout.step(round, ctx);
  } catch (error) {
    log(`poll: ${error.message}`);
  }
  await sleep(3000);
}
