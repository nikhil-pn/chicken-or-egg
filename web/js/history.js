// Every settled round, newest first.
import { $, h, put, onChange, empty, table, row } from './dom.js';
import { big, coins, near, move, price, when, acct } from './format.js';
import { daysByRound, roundWhen } from './game.js';
import { outcomeChip } from './result.js';

const FIRST = 10;
const MORE = 25;

function heads(game) {
  return [
    { label: 'Round', num: true },
    { label: game.replay ? 'Replay day' : 'Date' },
    { label: 'Result' },
    { label: 'Chicken price', num: true },
    { label: 'Egg price', num: true },
    { label: 'Chicken move', num: true },
    { label: 'Egg move', num: true },
    { label: 'Minted', num: true },
    { label: 'Burned', num: true },
    { label: 'Slashed' },
    { label: 'HEN roosted', num: true },
    { label: 'EGG roosted', num: true },
    { label: 'Reports opened / honest', num: true },
    { label: 'Pot paid to scouts', num: true },
    { label: 'Settled by' },
    { label: 'Settled at' },
  ].filter(Boolean);
}

/** "+31 HEN" or "−15 EGG", or a dash when nothing moved. */
function changed(round, word, sign) {
  const bits = [];
  for (const side of ['hen', 'egg']) {
    const amount = big(round[`${word}_${side}`]);
    if (amount > 0n) bits.push(`${sign}${coins(amount)} ${side.toUpperCase()}`);
  }
  return bits.length ? bits.join(', ') : '—';
}

function line(round, state, days, cols) {
  const unit = state.game.price;
  const decided = round.outcome !== 'void';
  const compared = round.outcome === 'hen' || round.outcome === 'egg' || round.outcome === 'tie';
  const slashed = round.slashed.length
    ? h('span', { class: 'names' }, round.slashed.map((id, i) => [i ? ', ' : '', acct(id, id.split('.')[0])]))
    : 'Nobody';
  const cells = [
    String(round.id),
    roundWhen(state.game, round, days, true) || '—',
    outcomeChip(round.outcome, true),
    decided ? price(round.hen_price, unit) : '—',
    decided ? price(round.egg_price, unit) : '—',
    compared ? move(round.hen_move_ppm) : '—',
    compared ? move(round.egg_move_ppm) : '—',
    changed(round, 'minted', '+'),
    changed(round, 'burned', '−'),
    slashed,
    coins(round.hen_roosted),
    coins(round.egg_roosted),
    `${round.reveals} / ${decided ? round.honest : '—'}`,
    big(round.pot_paid) > 0n ? near(round.pot_paid) : '—',
    acct(round.settled_by),
    when(round.settled_at),
  ].filter((cell) => cell !== null);
  return row(cells, cols, `row-${round.outcome}`);
}

export function renderHistory(state) {
  const box = $('history-body');
  if (!state.stats) {
    onChange(box, ['wait'], () => put(box, h('p', { class: 'loading' }, 'Reading the rounds from the chain…')));
    return;
  }
  const total = state.stats.rounds_settled;
  const have = state.history.length;
  state.ui.history = state.ui.history || FIRST;
  onChange(box, [have, total, state.ui.history], () => {
    if (!total) {
      put(box, empty('nest', 'No round has settled yet',
        'Each settled round adds one line here: the result, both prices, what was minted and burned, and who was slashed.'));
      return;
    }
    if (!have) {
      put(box, h('p', { class: 'loading' }, `Loading ${total} settled rounds…`));
      return;
    }
    const cols = heads(state.game);
    const days = daysByRound(state.history);
    const shown = state.history.slice(-state.ui.history).reverse();
    const left = have - shown.length;
    const unit = state.game.price;
    put(box,
      h('p', { class: 'section-note' },
        `${have === total ? total : `${have} of ${total}`} settled rounds, newest first. `
        + (unit && unit.symbol ? `Prices are per ${unit.hen_unit} of chicken and per ${unit.egg_unit} of eggs. ` : '')
        + 'A move is the change since the round before. The table scrolls sideways for more columns.'),
      table('Settled rounds, newest first', cols, shown.map((round) => line(round, state, days, cols))),
      left > 0
        ? h('button', { class: 'more', type: 'button', onclick: () => { state.ui.history += MORE; renderHistory(state); } },
          `Show ${Math.min(MORE, left)} older rounds (${left} more)`)
        : null);
  });
}
