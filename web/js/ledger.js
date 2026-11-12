// The log of every mint and burn, newest first.
import { $, h, put, onChange, empty, table, row, chip } from './dom.js';
import { coins, when, acct } from './format.js';

const FIRST = 25;
const MORE = 50;

// What and how much first, so a phone sees them without scrolling sideways.
const HEADS = [
  { label: 'Round', num: true },
  { label: 'What' },
  { label: 'Amount', num: true },
  { label: 'Who' },
  { label: 'Time' },
];

const KIND = {
  starter: { chip: ['plain', '🎁 Starter pack'], sign: '+', who: () => 'a new player' },
  hatch: { chip: ['good', '🐣 Hatch (mint)'], sign: '+', who: (coin) => `players who roosted ${coin}` },
  scout_pay: { chip: ['good', '🔭 Scout pay (mint)'], sign: '+', who: () => 'the honest scouts' },
  fry: { chip: ['bad', '🔥 Fry (burn)'], sign: '−', who: (coin) => `players who roosted ${coin}` },
};

function line(entry) {
  const kind = KIND[entry.kind] || { chip: ['plain', entry.kind], sign: '', who: () => '' };
  const coin = String(entry.coin).toUpperCase();
  return row([
    String(entry.round),
    chip(kind.chip[0], kind.chip[1]),
    h('span', { class: kind.sign === '−' ? 'amount minus' : 'amount plus' }, `${kind.sign}${coins(entry.amount)} ${coin}`),
    entry.account ? acct(entry.account) : kind.who(coin),
    when(entry.at),
  ], HEADS, `row-${entry.kind}`);
}

export function renderLedger(state) {
  const box = $('log-body');
  if (!state.stats) {
    onChange(box, ['wait'], () => put(box, h('p', { class: 'loading' }, 'Reading the log from the chain…')));
    return;
  }
  const total = state.stats.ledger_entries;
  const have = state.ledger.length;
  state.ui.ledger = state.ui.ledger || FIRST;
  onChange(box, [have, total, state.ui.ledger], () => {
    if (!total) {
      put(box, empty('📒', 'Nothing has been minted or burned yet',
        'Both coins start at zero. The first line appears when a player claims a starter pack, or when a round has a winner.'));
      return;
    }
    if (!have) {
      put(box, h('p', { class: 'loading' }, `Loading ${total} lines…`));
      return;
    }
    const shown = state.ledger.slice(-state.ui.ledger).reverse();
    const left = have - shown.length;
    put(box,
      h('p', { class: 'section-note' },
        `${have === total ? total : `${have} of ${total}`} lines, newest first. `
        + 'A plus is a mint, a minus is a burn. Coins are created and destroyed in no other way.'),
      table('Every mint and burn, newest first', HEADS, shown.map(line)),
      left > 0
        ? h('button', { class: 'more', type: 'button', onclick: () => { state.ui.ledger += MORE; renderLedger(state); } },
          `Load ${Math.min(MORE, left)} more (${left} older lines)`)
        : null);
  });
}
