// The bet panel of the Play view: amounts, one big button, one honest line, progress and success.
import { $, h, put, onChange } from './dom.js';
import { big, coins, bps, near, SIDE, TX } from './format.js';
import { sticker, coinSticker } from './stickers.js';
import { localClock, closedWords, timeline, tick, untilResult, replayOver } from './round.js';
import * as wallet from './wallet.js';

const E18 = 10n ** 18n;
const CHIPS = ['100', '250', '500', 'all'];

/** Coins this account can put on `side` in one bet: all from the nest, or all from the wallet. */
export function available(state, side) {
  const starter = state.config ? big(state.config[`starter_${side}`]) : 1000n * E18;
  const me = state.wallet && state.wallet.me;
  if (!me) return starter; // a new player starts with the starter pack
  const inWallet = big(me.wallet[side]) + (me.hasStarter ? 0n : starter);
  const inNest = big(me.nest[side]);
  return inWallet > inNest ? inWallet : inNest;
}

const amountOf = (state) => (state.pick.amount === 'all' ? available(state, state.pick.side) : BigInt(state.pick.amount) * E18);

/** Can the player pick a side right now? */
export function canPick(state) {
  const now = localClock(state);
  return Boolean(now) && now.phase === 'roost' && !state.missing && !replayOver(state)
    && state.wallet.status !== 'off' && state.pick.stage !== 'busy';
}

function honestLine(state, amount) {
  const { round, config } = state;
  if (round.last_hen_price === null) {
    return h('p', { class: 'honest' }, `Round ${round.id} only sets the starting prices: every bet comes back unchanged. Wins and losses start next round.`);
  }
  const win = config ? bps(config.hatch_bps) : '3%';
  const lose = config ? bps(config.fry_bps) : '3%';
  const coin = SIDE[state.pick.side].coin;
  const exact = config ? `On ${coins(amount, 0)} ${coin}: win +${coins((amount * BigInt(config.hatch_bps)) / 10000n)}, lose −${coins((amount * BigInt(config.fry_bps)) / 10000n)}.` : null;
  return h('p', { class: 'honest', title: exact }, 'Win ', h('b', null, `+${win}`), ' · Lose ', h('b', null, `−${lose}`), ' · Tie: nothing changes');
}

function starterNote(state) {
  const me = state.wallet.me;
  if (me && me.hasStarter) return null;
  const c = state.config;
  const pack = c ? `${coins(c.starter_hen, 0)} $HEN + ${coins(c.starter_egg, 0)} $EGG` : 'free $HEN + $EGG';
  const fee = me && me.starterFee !== undefined ? me.starterFee : c && c.starter_fee;
  return h('p', { class: 'bet-note' }, coinSticker('hen', { size: 'xs', tilt: -8 }), coinSticker('egg', { size: 'xs', tilt: 8 }),
    h('span', null, `${me ? '' : 'New here? '}Your first bet also gets you ${pack}${fee ? ` for ${near(fee, 1).replace(' NEAR', ' testnet NEAR')}` : ''}.`));
}

function amounts(state, busy) {
  const side = SIDE[state.pick.side].coin;
  return h('div', { class: 'amounts', role: 'group', 'aria-label': `How much $${side} to bet` }, CHIPS.map((chip) =>
    h('button', { class: 'amt', type: 'button', 'aria-pressed': String(state.pick.amount === chip), disabled: busy,
      onclick: () => { state.pick = { ...state.pick, amount: chip, error: null }; state.redraw(); } },
    chip === 'all' ? 'All' : chip)));
}

async function act(state, job, okStage) {
  try {
    const out = await job();
    state.pick = { ...state.pick, stage: okStage, step: null, txs: (out && out.txs) || [] };
  } catch (problem) {
    state.pick = { ...state.pick, stage: 'pick', step: null, error: (problem && problem.message) || 'That did not go through. Try again.' };
  }
  state.redraw();
  wallet.refreshMe(state);
}

function placeBet(state) {
  const side = state.pick.side;
  const amount = amountOf(state);
  state.pick = { ...state.pick, stage: 'busy', step: { step: 1, of: 1, label: 'Waiting for your wallet' }, error: null,
    placed: { side, amount: amount.toString() } };
  state.redraw();
  act(state, () => wallet.placeBet(state, side, amount, (step) => { state.pick.step = step; state.redraw(); }), 'done');
}

function signIn(state, kind) {
  state.pick = { ...state.pick, stage: 'busy', step: { step: 1, of: 1, label: kind === 'guest' ? 'Making your guest account' : 'Opening your wallet' }, error: null };
  state.redraw();
  act(state, async () => { await wallet.signIn(state, kind); }, 'pick');
}

const busyButton = (side, step) => h('button', { class: `btn cta cta-busy btn-${side}`, type: 'button', disabled: true, 'aria-live': 'polite' },
  h('span', { class: 'spin', 'aria-hidden': 'true' }), step.of > 1 ? `Step ${step.step} of ${step.of}: ${step.label}` : step.label);

