// The last result, in one plain sentence.
import { $, h, put, onChange, chip } from './dom.js';
import { big, coins, near, moveWords, pricePer, plural, SIDE, other } from './format.js';
import { daysByRound, roundWhen } from './game.js';

/** Ledger lines of one round, summed by kind: { hatch, scout_pay, fry } in base units. */
export function ledgerOfRound(ledger, id) {
  const sum = { hatch: 0n, scout_pay: 0n, fry: 0n, found: false };
  for (const entry of ledger) {
    if (entry.round !== id || !(entry.kind in sum)) continue;
    sum[entry.kind] += big(entry.amount);
    sum.found = true;
  }
  return sum;
}

function sentence(round, state) {
  const unit = state.game.price;
  const need = state.config ? state.config.min_reveals : null;
  const moves = `${moveWords('chicken', round.hen_move_ppm)}, ${moveWords('eggs', round.egg_move_ppm)}.`;
  if (round.outcome === 'void') {
    const needed = need ? ` At least ${need} are needed.` : '';
    return `Round ${round.id} was void: ${plural(round.reveals, 'scout')} opened a report.${needed} `
      + `Nothing was minted or burned${state.game.replay ? ', and the same day is played again' : ''}.`;
  }
  if (round.outcome === 'baseline') {
    return `Round ${round.id} set the starting prices: chicken at ${pricePer(round.hen_price, unit, 'hen')}, `
      + `eggs at ${pricePer(round.egg_price, unit, 'egg')}. The first round with prices has nothing to compare with, so nobody wins.`;
  }
  if (round.outcome === 'tie') {
    return `Round ${round.id}: ${moves} Too close to call, so it is a tie. Nothing hatched, nothing fried.`;
  }
  const win = SIDE[round.outcome];
  const lose = SIDE[other(round.outcome)];
  const log = ledgerOfRound(state.ledger, round.id);
  const minted = big(round[`minted_${round.outcome}`]);
  const burned = big(round[`burned_${other(round.outcome)}`]);
  const hatched = log.found ? `${coins(log.hatch)} ${win.coin} hatched` : `${coins(minted)} ${win.coin} minted`;
  return `Round ${round.id}: ${moves} ${win.coin} came first. ${hatched}, ${coins(burned)} ${lose.coin} fried.`;
}

/** Who got what in the last round: scout pay, pot, slashes. */
function payout(round, state) {
  const bits = [];
  if (round.outcome === 'hen' || round.outcome === 'egg') {
    const log = ledgerOfRound(state.ledger, round.id);
    if (log.scout_pay > 0n) {
      bits.push(`${plural(round.honest, 'honest scout')} shared ${coins(log.scout_pay)} ${SIDE[round.outcome].coin} of scout pay`);
    }
  }
  if (big(round.pot_paid) > 0n) bits.push(`the pot paid ${near(round.pot_paid)} to honest scouts`);
  if (round.slashed.length) bits.push(`${plural(round.slashed.length, 'scout')} slashed`);
  if (round.outcome !== 'void') bits.push(`${round.reveals} reports opened, ${round.honest} honest`);
  return bits.length ? `Who got what: ${bits.join('; ')}.` : '';
}

const OUTCOME_CHIP = {
  hen: ['hen', '🐔 HEN came first'],
  egg: ['egg', '🥚 EGG came first'],
  tie: ['tie', 'Tie'],
  void: ['void', 'Void round'],
  baseline: ['base', 'Starting prices'],
};

export function outcomeChip(outcome, short) {
  const [kind, label] = OUTCOME_CHIP[outcome] || ['plain', outcome];
  const text = { hen: '🐔 HEN', egg: '🥚 EGG', tie: 'Tie', void: 'Void', baseline: 'Start' }[outcome] || outcome;
  return chip(kind, short ? text : label);
}

export function renderResult(state) {
  const box = $('result-card');
  const last = state.history[state.history.length - 1];
  if (!state.stats) {
    onChange(box, ['wait'], () => put(box, h('p', { class: 'card-label' }, 'Last result'), h('p', { class: 'loading' }, 'Reading…')));
    return;
  }
  if (!last) {
    onChange(box, ['none', state.stats.rounds_settled], () => put(box,
      h('p', { class: 'card-label' }, 'Last result'),
      h('p', { class: 'result-line' }, state.stats.rounds_settled > 0
        ? 'Loading the last result…'
        : 'No round has settled yet. The first result shows up here.')));
    return;
  }
  onChange(box, [last, state.ledger.length, state.config && state.config.min_reveals], () => {
    const days = daysByRound(state.history);
    const who = payout(last, state);
    put(box,
      h('div', { class: 'result-head' },
        h('p', { class: 'card-label' }, 'Last result'),
        outcomeChip(last.outcome),
        h('span', { class: 'result-day' }, roundWhen(state.game, last, days))),
      h('p', { class: 'result-line' }, sentence(last, state)),
      who ? h('p', { class: 'result-who' }, who) : null);
  });
}
