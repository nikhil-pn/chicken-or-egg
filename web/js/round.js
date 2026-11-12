// The open round in plain words: phase, countdown, and when each step happens on the viewer's clock.
import { $, h, put, onChange } from './dom.js';
import { mmss, stamp, plural } from './format.js';
import { openDay, dayText } from './game.js';

const PHASES = ['roost', 'commit', 'reveal', 'settle'];

/**
 * Phase and seconds left right now, plus the seconds since the round opened and the phase ends.
 * The chain is asked every few seconds; between answers the page counts down by itself.
 */
export function localClock(state) {
  const { round, config } = state;
  if (!round) return null;
  const at = PHASES.indexOf(round.phase);
  if (!config || at < 0 || at > 2) return { phase: round.phase, left: Number(round.seconds_left) || 0, elapsed: null, ends: null };
  const ends = [config.roost_secs, config.roost_secs + config.commit_secs,
    config.roost_secs + config.commit_secs + config.reveal_secs];
  const elapsed = ends[at] - Number(round.seconds_left) + (Date.now() - state.roundAt) / 1000;
  for (let i = 0; i < 3; i++) {
    if (elapsed < ends[i]) return { phase: PHASES[i], left: Math.ceil(ends[i] - elapsed), elapsed, ends };
  }
  return { phase: 'settle', left: 0, elapsed, ends };
}

/** Seconds until the reports close (the result is due right after). */
export function untilResult(now) {
  if (!now || !now.ends) return now ? now.left : 0;
  return Math.max(0, Math.ceil(now.ends[2] - now.elapsed));
}

/** When each step of the open round happens, in ms on the viewer's clock (from opened_at and get_config). */
export function timeline(state) {
  const { round, config, game } = state;
  if (!round || !config) return null;
  const opened = Number(round.opened_at) / 1e6;
  const roostEnd = opened + config.roost_secs * 1000;
  const commitEnd = roostEnd + config.commit_secs * 1000;
  const revealEnd = commitEnd + config.reveal_secs * 1000;
  const readAt = game.read_before_commit_end_secs ? commitEnd - game.read_before_commit_end_secs * 1000 : null;
  return { opened, roostEnd, commitEnd, revealEnd, readAt };
}

/** True while the scouts of a daily game are due to read the shelves (the end of the commit phase). */
export const reading = (state, now) => now.phase === 'commit' && state.game.read_before_commit_end_secs > 0
  && now.left <= state.game.read_before_commit_end_secs;

const two = (n) => String(n).padStart(2, '0');

/** "12:58" today, "tomorrow 05:30", or "Fri 13 Nov, 05:30". */
export function at(ms) {
  const d = new Date(ms);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return time;
  const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === next.toDateString()) return `tomorrow ${time}`;
  return stamp(ms);
}

/** True when the replay has played every recorded day. */
export function replayOver(state) {
  const { round, stats, game } = state;
  if (!round || !game.replay || !game.dateList.length || !stats || stats.rounds_settled + 1 !== round.id) return false;
  return openDay(round, stats) >= game.dateList.length;
}

/** A countdown that ticks every second. kind: 'phase' (the open phase) or 'result' (until the reports close). */
export const tick = (kind, secs) => h('b', { class: 'countdown', 'data-until': kind, role: 'timer' }, mmss(secs));

function phaseBits(state, now) {
  const { round } = state;
  if (now.phase === 'roost') return [h('span', { class: 'round-phase is-open' }, 'Bets open'), h('span', { class: 'count' }, 'close in ', tick('phase', now.left))];
  if (now.phase === 'settle') {
    return [h('span', { class: 'round-phase' }, round.scouts ? 'Time is up: result any moment' : 'Waiting for scouts to join')];
  }
  return [h('span', { class: 'round-phase' }, 'Bets closed'), h('span', { class: 'count' }, 'result in ', tick('result', untilResult(now)))];
}

export function renderRoundLine(state) {
  const box = $('play-round');
  const { round, game, stats } = state;
  if (state.missing) {
    onChange(box, ['missing'], () => put(box, h('span', { class: 'round-phase' }, 'This game has not started yet')));
    return;
  }
  if (!round) {
    onChange(box, ['wait', Boolean(state.error)], () => put(box, h('span', { class: 'round-phase muted' },
      state.error ? 'The chain is not answering yet. Trying again.' : 'Reading the round from the chain…')));
    return;
  }
  const now = localClock(state);
  if (replayOver(state)) {
    onChange(box, ['over', round.id], () => put(box, h('span', { class: 'round-pill' }, 'Replay'),
      h('span', { class: 'round-phase' }, `All ${game.dateList.length} recorded days played`)));
    return;
  }
  const day = game.replay && stats && stats.rounds_settled + 1 === round.id ? openDay(round, stats) : null;
  onChange(box, [round.id, now.phase, round.commits, round.reveals, round.scouts, reading(state, now), Boolean(state.config), day], () => {
    put(box, h('span', { class: 'round-pill' }, `Round ${round.id}`), phaseBits(state, now),
      game.replay && day !== null ? h('span', { class: 'round-note' }, dayText(game, day)) : null);
  });
}

/** What happens while bets are closed, for the Play card: [headline, sentence], times on the viewer's clock. */
export function closedWords(state, now) {
  const { round } = state;
  const t = timeline(state);
  const result = t ? ` Result at ${at(t.revealEnd)}.` : '';
  if (now.phase === 'commit' && state.game.read_before_commit_end_secs && !reading(state, now) && t) {
    return ['Bets closed.', `The scouts read the shelves at ${at(t.readAt)}, result at ${at(t.revealEnd)}.`];
  }
  if (now.phase === 'commit') return ['Bets closed.', `The scouts are reading the shelves and sealing their reports: ${round.commits} of ${plural(round.scouts, 'scout')} sealed.${result}`];
  if (now.phase === 'reveal') return ['Bets closed.', `The scouts are opening their sealed reports: ${round.reveals} of ${round.commits} open.${result}`];
  if (!round.scouts) return ['Time is up.', 'No scouts have joined yet, so this round cannot be decided.'];
  return ['Time is up.', 'The result lands as soon as someone settles the round; then the next round opens.'];
}

let lastPhase = null;

/** Called every second: moves every countdown without asking the chain; redraws when the phase changes. */
export function tickRound(state, redraw) {
  if (!state.round) return;
  const now = localClock(state);
  if (lastPhase !== now.phase) {
    const first = lastPhase === null;
    lastPhase = now.phase;
    if (!first) { redraw(); return; }
  }
  for (const el of document.querySelectorAll('.countdown')) {
    el.textContent = mmss(el.dataset.until === 'result' ? untilResult(now) : now.left);
  }
}
