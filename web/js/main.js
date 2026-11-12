// Boots the page and keeps it fresh, with as few questions to the chain as possible.
//
// Every 5 seconds the page asks one thing: get_round. Everything else is asked only
// when that answer shows a change: the scouts when the reports of the round moved,
// and the score, the history, the log, the coin supply and the players when a new
// round opened. Nothing is asked while the tab is hidden.
import { loadGame } from './game.js';
import { createRpc } from './rpc.js';
import { renderRound, renderTiles, tickRound } from './round.js';
import { renderResult } from './result.js';
import { remember, renderScouts } from './scouts.js';
import { renderSupply, renderSim } from './supply.js';
import { renderHistory } from './history.js';
import { renderLedger } from './ledger.js';
import { renderRules } from './rules.js';
import { renderPlayers } from './players.js';
import { renderFrame, renderStatus, renderMissing, bootProblem } from './page.js';

const POLL_MS = 5000; // get_round, never more often than this
const MAX_WAIT_MS = 30000; // slowest retry when the chain does not answer
const KEYS_MS = 300000; // access keys of the contract accounts, until they are all gone
const MISSING_MS = 60000; // a game that is not deployed yet is checked once a minute
const PAGE = 100; // the coop returns at most 100 rows per call

const state = {
  game: null, rpc: null, config: null, meta: { hen: null, egg: null }, keys: null,
  round: null, roundAt: 0, stats: null, scouts: null,
  history: [], ledger: [], ft: null, players: new Map(),
  sim: null, simError: null, seen: new Map(), ui: {},
  error: null, late: false, updatedAt: 0, missing: false, checkedAt: 0, games: [],
};

const SECTIONS = [renderStatus, renderRound, renderTiles, renderResult, renderScouts, renderSupply, renderSim,
  renderHistory, renderLedger, renderRules, renderPlayers];

/** One broken section never takes the others down with it. */
function render() {
  if (state.missing) {
    for (const draw of [renderStatus, renderMissing, renderRules, renderSim]) {
      try { draw(state); } catch (problem) { console.error(problem); }
    }
    return;
  }
  for (const draw of SECTIONS) {
    try { draw(state); } catch (problem) { console.error(problem); }
  }
}

// What was already asked, so that nothing is asked twice for the same chain state.
const asked = { scouts: '', scoutTries: 0, turn: 0, misses: 0, back: 0, coins: '', coinsFor: '', coinTries: 0, players: '', keysAt: 0 };

const view = (method, args) => state.rpc.view(state.game.coop, method, args);

/** The one question of every poll. */
async function readRound() {
  const round = await view('get_round');
  // A node that is a few blocks behind may still show the round before: keep the newer picture.
  if (state.round && round.id < state.round.id && ++asked.back < 3) return;
  asked.back = 0;
  if (state.round && state.scouts && round.id !== state.round.id) {
    // A new round: keep the reports of the old one, and stop showing them as this round's.
    remember(state);
    state.scouts = state.scouts.map((sc) => ({ ...sc, sealed: false, revealed: false, hen_price: null, egg_price: null }));
  }
  Object.assign(state, { round, roundAt: Date.now(), updatedAt: Date.now() });
}

/** The scouts, asked again only when the reports of the open round moved. */
async function readScouts() {
  const { round } = state;
  const sig = `${round.id}|${round.phase}|${round.commits}|${round.reveals}|${round.scouts}`;
  if (sig === asked.scouts) return;
  const scouts = await view('get_scouts');
  state.scouts = scouts;
  remember(state);
  // If the answer is from another block than the round, ask once or twice more.
  const fits = scouts.length === round.scouts && scouts.filter((sc) => sc.revealed).length === round.reveals;
  if (fits || ++asked.scoutTries >= 3) {
    asked.scouts = sig;
    asked.scoutTries = 0;
  }
}

/** Reads only the rows the page does not have yet, one page at a time. */
async function catchUp(method, list, total) {
  if (list.length > total) list.length = 0; // a different chain state: start again
  for (let pages = 0; list.length < total && pages < 200; pages++) {
    const rows = await view(method, { from: list.length, limit: PAGE });
    if (!rows.length) break;
    list.push(...rows);
    if (list.length < total) render();
  }
}

/** Once per round: the score, then the new lines of the history and of the log. */
async function readTurn() {
  const { round } = state;
  if (asked.turn === round.id) return;
  const stats = await view('get_stats');
  // The open round is always the one after the last settled round. If the two answers
  // do not fit, they came from different blocks: wait for the next poll and ask again.
  if (stats.rounds_settled + 1 !== round.id && ++asked.misses < 3) throw new Error('Round and score are from different blocks');
  asked.misses = 0;
  state.stats = stats;
  render();
  await catchUp('get_history', state.history, stats.rounds_settled);
  await catchUp('get_ledger', state.ledger, stats.ledger_entries);
  asked.turn = round.id;
}

