// A small leaderboard of the player accounts listed for this game in games.json.
import { $, h, put, onChange, empty, table, row, chip } from './dom.js';
import { big, coins, acct, plural, SIDE } from './format.js';

const HEADS = [
  { label: '#', num: true, phone: false },
  { label: 'Player' },
  { label: 'Wins', num: true },
  { label: 'Losses', num: true },
  { label: 'Streak', num: true },
  { label: 'Best streak', num: true },
  { label: 'Roost' },
  { label: 'Nest (resting in the coop)' },
];

function roost(player, round) {
  if (!player.roost) return h('span', { class: 'muted' }, 'Not roosting');
  const side = SIDE[player.roost.side] || { emoji: '', coin: String(player.roost.side).toUpperCase() };
  const now = round && player.roost.round === round.id;
  return h('span', null, `${side.emoji} ${coins(player.roost.amount)} ${side.coin} `,
    now ? chip(player.roost.side, 'this round') : chip('plain', `round ${player.roost.round}`));
}

function nest(player) {
  const bits = [];
  if (big(player.nest_hen) > 0n) bits.push(`${coins(player.nest_hen)} HEN`);
  if (big(player.nest_egg) > 0n) bits.push(`${coins(player.nest_egg)} EGG`);
  return bits.length ? bits.join(' · ') : 'Empty';
}

export function renderPlayers(state) {
  const box = $('players-body');
  const listed = state.game.players;
  const joined = state.stats ? state.stats.stats.players : null;
  if (!listed.length) {
    onChange(box, ['none', joined], () => put(box, empty('🏆', 'No players are listed for this game yet',
      joined === null ? 'The leaderboard shows up when player accounts are listed for this game.'
        : `${plural(joined, 'account')} joined the coop so far. The leaderboard shows up when player accounts are listed for this game.`)));
    return;
  }
  const loaded = listed.filter((id) => state.players.has(id));
  if (!loaded.length) {
    onChange(box, ['wait'], () => put(box, h('p', { class: 'loading' }, 'Reading the players from the chain…')));
    return;
  }
  const views = loaded.map((id) => ({ id, view: state.players.get(id) }));
  onChange(box, [views, joined, state.round && state.round.id], () => {
    const ranked = views.filter((p) => p.view).sort((a, b) =>
      b.view.wins - a.view.wins || a.view.losses - b.view.losses || b.view.best_streak - a.view.best_streak);
    const absent = views.filter((p) => !p.view);
    put(box,
      h('p', { class: 'section-note' },
        `${plural(listed.length, 'known player')}, most wins first.`
        + (joined === null ? '' : ` ${plural(joined, 'account')} joined the coop in total; scout accounts that joined count too.`)
        + ' A win is a round where the player roosted on the side that came first.'),
      table('Players, most wins first', HEADS, [
        ...ranked.map(({ id, view }, i) => row([
          String(i + 1), acct(id), String(view.wins), String(view.losses),
          view.streak > 0 ? `×${view.streak}` : '0', String(view.best_streak),
          roost(view, state.round), nest(view),
        ], HEADS)),
        ...absent.map(({ id }) => row(['—', acct(id), '—', '—', '—', '—', 'Has not joined', '—'], HEADS, 'row-off')),
      ], true),
      h('p', { class: 'fine' },
        'The nest holds coins that came back from settled roosts. They rest in the coop until the player roosts them again or claims them. '
        + 'This table is read when a round opens and again when roosting closes.'));
  });
}
