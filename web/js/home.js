// The Play view around the bet panel: the two sides, your position, the last result and the strip.
import { $, h, put, onChange } from './dom.js';
import { big, coins, plural, shortName, SIDE } from './format.js';
import { sideSticker, sticker } from './stickers.js';
import { localClock, replayOver } from './round.js';
import { canPick } from './bet.js';
import { lastLine } from './result.js';
import * as wallet from './wallet.js';

const STRIP = 7; // the last few results, the streak ritual

/** Known players backing each side this round: the players listed in games.json, plus you. */
function backers(state) {
  const count = { hen: 0, egg: 0 };
  const round = state.round;
  for (const view of state.players.values()) {
    if (view && view.roost && view.roost.round === round.id && view.roost.side in count) count[view.roost.side] += 1;
  }
  const me = state.wallet.me;
  const listed = state.game.players.includes(state.wallet.account);
  if (me && me.roost && me.roost.round === round.id && !listed) count[me.roost.side] += 1;
  return count;
}

/** Percent of the roosted coins on each side, adding up to 100. */
function shares(round) {
  const hen = big(round.hen_roosted);
  const egg = big(round.egg_roosted);
  const total = hen + egg;
  if (total === 0n) return null;
  const henPct = Number((hen * 1000n) / total) / 10;
  const round1 = (p) => (p > 0 && p < 1 ? '<1' : p > 99 && p < 100 ? '>99' : String(Math.round(p)));
  return { hen: round1(henPct), egg: round1(100 - henPct), coins: { hen, egg } };
}

function sideCard(state, side, split, count, open) {
  const s = SIDE[side];
  const picked = state.pick.side === side;
  const players = count[side];
  const roosted = split ? split.coins[side] : 0n;
  const foot = roosted > 0n
    ? `${coins(roosted, 0)} ${s.coin} · ${plural(players, 'known player')}`
    : 'No bets yet';
  return h('button', {
    class: `side side-${side}`, type: 'button', 'aria-pressed': String(picked), 'aria-disabled': open ? null : 'true',
    'aria-label': `${s.Food}, $${s.coin}: ${split ? `${split[side]}% of the coins` : 'no coins yet'}, ${plural(players, 'known player')}.${open ? ` Pick ${s.food}.` : ''}`,
    onclick: () => {
      if (!canPick(state)) return;
      state.pick = { ...state.pick, side, stage: state.pick.stage === 'done' ? 'pick' : state.pick.stage, error: null };
      state.redraw();
    },
  },
  picked ? h('span', { class: 'side-pick', 'aria-hidden': 'true' }, 'Your pick') : null,
  sideSticker(side, { size: 'lg' }),
  h('span', { class: 'side-name' }, s.Food),
  h('span', { class: 'side-coin' }, `$${s.coin}`),
  h('span', { class: 'side-pct' }, split ? `${split[side]}%` : '–'),
  h('span', { class: 'side-foot' }, foot));
}

export function renderSides(state) {
  const box = $('play-sides');
  const { round } = state;
  if (!round || state.missing) {
    onChange(box, ['wait', state.missing], () => put(box,
      sideCard({ ...state, pick: { side: null } }, 'hen', null, { hen: 0, egg: 0 }, false),
      h('span', { class: 'or', 'aria-hidden': 'true' }, 'or'),
      sideCard({ ...state, pick: { side: null } }, 'egg', null, { hen: 0, egg: 0 }, false)));
    return;
  }
  const split = shares(round);
  const count = backers(state);
  const open = canPick(state);
  const now = localClock(state);
  onChange(box, [round.id, round.hen_roosted, round.egg_roosted, count, open, state.pick.side, now.phase, replayOver(state)], () => {
    box.classList.toggle('has-pick', Boolean(state.pick.side) && open);
    put(box, sideCard(state, 'hen', split, count, open), h('span', { class: 'or', 'aria-hidden': 'true' }, 'or'),
      sideCard(state, 'egg', split, count, open));
  });
}

function cashOut(state, button) {
  button.disabled = true;
  button.textContent = 'Cashing out…';
  wallet.cashOut(state).then(() => wallet.refreshMe(state), (problem) => {
    state.pick = { ...state.pick, error: (problem && problem.message) || 'Cash out did not go through.' };
    state.redraw();
  });
}

