// The hero: the open round (phase, countdown, split bar) and the three score tiles.
import { $, h, put, onChange, chip } from './dom.js';
import { big, coins, mmss, plural, stamp, SIDE } from './format.js';
import { openDay, dayText } from './game.js';

const PHASES = ['roost', 'commit', 'reveal', 'settle'];
const PHASE_NAME = { roost: 'Roost', commit: 'Commit', reveal: 'Reveal', settle: 'Settle' };
const COUNT_LABEL = {
  roost: 'Roosting closes in',
  commit: 'Sealing ends in',
  reveal: 'Reveal ends in',
  settle: 'Waiting for settle',
};

/**
 * Phase and seconds left right now. The chain is asked every few seconds;
 * between answers the page counts down by itself from the last answer.
 */
export function localClock(state) {
  const { round, config } = state;
  if (!round) return null;
  const at = PHASES.indexOf(round.phase);
  if (!config || at < 0 || at > 2) return { phase: round.phase, left: Number(round.seconds_left) || 0 };
  const ends = [config.roost_secs, config.roost_secs + config.commit_secs,
    config.roost_secs + config.commit_secs + config.reveal_secs];
  const elapsed = ends[at] - Number(round.seconds_left) + (Date.now() - state.roundAt) / 1000;
  for (let i = 0; i < 3; i++) {
    if (elapsed < ends[i]) return { phase: PHASES[i], left: Math.ceil(ends[i] - elapsed) };
  }
  return { phase: 'settle', left: 0 };
}

/** True while the scouts of a daily game are due to read the shelves (the end of the commit phase). */
const reading = (state, now) => now.phase === 'commit' && state.game.read_before_commit_end_secs > 0
  && now.left <= state.game.read_before_commit_end_secs;

function phaseSentence(phase, round, state, now) {
  const scouts = round.scouts;
  if (phase === 'roost') return 'Roosting is open. Players lock $HEN or $EGG on their side. Scouts wait.';
  if (phase === 'commit' && state.game.read_before_commit_end_secs > 0 && !reading(state, now)) {
    return `Roosting is closed. The scouts read today's shop shelves about ${Math.round(state.game.read_before_commit_end_secs / 60)} `
      + `minutes before sealing ends, then seal their reports: ${round.commits} of ${scouts} sealed.`;
  }
  if (phase === 'commit') {
    return `Roosting is closed. Scouts read the shop prices and seal their reports: ${round.commits} of ${scouts} sealed.`;
  }
  if (phase === 'reveal') return `Scouts open their sealed reports: ${round.reveals} of ${round.commits} opened.`;
  if (scouts === 0) return 'Time is up, but no scouts have joined yet, so this round cannot be decided.';
  return `Time is up: ${round.reveals} of ${plural(scouts, 'scout')} opened a report. The round ends when anyone calls settle.`;
}

function splitBar(round) {
  const hen = big(round.hen_roosted);
  const egg = big(round.egg_roosted);
  const total = hen + egg;
  if (total === 0n) {
    return h('div', { class: 'split-wrap' },
      h('div', { class: 'split split-empty', role: 'img', 'aria-label': 'Nothing roosted yet this round' },
        h('span', null, 'Nobody has roosted yet this round')),
      h('div', { class: 'split-legend' },
        h('span', null, '🐔 0 HEN roosted'), h('span', null, '0 EGG roosted 🥚')));
  }
  const henPct = Number((hen * 1000n) / total) / 10;
  const eggPct = Math.round((100 - henPct) * 10) / 10;
  const bar = h('div', { class: 'split', role: 'img',
    'aria-label': `Roosted this round: ${coins(hen)} HEN (${henPct}%) and ${coins(egg)} EGG (${eggPct}%)` });
  const part = (side, pct) => {
    const el = h('div', { class: `split-part split-${side}` }, pct >= 12 ? `${pct}%` : '');
    el.style.flex = `${Math.max(pct, 1.5)} 1 0`;
    return el;
  };
  if (hen > 0n) bar.append(part('hen', henPct));
  if (egg > 0n) bar.append(part('egg', eggPct));
  return h('div', { class: 'split-wrap' }, bar,
    h('div', { class: 'split-legend' },
      h('span', null, `🐔 ${coins(hen)} HEN roosted`), h('span', null, `${coins(egg)} EGG roosted 🥚`)));
}

function stepper(phase) {
  const now = PHASES.indexOf(phase);
  return h('ol', { class: 'steps', 'aria-label': 'Phases of a round' }, PHASES.map((name, i) =>
    h('li', { class: i < now ? 'step done' : i === now ? 'step now' : 'step', 'aria-current': i === now ? 'step' : null },
      h('span', { class: 'step-n' }, i < now ? '✓' : String(i + 1)), PHASE_NAME[name])));
}

/**
 * For a game with long phases (the daily game), when each phase ends on the viewer's clock.
 * Worked out from the round's opened_at on the chain and the phase lengths in get_config.
 */
function schedule(state) {
  const { round, config, game } = state;
  if (!config || config.roost_secs + config.commit_secs + config.reveal_secs < 3600) return null;
  const opened = Number(round.opened_at) / 1e6;
  const roostEnd = opened + config.roost_secs * 1000;
  const commitEnd = roostEnd + config.commit_secs * 1000;
  const revealEnd = commitEnd + config.reveal_secs * 1000;
  const read = game.read_before_commit_end_secs ? commitEnd - game.read_before_commit_end_secs * 1000 : null;
  return h('p', { class: 'round-times' },
    h('span', null, `Roosting closes ${stamp(roostEnd)}`),
    read ? h('span', null, `scouts read the shelves about ${stamp(read)}`) : null,
    h('span', null, `reports open until ${stamp(revealEnd)}, then anyone can settle`),
    h('span', { class: 'muted' }, '(your local time)'));
}

