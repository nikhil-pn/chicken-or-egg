// Supply over time, built from the on-chain log. Below it, the labelled simulation.
import { $, h, put, onChange, empty, chip } from './dom.js';
import { big, coins, coinsNumber, bps } from './format.js';
import { lineChart } from './chart.js';
import { daysByRound, roundWhen, openDay } from './game.js';

const HEN = { name: 'HEN', color: '--hen-mark' };
const EGG = { name: 'EGG', color: '--egg-mark' };

/**
 * Supply after each round, from the log alone: a mint adds, a fry subtracts.
 * Starts at the first round that has a line in the log.
 */
export function supplyByRound(ledger, lastRound) {
  if (!ledger.length) return null;
  const first = ledger[0].round;
  const total = { hen: 0n, egg: 0n };
  const out = { rounds: [], hen: [], egg: [], total };
  let at = 0;
  for (let round = first; round <= Math.max(lastRound, first); round++) {
    while (at < ledger.length && ledger[at].round <= round) {
      const entry = ledger[at++];
      if (entry.coin in total) total[entry.coin] += entry.kind === 'fry' ? -big(entry.amount) : big(entry.amount);
    }
    out.rounds.push(round);
    out.hen.push(total.hen);
    out.egg.push(total.egg);
  }
  return out;
}

function stat(label, main, sub) {
  return h('div', { class: 'stat' }, h('p', { class: 'tile-label' }, label), h('p', { class: 'stat-main' }, main),
    sub ? h('p', { class: 'tile-sub' }, sub) : null);
}

/** Says only what was checked: the log total against the coop and against the coin contracts. */
function checkLine(state, supply) {
  const view = state.stats;
  if (state.ledger.length !== view.ledger_entries) {
    return h('p', { class: 'check' }, `Loading the log: ${state.ledger.length} of ${view.ledger_entries} lines read.`);
  }
  const log = supply ? supply.total : { hen: 0n, egg: 0n };
  const coop = log.hen === big(view.hen_supply) && log.egg === big(view.egg_supply);
  const ft = state.ft;
  const coinsAgree = ft && log.hen === big(ft.hen) && log.egg === big(ft.egg);
  if (coop && coinsAgree) {
    return h('p', { class: 'check' }, chip('good', 'Adds up'),
      ` The ${view.ledger_entries} lines of the log add up to exactly the supply that both coin contracts report (ft_total_supply).`);
  }
  if (coop && !ft) {
    return h('p', { class: 'check' }, chip('good', 'Adds up'),
      ` The ${view.ledger_entries} lines of the log add up to exactly the supply the coop reports. The coin contracts did not answer yet.`);
  }
  return h('p', { class: 'check' }, chip('warn', 'Checking'),
    ` The log adds up to ${coins(log.hen)} HEN and ${coins(log.egg)} EGG. The coop reports ${coins(view.hen_supply)} HEN and `
    + `${coins(view.egg_supply)} EGG${ft ? `, the coin contracts ${coins(ft.hen)} HEN and ${coins(ft.egg)} EGG` : ''}. `
    + 'A new line may be on its way.');
}

function chainChart(state, supply) {
  const { game, round } = state;
  const days = daysByRound(state.history);
  const openId = round ? round.id : null;
  const label = (i) => {
    const id = supply.rounds[i];
    if (id === openId) return `Round ${id}, open now`;
    const result = state.history[id - 1];
    const day = result && result.id === id ? roundWhen(game, result, days, true) : '';
    return day ? `After round ${id} · ${day}` : `After round ${id}`;
  };
  const exact = [supply.hen, supply.egg];
  return {
    title: 'HEN and EGG supply after each round, from the on-chain log',
    xName: 'Round',
    series: [{ ...HEN, values: supply.hen.map(coinsNumber) }, { ...EGG, values: supply.egg.map(coinsNumber) }],
    xTick: (i) => `Round ${supply.rounds[i]}`,
    xLabel: label,
    format: (_, k, i) => coins(exact[k][i]),
  };
}

