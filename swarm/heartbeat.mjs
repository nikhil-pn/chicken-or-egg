// The shared heartbeat: asks the coop for its open round every few seconds.
import { sleep, view } from '../lib/near.mjs';
import { DAYS, dayOf, pricesOf } from './replay.mjs';

/** Yields { round, stats, day, today } on every poll, until the recorded days are over. */
export async function* heartbeat(coop, log, everyMs = 3000) {
  let seen = 0;
  let stats;
  let day = 0;
  for (;;) {
    try {
      const round = await view(coop, 'get_round');
      if (round.id !== seen) {
        stats = await view(coop, 'get_stats');
        day = dayOf(round, stats);
        seen = round.id;
        const today = pricesOf(day);
        if (today) log(`round ${round.id} = day ${day + 1} of ${DAYS} (${today.date}): hen ${today.hen} egg ${today.egg}`);
      }
      const today = pricesOf(day);
      if (!today) return log('The recorded days are over.');
      yield { round, stats, day, today };
    } catch (error) {
      log(`poll: ${error.message}`);
    }
    await sleep(everyMs);
  }
}

export const clock = (text) => console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);