export function renderRound(state) {
  const card = $('round-card');
  const { round, stats, game } = state;
  if (!round) {
    onChange(card, ['wait', state.error], () => put(card,
      h('p', { class: 'card-label' }, "Today's progress"),
      h('p', { class: 'loading' }, state.error ? 'The chain is not answering yet. Trying again.' : 'Reading the round from the chain…')));
    return;
  }
  const now = localClock(state);
  // The score is read once per round. Use it for the day only when it belongs to this round.
  const day = stats && stats.rounds_settled + 1 === round.id ? openDay(round, stats) : null;
  const total = game.replay ? game.dateList.length : 0;
  if (total && day !== null && day >= total) {
    renderOver(state, card, total);
    return;
  }
  const sub = game.replay
    ? dayText(game, day) || 'Replay of recorded shop prices'
    : `Opened ${stamp(Number(round.opened_at) / 1e6)} (your local time)`;
  onChange(card, [round.id, now.phase, round.hen_roosted, round.egg_roosted, round.commits, round.reveals, round.scouts, day,
    reading(state, now), Boolean(state.config)], () => {
    put(card,
      h('div', { class: 'round-head' },
        h('div', null,
          h('p', { class: 'card-label' }, "Today's progress"),
          h('p', { class: 'round-title' }, `Round ${round.id}`, game.replay ? chip('replay', 'Replay') : null),
          h('p', { class: 'round-day' }, sub)),
        h('div', { class: 'count' },
          h('span', { class: 'count-label', id: 'count-label' }, COUNT_LABEL[now.phase]),
          h('span', { class: 'count-num', id: 'count-num', role: 'timer' }, now.phase === 'settle' ? '0:00' : mmss(now.left)))),
      stepper(now.phase),
      h('p', { class: 'phase-line' }, phaseSentence(now.phase, round, state, now)),
      schedule(state),
      splitBar(round));
  });
}

/** The replay has played every recorded day: its scouts stop and no round is decided any more. */
function renderOver(state, card, total) {
  const { round } = state;
  const live = (state.games || []).find((g) => !g.replay);
  onChange(card, ['over', round.id, total], () => put(card,
    h('div', { class: 'round-head' },
      h('div', null,
        h('p', { class: 'card-label' }, "Today's progress"),
        h('p', { class: 'round-title' }, 'The replay is over', chip('replay', 'Replay')),
        h('p', { class: 'round-day' }, `All ${total} recorded days were played in ${round.id - 1} rounds.`)),
      h('div', { class: 'count' },
        h('span', { class: 'count-label' }, 'Recorded days played'),
        h('span', { class: 'count-num' }, `${total}/${total}`))),
    h('p', { class: 'phase-line' }, 'The scouts of the replay have stopped, so no more rounds will be decided. '
      + 'Every result, every mint and every burn stays on the chain below.'),
    live ? h('p', { class: 'phase-line' }, 'The game goes on with today\'s prices: ',
      h('a', { href: `?game=${encodeURIComponent(live.id)}` }, live.label), '.') : null));
}

/** Called every second: moves the countdown without touching the chain. */
export function tickRound(state) {
  if (!state.round) return;
  const now = localClock(state);
  const num = $('count-num');
  if (!num) return; // also when the replay is over: nothing counts down
  const card = $('round-card');
  if (card.dataset.phase !== now.phase) {
    card.dataset.phase = now.phase;
    renderRound(state); // the phase changed locally: redraw steps and sentence
    return;
  }
  num.textContent = now.phase === 'settle' ? '0:00' : mmss(now.left);
}

function tile(label, main, sub) {
  return h('div', { class: 'tile' }, h('p', { class: 'tile-label' }, label), h('div', { class: 'tile-main' }, main),
    sub ? h('p', { class: 'tile-sub' }, sub) : null);
}

export function renderTiles(state) {
  const box = $('tiles');
  const view = state.stats;
  if (!view) {
    onChange(box, ['wait'], () => put(box, tile('Current streak', '…'), tile('All-time score', '…'), tile('Coins that exist', '…')));
    return;
  }
  const st = view.stats;
  onChange(box, [st, view.hen_supply, view.egg_supply, view.rounds_settled], () => {
    const side = st.streak_side && SIDE[st.streak_side];
    const streak = side && st.streak > 0
      ? tile('Current streak', h('span', { class: 'big' }, `${side.emoji} ${side.coin} ×${st.streak}`),
        `${side.coin} came first ${plural(st.streak, 'round')} in a row. Best streak so far: ${st.best_streak}.`)
      : tile('Current streak', h('span', { class: 'big muted' }, 'None yet'), 'The first win starts a streak. Ties and void rounds do not break it.');
    const score = tile('All-time score',
      h('div', { class: 'score' },
        h('span', { class: 'score-item' }, h('b', null, String(st.hen_wins)), ' HEN wins'),
        h('span', { class: 'score-item' }, h('b', null, String(st.egg_wins)), ' EGG wins'),
        h('span', { class: 'score-item' }, h('b', null, String(st.ties)), st.ties === 1 ? ' tie' : ' ties')),
      `${plural(view.rounds_settled, 'round')} settled so far, ${st.voids} of them void.`);
    const supply = tile('Coins that exist',
      h('div', { class: 'score' },
        h('span', { class: 'score-item' }, h('b', null, coins(view.hen_supply, 0)), ' HEN'),
        h('span', { class: 'score-item' }, h('b', null, coins(view.egg_supply, 0)), ' EGG')),
      `Both coins started at zero. ${plural(st.players, 'account')} joined the coop, ${plural(st.starters_claimed, 'starter pack')} claimed.`);
    put(box, streak, score, supply);
  });
}