/** Things that never change are asked until each has answered once. Keys are asked rarely. */
async function readFixed() {
  const { game, rpc } = state;
  const jobs = [];
  if (!state.config) jobs.push(view('get_config').then((config) => { state.config = config; }));
  for (const side of ['hen', 'egg']) {
    if (state.meta[side]) continue;
    jobs.push(rpc.view(game[side], 'ft_metadata').then((m) => {
      state.meta = { ...state.meta, [side]: { name: m.name, symbol: m.symbol, decimals: m.decimals } };
    }));
  }
  // An account without any key can never get one again, so then the question is closed.
  const accounts = [game.coop, game.hen, game.egg];
  const locked = state.keys && accounts.every((a) => state.keys[a] && state.keys[a].total === 0);
  if (!locked && Date.now() - asked.keysAt > KEYS_MS) {
    asked.keysAt = Date.now();
    for (const account of accounts) {
      jobs.push(rpc.keys(account).then((keys) => { state.keys = { ...state.keys, [account]: keys }; }));
    }
  }
  const done = await Promise.allSettled(jobs);
  if (done.some((job) => job.status === 'rejected')) {
    asked.keysAt = Math.min(asked.keysAt, Date.now() - KEYS_MS + 30000); // try the keys again in half a minute
    throw new Error('A fixed value did not load');
  }
}

/** Supply as the coin contracts report it, asked when the coop's supply moved. */
async function readCoins() {
  const { game, rpc, stats } = state;
  const sig = `${stats.hen_supply}|${stats.egg_supply}`;
  if (sig === asked.coins) return;
  if (sig !== asked.coinsFor) Object.assign(asked, { coinsFor: sig, coinTries: 0 });
  if (asked.coinTries >= 4) return;
  asked.coinTries += 1;
  const [hen, egg] = await Promise.all([rpc.view(game.hen, 'ft_total_supply'), rpc.view(game.egg, 'ft_total_supply')]);
  state.ft = { hen, egg };
  // A mint lands on the coin contract a moment after the coop books it: ask again until both agree.
  if (hen === stats.hen_supply && egg === stats.egg_supply) asked.coins = sig;
}

/** The known players: when a round opens, and once more when roosting closes. */
async function readPlayers() {
  const { game, round } = state;
  if (!game.players.length) return;
  const sig = `${round.id}|${round.phase === 'roost' ? 'open' : 'closed'}`;
  if (sig === asked.players) return;
  const views = await Promise.all(game.players.map((id) => view('get_player', { account_id: id })));
  state.players = new Map(game.players.map((id, i) => [id, views[i]]));
  asked.players = sig;
}

let fails = 0;
let busy = false;
let timer = null;
let polledAt = 0;

function schedule(wait) {
  clearTimeout(timer);
  timer = document.hidden ? null : setTimeout(poll, wait);
}

async function poll() {
  if (busy || document.hidden) return;
  busy = true;
  polledAt = Date.now();
  let wait = POLL_MS;
  try {
    await readRound();
    state.error = null;
    state.missing = false;
    fails = 0;
    render();
    const first = await Promise.allSettled([readScouts(), readFixed(), readTurn()]);
    render();
    const then = state.stats ? await Promise.allSettled([readCoins(), readPlayers()]) : [];
    const late = [...first, ...then].filter((job) => job.status === 'rejected');
    state.late = late.length > 0;
    for (const job of late) console.warn('Some data is late:', job.reason && job.reason.message);
  } catch (problem) {
    if (problem.missing && !state.round) {
      // The coop is not deployed yet: not an outage, just a game that has not started.
      Object.assign(state, { missing: true, error: null, checkedAt: Date.now() });
      wait = MISSING_MS;
    } else {
      state.error = problem;
      fails += 1;
      wait = Math.min(POLL_MS * 2 ** (fails - 1), MAX_WAIT_MS);
      console.warn('The chain did not answer:', problem.message);
    }
  }
  render();
  busy = false;
  schedule(wait);
}

async function loadSim() {
  try {
    const res = await fetch('data/sim-supply.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.sim = await res.json();
  } catch (problem) {
    state.simError = problem;
  }
  render();
}

async function boot() {
  let start;
  try {
    start = await loadGame();
  } catch (problem) {
    bootProblem(problem);
    return;
  }
  state.game = start.game;
  state.games = start.games;
  if (start.fixture) {
    const { createFixture } = await import('../dev/fixture.js');
    state.rpc = createFixture(start.fixture, state.game);
  } else {
    state.rpc = createRpc();
  }
  renderFrame(state, start);
  render();
  loadSim();
  poll();
  setInterval(() => { if (!document.hidden) tickRound(state); }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer); // a hidden tab asks nothing
    else schedule(Math.max(0, POLL_MS - (Date.now() - polledAt)));
  });
}

boot();
