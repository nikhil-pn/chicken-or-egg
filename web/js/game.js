// Which game the page shows. Games live in games.json; ?game=<id> picks one.
import { isoDate, dateOf } from './format.js';

async function json(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** Reads the registry and the query string. Paths are relative, so any sub-path works. */
export async function loadGame() {
  const params = new URLSearchParams(location.search);
  const registry = await json('games.json');
  const wanted = params.get('game');
  const game = registry.games.find((g) => g.id === wanted)
    || registry.games.find((g) => g.id === registry.default)
    || registry.games[0];
  game.dateList = [];
  if (game.dates) {
    try { game.dateList = (await json(game.dates)).dates || []; } catch { /* dates are a nicety */ }
  }
  game.players = game.players || [];
  return {
    game,
    games: registry.games,
    unknown: wanted && wanted !== game.id ? wanted : null,
    fixture: params.get('fixture'),
  };
}

/**
 * Replay day of every settled round, oldest first.
 * A void round did not use up its day, so the next round plays the same day again.
 * Returns a Map: round id -> day (0 is the first recorded day).
 */
export function daysByRound(history) {
  const days = new Map();
  let voids = 0;
  for (const round of history) {
    days.set(round.id, round.id - 1 - voids);
    if (round.outcome === 'void') voids += 1;
  }
  return days;
}

/**
 * Replay day of the open round. `view` is the answer of get_stats:
 * every void round so far came before the open round.
 */
export const openDay = (round, view) => round.id - 1 - view.stats.voids;

/** "Replay day 12 of 107, prices of 7 Aug 2026". Empty for a game that is not a replay. */
export function dayText(game, day, short) {
  if (!game.replay || !Number.isInteger(day) || day < 0) return '';
  const total = game.dateList.length;
  const date = game.dateList[day];
  if (short) return date ? `Day ${day + 1} · ${isoDate(date).replace(/ \d{4}$/, '')}` : `Day ${day + 1}`;
  const count = total ? `Replay day ${day + 1} of ${total}` : `Replay day ${day + 1}`;
  if (date) return `${count}, shop prices of ${isoDate(date)}`;
  return total && day >= total ? `The replay is over: all ${total} recorded days were played` : count;
}

/**
 * When a settled round happened, in words for the page.
 * Replay: the recorded day it stands for. Live: the date it settled on, from the chain clock.
 */
export function roundWhen(game, result, days, short) {
  if (!result) return '';
  if (game.replay) return dayText(game, days.get(result.id), short);
  return short ? dateOf(result.settled_at, true) : `Settled ${dateOf(result.settled_at)}`;
}