/** Your position: this round's bet, streak, wallet and nest. Only when signed in. */
export function renderMe(state) {
  const box = $('play-me');
  const w = state.wallet;
  const me = w.me;
  onChange(box, [w.account, me, state.round && state.round.id], () => {
    if (!w.account) return put(box);
    if (!me) return put(box, h('span', { class: 'me-who' }, shortName(w.account)), h('span', { class: 'muted' }, 'Reading your coins…'));
    const mine = me.roost && state.round && me.roost.round === state.round.id ? me.roost : null;
    const nest = big(me.nest.hen) + big(me.nest.egg);
    const pair = (o) => `${coins(o.hen, 0)} $HEN · ${coins(o.egg, 0)} $EGG`;
    put(box,
      h('span', { class: 'me-who', title: w.account }, sticker(mine ? (mine.side === 'hen' ? 'coin-hen' : 'coin-egg') : 'nest', { size: 'xs' }), ' ', shortName(w.account)),
      h('span', null, mine ? ['This round: ', h('b', null, `${coins(mine.amount, 0)} $${SIDE[mine.side].coin}`), ` on ${SIDE[mine.side].food}`] : 'No bet this round'),
      h('span', null, 'Streak ', h('b', null, String(me.streak)), me.bestStreak ? ` (best ${me.bestStreak})` : ''),
      h('span', null, 'Wallet ', h('b', null, pair(me.wallet))),
      nest > 0n ? h('span', null, 'Nest ', h('b', null, pair(me.nest)), ' ',
        h('button', { class: 'link-btn', type: 'button', onclick: (e) => cashOut(state, e.currentTarget) }, 'Cash out')) : null);
  });
}

function stripChip(round, isLast) {
  const text = { hen: 'HEN', egg: 'EGG', tie: 'TIE', void: 'VOID', baseline: 'START' }[round.outcome] || round.outcome;
  const name = { hen: '$HEN came first', egg: '$EGG came first', tie: 'a tie', void: 'void', baseline: 'starting prices' }[round.outcome] || round.outcome;
  return h('span', { class: `strip-chip strip-${round.outcome}${isLast ? ' strip-last' : ''}`, title: `Round ${round.id}: ${name}` }, text);
}

/** The last result in one line, and the strip of recent results with the current streak. */
export function renderLast(state) {
  const box = $('play-last');
  const { stats, history } = state;
  if (!stats || state.missing) {
    onChange(box, ['wait', state.missing], () => put(box));
    return;
  }
  const last = history[history.length - 1] || null;
  const recent = history.slice(-STRIP);
  const st = stats.stats;
  onChange(box, [last && last.id, recent.map((r) => r.outcome), st.streak, st.streak_side, stats.rounds_settled], () => {
    const empty = Array.from({ length: STRIP - recent.length }, () => h('span', { class: 'strip-chip strip-none', 'aria-hidden': 'true' }, '?'));
    const side = st.streak_side && SIDE[st.streak_side];
    const line = last ? lastLine(last, state)
      : stats.rounds_settled ? 'Loading the last result…'
        : 'No results yet. The first round sets the starting prices; the first winner comes the round after.';
    put(box,
      h('p', { class: 'last-line' }, line),
      h('div', { class: 'strip', role: 'list', 'aria-label': `The last ${recent.length} results, oldest first` },
        recent.map((r, i) => {
          const chip = stripChip(r, i === recent.length - 1);
          chip.setAttribute('role', 'listitem');
          return chip;
        }), empty,
        side && st.streak > 1 ? h('span', { class: 'streak' }, `${side.coin} ×${st.streak} in a row`) : null));
  });
}

/** Small links under the game: the other views and the other game. */
export function renderLinks(state) {
  const box = $('play-links');
  const other = (state.games || []).find((g) => g.id !== state.game.id);
  const link = (href, art, text) => h('a', { href }, sticker(art, { size: 'xs' }), text);
  put(box,
    link('#/how', 'chick', 'How it works'),
    link('#/scouts', 'scout', 'The scouts'),
    link('#/stats', 'nest', 'Stats'),
    link('#/proof', 'seal', 'On chain'),
    other ? link(state.gameHref(other.id), other.replay ? 'coin-egg' : 'coin-hen', other.replay ? 'Replay' : 'Live game') : null);
}