export function renderSupply(state) {
  const box = $('supply-body');
  const view = state.stats;
  if (!view) {
    onChange(box, ['wait'], () => put(box, h('p', { class: 'loading' }, 'Reading the supply from the chain…')));
    return;
  }
  const last = state.round ? state.round.id : 0;
  const day = state.round ? openDay(state.round, view) : null;
  onChange(box, [view.hen_supply, view.egg_supply, view.ledger_entries, state.ledger.length, state.ft, last, day, state.history.length], () => {
    const st = view.stats;
    const supply = supplyByRound(state.ledger, last);
    const stats = h('div', { class: 'stats' },
      stat('HEN supply now', coins(view.hen_supply), `${coins(st.minted_hen)} minted, ${coins(st.burned_hen)} fried`),
      stat('EGG supply now', coins(view.egg_supply), `${coins(st.minted_egg)} minted, ${coins(st.burned_egg)} fried`));
    if (!view.ledger_entries) {
      put(box, stats, empty('egg', 'No coins exist yet',
        'Both coins start at zero. The chart starts when the first starter pack is claimed.'));
      return;
    }
    if (!supply) {
      put(box, stats, h('p', { class: 'loading' }, `Loading ${view.ledger_entries} lines of the log…`));
      return;
    }
    if (supply.rounds.length < 2) {
      put(box, stats, checkLine(state, supply), h('p', { class: 'fine' },
        `Both coins started at zero; every coin so far came from starter packs in round ${supply.rounds[0]}. `
        + 'A chart of the supply round by round starts here once a second round is under way.'));
      return;
    }
    const chartBox = box.querySelector('#chain-chart') || h('div', { id: 'chain-chart' });
    put(box, stats, checkLine(state, supply), chartBox,
      h('p', { class: 'fine' },
        `Both coins started at zero. The chart starts at round ${supply.rounds[0]}, when the first coins were minted. `
        + 'The axis does not start at zero, so that small changes can be seen.'));
    lineChart(chartBox, chainChart(state, supply));
  });
}

/** The 60-day community simulation. Never mixed with chain data. */
export function renderSim(state) {
  const box = $('sim-body');
  const sim = state.sim;
  onChange(box, [sim ? sim.days : null, state.simError], () => {
    if (state.simError) {
      put(box, h('p', { class: 'loading' }, 'The simulation file could not be loaded.'));
      return;
    }
    if (!sim) {
      put(box, h('p', { class: 'loading' }, 'Loading the simulation…'));
      return;
    }
    const n = (v) => Number(v).toLocaleString('en-US');
    const chartBox = h('div', { id: 'sim-chart' });
    put(box,
      h('p', { class: 'sim-text' },
        `What a bigger crowd could look like: ${n(sim.players)} simulated players, each with a starter pack of `
        + `${n(sim.starter_hen)} HEN and ${n(sim.starter_egg)} EGG, play the first ${sim.days} recorded days by the same rules `
        + `(hatch ${bps(sim.hatch_bps)}, fry ${bps(sim.fry_bps)}). Over the ${sim.days} rounds the simulation mints `
        + `${n(sim.minted)} coins and burns ${n(sim.burned)}.`),
      chartBox,
      h('p', { class: 'fine' }, 'These numbers come from a computer model with made-up players. None of them are on the chain.'));
    lineChart(chartBox, {
      title: `Simulated HEN and EGG supply over ${sim.days} rounds (not chain data)`,
      xName: 'Simulated round',
      series: [{ ...HEN, values: sim.hen }, { ...EGG, values: sim.egg }],
      xTick: (i) => (i === 0 ? 'Start' : `Round ${i}`),
      xLabel: (i) => (i === 0 ? 'Simulation start' : `Simulation, after round ${i}`),
      format: (v) => n(v),
    });
  });
}
