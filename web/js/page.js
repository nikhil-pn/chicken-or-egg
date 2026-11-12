// The frame around the views: banners, the headline, the game links, the account, the status line.
import { $, h, put, onChange, chip, empty } from './dom.js';
import { acct, clock, shortName } from './format.js';
import { sticker } from './stickers.js';
import * as wallet from './wallet.js';

/** A link to another game that keeps the other settings of the address (mock, fixture) and the view. */
export function gameHref(id, defaultId) {
  const params = new URLSearchParams(location.search);
  if (id === defaultId) params.delete('game');
  else params.set('game', id);
  const query = params.toString();
  return `${query ? `?${query}` : location.pathname}${location.hash.startsWith('#/') ? location.hash : '#/'}`;
}

/** Drawn once, when the game is known. */
export function renderFrame(state, start) {
  const { game, rpc } = state;
  const alarm = [];
  if (rpc.fixture) {
    alarm.push(h('p', null, h('b', null, 'FIXTURE DATA, not from the chain. '),
      'Every number on this page is made up to test the layout. Remove ?fixture from the address to see the real game.'));
  }
  if (start.mock) {
    alarm.push(h('p', null, h('b', null, 'MOCK WALLET. '),
      'Accounts and bets on this page are fake and never reach the chain. Remove ?mock from the address to play for real.'));
  }
  $('alarm').hidden = !alarm.length;
  put($('alarm'), alarm);

  if (game.replay) {
    $('headline').replaceChildren('Chicken or eggs: which got ', h('span', { class: 'scribble' }, 'pricier'), ' that day?');
    $('tagline').textContent = 'A replay of 107 recorded days of shop prices in Kochi. $HEN backs chicken, $EGG backs eggs.';
  }

  const other = start.games.find((g) => g.id !== game.id);
  const banner = $('game-banner');
  const notes = [];
  if (start.unknown) notes.push(h('span', null, `There is no game called "${start.unknown}". `));
  if (game.replay) {
    notes.push(chip('replay', 'Replay'), h('span', null, `${game.about} Not today's prices. `),
      other ? h('a', { href: gameHref(other.id, start.defaultId) }, 'Back to the live game') : null);
  }
  banner.hidden = !notes.length;
  put(banner, notes);

  const link = $('game-link');
  if (other) {
    link.href = gameHref(other.id, start.defaultId);
    link.textContent = other.replay ? 'Replay' : 'Live game';
  } else {
    link.hidden = true;
  }

  put($('contracts'),
    h('li', null, chip('plain', 'Coop'), acct(game.coop, game.coop)),
    h('li', null, sticker('coin-hen', { size: 'xs' }), 'HEN coin: ', acct(game.hen, game.hen)),
    h('li', null, sticker('coin-egg', { size: 'xs' }), 'EGG coin: ', acct(game.egg, game.egg)),
    h('li', { class: 'note' }, `This is the ${game.label.toLowerCase()}. `, game.about || ''),
    other ? h('li', { class: 'note' }, 'The other game: ', h('a', { href: gameHref(other.id, start.defaultId) }, other.label), '.') : null,
    h('li', { class: 'note' }, 'Every transaction is public on ', h('a', { href: 'https://testnet.nearblocks.io/', target: '_blank', rel: 'noopener' }, 'NEAR testnet (nearblocks)'), '.'));
}

/** The signed-in account, in the navbar (desktop) and in the phone menu. */
export function renderAccount(state) {
  const w = state.wallet;
  const bar = $('account');
  const extra = $('sheet-extra');
  const games = (state.games || []).filter((g) => g.id !== state.game.id);
  onChange(bar, [w.account, w.status], () => {
    const out = () => h('button', { class: 'link-btn', type: 'button', onclick: () => wallet.signOut(state) }, 'Sign out');
    put(bar, w.account ? [h('span', { class: 'acct-chip', title: w.account }, shortName(w.account)), out()] : null);
    put(extra,
      w.account ? h('p', null, 'Signed in as ', h('b', { title: w.account }, shortName(w.account)), ' · ', out()) : null,
      games.map((g) => h('p', null, h('a', { href: gameHref(g.id, state.defaultId) }, g.replay ? 'Watch the replay' : 'Back to the live game'),
        g.hint ? ` (${g.hint})` : '')));
  });
}

const dot = () => h('span', { class: 'status-dot', 'aria-hidden': 'true' });

/** One line that says where the numbers come from and how fresh they are. */
export function renderStatus(state) {
  const box = $('status');
  const { rpc } = state;
  if (!rpc) return;
  const info = rpc.info();
  onChange(box, [state.updatedAt, Boolean(state.error), state.late, info.host, rpc.fixture, state.missing, state.checkedAt], () => {
    if (state.missing) {
      box.className = 'status';
      return put(box, dot(), `${state.game.coop} is not on NEAR testnet yet · checked ${clock(state.checkedAt)}`);
    }
    if (rpc.fixture) {
      box.className = 'status status-warn';
      return put(box, dot(), 'Fixture data. Not from the chain.');
    }
    if (state.error) {
      box.className = 'status status-bad';
      return put(box, dot(), state.updatedAt
        ? `The chain is not answering. Showing the data from ${clock(state.updatedAt)}. Trying again.`
        : 'The chain is not answering yet. Trying again.');
    }
    if (!state.updatedAt) {
      box.className = 'status';
      return put(box, dot(), 'Connecting to NEAR testnet…');
    }
    box.className = state.late ? 'status status-warn' : 'status status-ok';
    put(box, dot(), `Live from NEAR testnet · ${info.host}${info.backup ? ' (backup)' : ''} · ${clock(state.updatedAt)}`
      + (state.late ? ' · some data still loading' : ''));
  });
}

/** The game list itself did not load: say so instead of showing an empty page. */
export function bootProblem(problem) {
  const box = $('status');
  box.className = 'status status-bad';
  put(box, dot(), 'The game list (games.json) could not be loaded. Reload the page to try again.');
  console.error(problem);
}

/** The coop of this game is not on the chain yet: every view says so plainly. */
export function renderMissing(state) {
  const { game } = state;
  const say = (id, art, title, text) => {
    const node = $(id);
    onChange(node, ['missing', game.id], () => put(node, empty(art, title, text)));
  };
  for (const id of ['tiles', 'play-last']) onChange($(id), ['missing'], () => put($(id)));
  say('result-card', 'nest', 'No result yet', 'The first result of this game shows up here.');
  say('scouts-body', 'scout', 'No scouts yet', 'The scouts join once the coop is deployed.');
  say('supply-body', 'egg', 'No coins yet', 'Both coins start at zero.');
  say('history-body', 'nest', 'No rounds yet', 'Every settled round of this game adds one line here.');
  say('players-body', 'hen', 'No players yet', 'The leaderboard shows up once players join this game.');
  say('log-body', 'seal', 'Nothing minted or burned yet', 'Every mint and burn of this game will be listed here.');
  say('params-body', 'seal', 'Parameters not readable yet', 'They are read live from get_config once the coop is deployed.');
  say('lock-body', 'seal', 'Not deployed yet', `${game.coop} is not on NEAR testnet yet. This page checks once a minute.`);
}
