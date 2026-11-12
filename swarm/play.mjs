// Runs the bot players against one coop.
// Usage: node swarm/play.mjs deploy/replay.json
import { readFileSync } from 'node:fs';
import { loadAccount, view } from '../lib/near.mjs';
import { makePlayer, mulberry32 } from '../sim/strategies.mjs';
import { daily } from './daily.mjs';
import { clock as log, heartbeat } from './heartbeat.mjs';
import { Player } from './player.mjs';
import { truths } from './replay.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node swarm/play.mjs deploy/<game>.json');
const { coop, hen, egg } = JSON.parse(readFileSync(file.replace(/\.json$/, '.lock.json'), 'utf8'));
const plan = JSON.parse(readFileSync(new URL('../deploy/players.json', import.meta.url), 'utf8'));
// In the live game nobody knows the answer in advance, so `sharp` flips a coin like the rest.
const live = JSON.parse(readFileSync(file, 'utf8')).prices === 'shelf';
const truth = truths((await view(coop, 'get_config')).tie_bps);

const players = plan.players.map(({ name, kind }, index) => {
  const id = `${name}.${plan.parent}`;
  return new Player({
    id, coop, log, coins: { hen, egg }, shareBps: plan.share_bps,
    account: loadAccount(id),
    pick: makePlayer(kind, mulberry32(2000 + index)),
    claimEvery: 20 + index, // not all in the same round
  });
});
log(`${players.length} players in ${coop}`);

for await (const { round, stats, day } of live ? daily(coop, log) : heartbeat(coop, log)) {
  // In the replay `sharp` is a script too: it is told the day's answer and is right 65% of the time.
  const ctx = { prevWinner: stats.stats.streak_side?.toUpperCase() ?? null, truthResult: live ? null : truth[day] };
  for (const player of players) player.step(round, ctx);
}
