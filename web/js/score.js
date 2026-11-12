// Three small tiles at the top of Stats: the streak, the all-time score, the coins that exist.
import { $, h, put, onChange } from './dom.js';
import { coins, plural, SIDE } from './format.js';
import { sticker } from './stickers.js';

function tile(label, main, sub) {
  return h('div', { class: 'tile' }, h('p', { class: 'tile-label' }, label), h('div', { class: 'tile-main' }, main),
    sub ? h('p', { class: 'tile-sub' }, sub) : null);
}

const num = (n, unit) => h('span', null, h('span', { class: 'tile-num' }, n), unit ? h('span', { class: 'tile-unit' }, ` ${unit}`) : null);

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
      ? tile('Current streak', [sticker(st.streak_side === 'hen' ? 'coin-hen' : 'coin-egg', { size: 'sm', tilt: -6 }), num(`${side.coin} ×${st.streak}`)],
        `${side.coin} came first ${plural(st.streak, 'round')} in a row. Best so far: ${st.best_streak}.`)
      : tile('Current streak', num('None yet'), 'The first win starts a streak. Ties and void rounds do not break it.');
    const score = tile('All-time score', [num(String(st.hen_wins), 'HEN'), num(String(st.egg_wins), 'EGG'), num(String(st.ties), st.ties === 1 ? 'tie' : 'ties')],
      `${plural(view.rounds_settled, 'round')} settled, ${st.voids} of them void.`);
    const supply = tile('Coins that exist', [num(coins(view.hen_supply, 0), 'HEN'), num(coins(view.egg_supply, 0), 'EGG')],
      `Both started at zero. ${plural(st.starters_claimed, 'starter pack')} claimed.`);
    put(box, streak, score, supply);
  });
}