/** The main button and what sits right under it, for a player who can bet now. */
function action(state) {
  const { pick } = state;
  const side = pick.side;
  const coin = SIDE[side].coin;
  if (pick.stage === 'busy') return busyButton(side, pick.step);
  if (!state.wallet.account) {
    return h('div', { class: state.wallet.guestOk ? 'cta-row' : '' },
      state.wallet.guestOk ? h('button', { class: `btn btn-${side}`, type: 'button', onclick: () => signIn(state, 'guest') }, 'Play without a wallet') : null,
      h('button', { class: state.wallet.guestOk ? 'btn' : `btn cta btn-${side}`, type: 'button', onclick: () => signIn(state, 'wallet') }, 'Connect wallet'));
  }
  const me = state.wallet.me;
  if (!me) return h('button', { class: `btn cta btn-${side}`, type: 'button', disabled: true }, 'Reading your coins…');
  const mine = me.roost && me.roost.round === state.round.id ? me.roost : null;
  if (mine && mine.side !== side) {
    const there = SIDE[mine.side];
    return h('button', { class: `btn cta btn-${mine.side}`, type: 'button',
      onclick: () => { state.pick = { ...pick, side: mine.side, error: null }; state.redraw(); } },
    `You're on ${there.food} this round: add more $${there.coin}`);
  }
  const amount = amountOf(state);
  const have = available(state, side);
  if (have === 0n) return h('button', { class: `btn cta btn-${side}`, type: 'button', disabled: true }, `You have no $${coin} to bet`);
  if (amount > have) return h('button', { class: `btn cta btn-${side}`, type: 'button', disabled: true }, `You have ${coins(have, 0)} $${coin}: tap All`);
  return h('button', { class: `btn cta btn-${side}`, type: 'button', onclick: () => placeBet(state) },
    `${mine ? 'Add' : 'Bet'} ${coins(amount, 0)} $${coin}`);
}

function doneCard(state) {
  const { placed, txs } = state.pick;
  const s = SIDE[placed.side];
  const last = txs && txs.length ? txs[txs.length - 1] : null;
  return h('div', { class: 'bet-done', role: 'status' }, sticker('chick', { size: 'lg', tilt: -8 }),
    h('div', null,
      h('p', { class: 'bet-big' }, `You're in: ${coins(placed.amount, 0)} $${s.coin} on ${s.food}.`),
      h('p', { class: 'bet-small' }, last && !state.wallet.mock
        ? h('a', { href: TX + encodeURIComponent(last), target: '_blank', rel: 'noopener' }, 'See it on the explorer')
        : last ? `Fake transaction ${last} (mock wallet)` : null),
      h('p', { class: 'bet-small' }, h('button', { class: 'link-btn', type: 'button',
        onclick: () => { state.pick = { ...state.pick, stage: 'pick', txs: null }; state.redraw(); } }, 'Bet more'))));
}

function closedCard(state, now) {
  const [title, words] = closedWords(state, now);
  const me = state.wallet.me;
  const mine = me && me.roost && me.roost.round === state.round.id ? me.roost : null;
  return h('div', { class: 'bet-closed' }, sticker('scout', { size: 'lg', tilt: 6 }),
    h('div', null,
      h('p', { class: 'bet-big' }, title),
      h('p', { class: 'bet-small' }, words),
      now.phase !== 'settle' && timeline(state)
        ? h('p', { class: 'bet-small' }, 'Next round opens in about ', tick('result', untilResult(now))) : null,
      mine ? h('p', { class: 'bet-small' }, 'Your bet: ', h('b', null, `${coins(mine.amount, 0)} $${SIDE[mine.side].coin} on ${SIDE[mine.side].food}`), '.') : null));
}

const offCard = (art, big1, small) => h('div', { class: 'bet-off' }, sticker(art, { size: 'lg', tilt: -6 }),
  h('div', null, h('p', { class: 'bet-big' }, big1), small ? h('p', { class: 'bet-small' }, small) : null));

export function renderBet(state) {
  const box = $('play-bet');
  const { round, pick } = state;
  const now = localClock(state);
  const w = state.wallet;
  const over = replayOver(state);
  onChange(box, [round && round.id, now && now.phase, round && round.last_hen_price === null, state.missing, over, w.status,
    w.account, w.guestOk, w.me, pick.side, pick.amount, pick.stage, pick.step, pick.error, pick.txs, Boolean(state.config),
    round && round.commits, round && round.reveals], () => {
    if (state.missing) return put(box, offCard('egg', 'This game has not started yet.', 'Round 1 shows up here as soon as the coop is deployed. This page checks once a minute.'));
    if (!round) return put(box, h('div', { class: 'bet-hint' }, 'Reading the round…'));
    if (over) {
      const live = (state.games || []).find((g) => !g.replay);
      return put(box, offCard('nest', 'The replay is over: every recorded day was played.',
        live ? h('a', { href: `?game=${encodeURIComponent(live.id)}#/` }, 'Play the live game') : null));
    }
    if (now.phase !== 'roost') return put(box, closedCard(state, now));
    if (pick.stage === 'done' && pick.placed) return put(box, doneCard(state));
    if (w.status === 'off' && state.rpc.fixture) return put(box, offCard('seal', 'No betting on fixture data.', 'Add ?mock=1 to try the bet flow with a fake wallet.'));
    if (w.status === 'off') return put(box, offCard('seal', 'Betting is coming online.', 'The round is live: watch the coins move while the bet button is wired up.'));
    if (!pick.side) return put(box, h('div', { class: 'bet-hint' }, 'Tap chicken or eggs to pick your side'));
    if (w.status === 'loading') return put(box, amounts(state, true), busyButton(pick.side, { step: 1, of: 1, label: 'Loading the wallet' }));
    const amount = amountOf(state);
    put(box, amounts(state, pick.stage === 'busy'), action(state),
      pick.error ? h('p', { class: 'bet-error', role: 'alert' }, pick.error) : null,
      honestLine(state, amount), starterNote(state));
  });
}
