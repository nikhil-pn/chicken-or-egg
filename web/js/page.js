// The frame around the sections: banners, the status line, the game switch and the footer.
import { $, h, put, onChange, chip, empty } from './dom.js';
import { acct, clock } from './format.js';

/** Drawn once, when the game is known. */
export function renderFrame(state, start) {
  const { game, rpc } = state;

  const fixture = $('fixture-banner');
  if (rpc.fixture) {
    fixture.hidden = false;
    put(fixture, h('b', null, 'FIXTURE DATA, not from the chain.'),
      ' Every number on this page is made up to test the layout. Remove ?fixture from the address to see the real game.');
  }

  // The game switch: a small toggle above the banner. Links, so each game has its own address.
  if (start.games.length > 1) {
    put($('game-switch'), h('span', { class: 'switch-label', id: 'switch-label' }, 'Game'),
      h('div', { class: 'switch', role: 'group', 'aria-labelledby': 'switch-label' }, start.games.map((g) =>
        h('a', { class: g.id === game.id ? 'switch-opt switch-now' : 'switch-opt', href: `?game=${encodeURIComponent(g.id)}`,
          'aria-current': g.id === game.id ? 'page' : null },
        h('b', null, g.short || g.label), g.hint ? h('span', { class: 'switch-hint' }, g.hint) : null))));
  }

  const banner = $('replay-banner');
  banner.hidden = false;
  banner.classList.toggle('live-banner', !game.replay);
  put(banner, chip(game.replay ? 'replay' : 'live', game.replay ? 'Replay' : 'Live'), h('span', null, h('b', null, `${game.label}. `),
    game.about ? `${game.about} ` : '',
    game.replay && !rpc.fixture ? 'These are recorded prices, not today\'s prices.' : ''));

  const notes = [];
  if (start.unknown) {
    notes.push(h('p', { class: 'frame-note' }, `There is no game called "${start.unknown}". Showing the ${game.label.toLowerCase()}.`));
  }
  put($('frame-notes'), notes);

  put($('contracts'),
    h('li', null, 'Coop: ', acct(game.coop, game.coop)),
    h('li', null, '🐔 HEN coin: ', acct(game.hen, game.hen)),
    h('li', null, '🥚 EGG coin: ', acct(game.egg, game.egg)));
}

/** One line that says where the numbers come from and how fresh they are. */
export function renderStatus(state) {
  const box = $('status');
  const { rpc } = state;
  if (!rpc) return;
  const info = rpc.info();
  onChange(box, [state.updatedAt, Boolean(state.error), state.late, info.host, rpc.fixture, state.missing, state.checkedAt], () => {
    if (state.missing) {
      box.className = 'status';
      put(box, h('span', { class: 'status-dot', 'aria-hidden': 'true' }),
        `${state.game.coop} is not on NEAR testnet yet · checked ${clock(state.checkedAt)} · checking again every minute`);
      return;
    }
    if (rpc.fixture) {
      box.className = 'status status-warn';
      put(box, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), 'Fixture data. Not from the chain.');
      return;
    }
    if (state.error) {
      box.className = 'status status-bad';
      put(box, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), state.updatedAt
        ? `The chain is not answering. Showing the last data, from ${clock(state.updatedAt)}. Trying again.`
        : 'The chain is not answering yet. Trying again.');
      return;
    }
    if (!state.updatedAt) {
      box.className = 'status';
      put(box, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), 'Connecting to NEAR testnet…');
      return;
    }
    box.className = state.late ? 'status status-warn' : 'status status-ok';
    put(box, h('span', { class: 'status-dot', 'aria-hidden': 'true' }),
      `Read from NEAR testnet · ${info.host}${info.backup ? ' (backup)' : ''} · updated ${clock(state.updatedAt)}`
      + (state.late ? ' · some tables are still loading' : ''));
  });
}

/** The game list itself did not load: say so instead of showing an empty page. */
export function bootProblem(problem) {
  const box = $('status');
  box.className = 'status status-bad';
  put(box, h('span', { class: 'status-dot', 'aria-hidden': 'true' }),
    'The game list (games.json) could not be loaded. Reload the page to try again.');
  console.error(problem);
}

/**
 * The coop of this game is not on the chain yet (it is being deployed).
 * Every section says so plainly, and the page keeps checking once a minute.
 */
export function renderMissing(state) {
  const { game } = state;
  const replay = (state.games || []).find((g) => g.replay && g.id !== game.id);
  const say = (id, emoji, title, text) => {
    const node = $(id);
    onChange(node, ['missing', game.id], () => put(node, empty(emoji, title, text)));
  };
  const round = $('round-card');
  onChange(round, ['missing', game.id], () => put(round,
    h('p', { class: 'card-label' }, "Today's progress"),
    h('div', { class: 'not-yet' },
      h('span', { class: 'not-yet-emoji', 'aria-hidden': 'true' }, '🥚'),
      h('div', null,
        h('p', { class: 'round-title' }, 'This game has not started yet'),
        h('p', { class: 'phase-line' }, `The coop contract ${game.coop} is not on NEAR testnet yet. `
          + 'Round 1 shows up here as soon as it is deployed; this page checks once a minute.'),
        replay ? h('p', { class: 'phase-line' }, 'The same rules on 107 recorded days: ',
          h('a', { href: `?game=${encodeURIComponent(replay.id)}` }, `see the ${replay.label.toLowerCase()}`), '.') : null))));
  const tiles = $('tiles');
  onChange(tiles, ['missing', game.id], () => put(tiles));
  say('result-card', '🪺', 'No result yet', 'The first result of this game shows up here.');
  say('scouts-body', '🔭', 'No scouts yet', 'The scouts join once the coop is deployed.');
  say('supply-body', '📈', 'No coins yet', 'Both coins start at zero. The chart starts with the first coins minted in this game.');
  say('history-body', '📜', 'No rounds yet', 'Every settled round of this game adds one line here.');
  say('players-body', '🏆', 'No players yet', 'The leaderboard shows up once players join this game.');
  say('log-body', '📒', 'Nothing minted or burned yet', 'Every mint and burn of this game will be listed here.');
  say('params-body', '⚙️', 'Parameters not readable yet', 'They are read live from get_config once the coop is deployed.');
}
