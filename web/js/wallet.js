// The bridge to the betting engine (js/chain/play.js, built separately). The page works without it:
// if the module is missing it says "Betting is coming online" and keeps showing the game.
// With ?mock=1 it loads dev/play-mock.js instead: fake accounts and bets, under a loud banner.

const ME_EVERY_MS = 30000; // the signed-in player's coins, refreshed this often while the tab is open

let mod = null;
let redraw = () => {};
let meSig = '';
let meAt = 0;

const safe = (fn, fallback) => {
  try { return fn(); } catch (problem) { console.warn(problem); return fallback; }
};

/** Loads the betting module after the page has drawn, so the game never waits for it. */
export async function startWallet(state, render) {
  redraw = render;
  const mock = new URLSearchParams(location.search).has('mock');
  state.wallet = { status: 'loading', mock, account: null, me: null, guestOk: false };
  if (state.rpc && state.rpc.fixture && !mock) {
    state.wallet.status = 'off'; // made-up rounds never get real bets
    render();
    return;
  }
  try {
    mod = mock ? await import('../dev/play-mock.js') : await import('./chain/play.js');
  } catch (problem) {
    console.info('Betting is not online yet:', problem && problem.message);
    state.wallet.status = 'off';
    render();
    return;
  }
  try { await mod.init(); } catch (problem) { console.warn('The betting module did not start:', problem); }
  Object.assign(state.wallet, {
    status: 'ready',
    guestOk: Boolean(safe(() => mod.guestAvailable(), false)),
    account: safe(() => mod.accountId(), null),
  });
  safe(() => mod.onChange((id) => {
    if (id === state.wallet.account) return;
    Object.assign(state.wallet, { account: id, me: null });
    render();
    refreshMe(state);
  }));
  render();
  refreshMe(state);
}

/** Tells the mock which round is open (the real module reads the chain itself). */
function shareRound(state) {
  if (mod && mod.mockRound && state.round) mod.mockRound(state.round.id, state.round.phase);
}

/** Reads the signed-in player's coins, roost, streak and nest. */
export async function refreshMe(state) {
  if (!mod || !state.wallet || !state.wallet.account || !state.game) return;
  shareRound(state);
  const asked = state.wallet.account;
  meAt = Date.now();
  try {
    const me = await mod.me(state.game);
    if (state.wallet.account !== asked) return; // signed out or switched while asking
    state.wallet.me = me;
    redraw();
  } catch (problem) {
    console.warn('Could not read your account:', problem && problem.message);
  }
}

/** From the poll loop: asks again when the round or phase moved, or every half minute. */
export function walletTick(state) {
  if (!state.wallet || state.wallet.status !== 'ready' || !state.round) return;
  const sig = `${state.round.id}|${state.round.phase}|${state.wallet.account}`;
  if (sig !== meSig || Date.now() - meAt > ME_EVERY_MS) {
    meSig = sig;
    refreshMe(state);
  }
}

/** kind: 'guest' (a testnet account kept in this browser) or 'wallet' (the wallet picker). */
export async function signIn(state, kind) {
  const id = kind === 'guest' ? await mod.guest() : await mod.connect();
  if (id) {
    Object.assign(state.wallet, { account: id, me: null });
    await refreshMe(state);
  }
  return id;
}

export async function signOut(state) {
  try { await mod.disconnect(); } catch (problem) { console.warn(problem); }
  Object.assign(state.wallet, { account: null, me: null });
  redraw();
}

export function placeBet(state, side, amount, onStep) {
  shareRound(state);
  return mod.bet(state.game, side, amount, onStep);
}

export const cashOut = (state) => mod.cashOut(state.game);
