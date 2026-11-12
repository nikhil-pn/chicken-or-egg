// The live game's heartbeat: one round a day, one look at the shelves per round.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sleep, view } from '../lib/near.mjs';
import { readShelf } from './shelf.mjs';

/** The scouts look at the shelves when the commit phase has this long left. */
const READ_AT_SECS = 45 * 60;
/** A reading that fails is tried again this much later. */
const RETRY_MS = 10 * 60_000;

/** The raw listings of a round live next to the chain: state/<game>/raw/<round>.json. */
const rawFile = (dir, id) => join(dir, 'raw', `${id}.json`);
export function saveRaw(dir, id, raw) {
  mkdirSync(join(dir, 'raw'), { recursive: true });
  writeFileSync(rawFile(dir, id), JSON.stringify(raw) + '\n');
}
export const loadRaw = (dir, id) => (existsSync(rawFile(dir, id)) ? JSON.parse(readFileSync(rawFile(dir, id), 'utf8')) : null);

/**
 * Yields { round, stats, today, raw } on every poll. `today` is null until the round's reading is in;
 * `raw` is that reading's listings before any filter (for the AI scout), or null.
 * Without a `chain` nothing is read: the bot players only need the round.
 */
export async function* daily(coop, log, chain = null, read = readShelf) {
  let seen = 0;
  let stats;
  let nextRead = 0;
  let raw = { id: 0, listings: null }; // the last round's raw listings, kept in memory
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
        const { raw: listings, ...shelf } = await read(undefined, log);
        // Saved before the link, so a reading in the chain always has its listings, even after a restart.
        if (listings) saveRaw(dirname(chain.file), round.id, listings);
        raw = { id: 0, listings: null };
        const added = chain.add(round.id, shelf);
        log(added
          ? `round ${round.id} reading: hen ${added.hen} egg ${added.egg}`
          : `round ${round.id}: too few products match the last reading`);
      }
      const today = chain?.at(round.id) ?? null;
      if (today && raw.id !== round.id) raw = { id: round.id, listings: loadRaw(dirname(chain.file), round.id) };
      yield { round, stats, today, raw: today ? raw.listings : null };
      // Poll fast only when something is about to happen.
      if (round.phase === 'settle' || round.seconds_left < 120) wait = 3000;
      else if (due) wait = 10_000;
    } catch (error) {
      log(`poll: ${error.message}`);
    }
    await sleep(wait);
  }
}
