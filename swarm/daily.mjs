// The live game's heartbeat: one round a day, one look at the shelves per round.
import { sleep, view } from '../lib/near.mjs';
import { readShelf } from './shelf.mjs';

/** The scouts look at the shelves when the commit phase has this long left. */
const READ_AT_SECS = 45 * 60;
/** A reading that fails is tried again this much later. */
const RETRY_MS = 10 * 60_000;

/**
 * Yields { round, stats, today } on every poll. `today` is null until the round's reading is in.
 * Without a `chain` nothing is read: the bot players only need the round.
 */
export async function* daily(coop, log, chain = null, read = readShelf) {
  let seen = 0;
  let stats;
  let nextRead = 0;
  for (;;) {
    let wait = 30_000;
    try {
      const round = await view(coop, 'get_round');
      if (round.id !== seen) {
        stats = await view(coop, 'get_stats');
        seen = round.id;
        log(`round ${round.id} is open`);
      }
      const due = chain && round.phase === 'commit' && round.seconds_left <= READ_AT_SECS;
      if (due && !chain.at(round.id) && Date.now() >= nextRead) {
        nextRead = Date.now() + RETRY_MS;
        const today = chain.add(round.id, await read(undefined, log));
        log(today
          ? `round ${round.id} reading: hen ${today.hen} egg ${today.egg}`
          : `round ${round.id}: too few products match the last reading`);
      }
      yield { round, stats, today: chain?.at(round.id) ?? null };
      // Poll fast only when something is about to happen.
      if (round.phase === 'settle' || round.seconds_left < 120) wait = 3000;
      else if (due) wait = 10_000;
    } catch (error) {
      log(`poll: ${error.message}`);
    }
    await sleep(wait);
  }
}
