// Runs the whole scout swarm against one coop.
// Usage: node swarm/run.mjs deploy/replay.json   (or deploy/live.json with TRACKER_DIR set)
// In the live game scout-8 asks a model on NEAR AI Cloud (NEAR_AI_API_KEY, see swarm/ai.mjs); without a key it skips rounds.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAccount } from '../lib/near.mjs';
import { daily } from './daily.mjs';
import { clock as log, heartbeat } from './heartbeat.mjs';
import { Chain } from './live.mjs';
import { Scout } from './scout.mjs';
import { aiSource, perRound, scripted } from './sources.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node swarm/run.mjs deploy/<game>.json');
const game = basename(file, '.json');
// The live game reads the shop shelves once a round. The replay reads the recorded series.
const live = JSON.parse(readFileSync(file, 'utf8')).prices === 'shelf';
const stateOf = (name) => fileURLToPath(new URL(`../state/${game}/${name}.json`, import.meta.url));
const { coop } = JSON.parse(readFileSync(file.replace(/\.json$/, '.lock.json'), 'utf8'));
const swarm = JSON.parse(readFileSync(new URL('../deploy/swarm.json', import.meta.url), 'utf8'));

// The AI scout picks products from the shop listings, so it plays only the live game.
const roster = swarm.scouts.filter(({ kind }) => live || kind !== 'ai');
const scouts = roster.map(({ name, kind }, index) => {
  const id = `${name}.${swarm.parent}`;
  return new Scout({
    id, coop, log, turn: index, of: roster.length,
    account: loadAccount(id, game), // the working key: commit, reveal, settle, collect_scout only
    source: kind === 'ai'
      ? aiSource({ file: stateOf('ai-chain'), log })
      : (live ? perRound : scripted)(kind, 1000 + index),
    stateFile: stateOf(name),
  });
});
log(`${scouts.length} scouts watching ${coop}`);

const beat = live ? daily(coop, log, new Chain(stateOf('chain'))) : heartbeat(coop, log);
for await (const { round, today, raw = null } of beat) {
  // In the live game the scouts seal nothing before the round's shelf reading is in.
  if (round.phase === 'commit' && !today) continue;
  const last = round.last_hen_price
    ? { hen: BigInt(round.last_hen_price), egg: BigInt(round.last_egg_price) } : null;
  const ctx = { truth: today && { hen: today.hen, egg: today.egg }, last, round: round.id, raw };
  for (const scout of scouts) scout.step(round, ctx);
}
