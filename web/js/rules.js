// The rules in four steps, and every parameter read live from get_config.
import { $, h, put, onChange, table, row, chip } from './dom.js';
import { coins, near, bps, acct, plural, duration } from './format.js';

function steps(config) {
  const secs = (n) => (config ? ` (${duration(config[n])})` : '');
  const pct = (n) => (config ? bps(config[n]) : 'a fixed share');
  return [
    ['🪺', 'Roost', `Pick a side. Lock some $HEN or some $EGG in the coop before roosting closes${secs('roost_secs')}. One side per round.`],
    ['🔒', 'Seal', `Scout agents read the real shop prices of chicken and eggs. Each one sends a sealed report${secs('commit_secs')}, so no scout can copy another.`],
    ['👀', 'Open', `The scouts open their reports${secs('reveal_secs')}. The coop takes the middle price of each. A scout far from the middle loses part of its bond.`],
    ['🐣', 'Settle', `The price that rose more (or fell less) since the last round came first. Winners hatch: their roost grows by ${pct('hatch_bps')}. `
      + `Losers get fried: ${pct('fry_bps')} of their roost burns. A tie changes nothing.`],
  ];
}

const HEADS = [{ label: 'Parameter' }, { label: 'Value' }, { label: 'What it does' }];

/** A coin contract with what its own ft_metadata says. */
const coin = (account, meta) => h('span', null, acct(account),
  meta ? ` · ${meta.name} (${meta.symbol}), ${meta.decimals} decimals` : null);

function params(state) {
  const c = state.config;
  const claimed = state.stats ? `, ${state.stats.stats.starters_claimed} claimed so far` : '';
  const name = (label, field) => h('span', null, label, ' ', h('code', null, field));
  return [
    [name('Roost phase', 'roost_secs'), duration(c.roost_secs), 'Time for players to lock coins on a side.'],
    [name('Commit phase', 'commit_secs'), duration(c.commit_secs), 'Time for scouts to send sealed price reports. Roosting is closed.'],
    [name('Reveal phase', 'reveal_secs'), duration(c.reveal_secs), 'Time for scouts to open their reports. After it, anyone may settle.'],
    [name('Hatch', 'hatch_bps'), bps(c.hatch_bps), 'How much a winning roost grows. These are newly minted coins.'],
    [name('Fry', 'fry_bps'), bps(c.fry_bps), 'How much of a losing roost is burned.'],
    [name('Tie gap', 'tie_bps'), bps(c.tie_bps), 'If the two price moves are closer than this, the round is a tie.'],
    [name('Scout pay', 'scout_pay'), `${coins(c.scout_pay)} coins per round with a winner`, 'Minted in the winning coin and shared by the honest scouts.'],
    [name('Scout bond', 'scout_bond'), near(c.scout_bond), 'NEAR a scout locks to join the swarm.'],
    [name('Minimum bond', 'min_bond'), near(c.min_bond), 'Below this a scout is benched and cannot report.'],
    [name('Slash', 'slash_bps'), `${bps(c.slash_bps)} of the bond`, 'Taken from a scout that lies or seals a report and never opens it. It goes to the pot for honest scouts.'],
    [name('Tolerance', 'tolerance_bps'), bps(c.tolerance_bps), 'How far from the middle price a report may be and still count as honest.'],
    [name('Reports needed', 'min_reveals'), String(c.min_reveals), 'With fewer opened reports the round is void: nothing is minted or burned.'],
    [name('Scout seats', 'max_scouts'), String(c.max_scouts), 'The most scouts the swarm can hold. Anyone may add one.'],
    [name('Starter pack', 'starter_hen + starter_egg'), `${coins(c.starter_hen)} HEN + ${coins(c.starter_egg)} EGG`, 'What a new player gets, once per account.'],
    [name('Starter fee', 'starter_fee'), near(c.starter_fee), 'Paid for a starter pack. After storage costs, it goes to the pot for honest scouts.'],
    [name('Starter packs', 'starter_cap'), `${c.starter_cap} in total${claimed}`, 'After these are gone, coins come only from hatches and scout pay.'],
    [name('HEN coin', 'hen_token'), coin(c.hen_token, state.meta.hen), 'Only the coop may mint or burn it.'],
    [name('EGG coin', 'egg_token'), coin(c.egg_token, state.meta.egg), 'Only the coop may mint or burn it.'],
  ];
}

/** The sentence about who can change the parameters, worded by what the chain says right now. */
function lockLine(state) {
  const { game, keys } = state;
  const accounts = [game.coop, game.hen, game.egg];
  const base = 'These values were set when the coop was created, and the contract has no method that changes them. ';
  if (!keys || accounts.some((a) => !keys[a])) {
    return h('p', { class: 'lock' }, chip('plain', 'Checking keys'), ' ', base,
      'The access keys of the contract accounts have not been read yet.');
  }
  const open = accounts.filter((a) => keys[a].full > 0);
  if (!open.length) {
    const none = accounts.every((a) => keys[a].total === 0);
    return h('p', { class: 'lock lock-ok' }, chip('good', '✓ No admin key'), ' ', base,
      `The three contract accounts hold ${none ? 'no access keys at all' : 'no full-access key'} (read from the chain by this page), `
      + 'so no account can change the parameters or replace the code. Check it on the explorer: ',
      accounts.map((a, i) => [i ? ', ' : '', acct(a)]), '.');
  }
  return h('p', { class: 'lock lock-open' }, chip('warn', 'Not locked yet'), ' ', base,
    `Not locked yet: ${plural(open.length, 'contract account')} still ${open.length === 1 ? 'holds' : 'hold'} a full-access key (`,
    open.map((a, i) => [i ? ', ' : '', acct(a)]),
    '). A full-access key could replace the contract code. This line is read from the chain and updates itself.');
}

export function renderRules(state) {
  const list = $('rules-steps');
  onChange(list, [state.config], () => put(list, steps(state.config).map(([emoji, title, text], i) =>
    h('li', { class: 'rule' },
      h('span', { class: 'rule-emoji', 'aria-hidden': 'true' }, emoji),
      h('div', null, h('p', { class: 'rule-title' }, `${i + 1}. ${title}`), h('p', { class: 'rule-text' }, text))))));

  if (state.missing) return; // the not-started notice fills the table's place
  const box = $('params-body');
  if (!state.config) {
    onChange(box, ['wait', state.error], () => put(box, h('p', { class: 'loading' }, 'Reading the parameters from the chain…')));
    return;
  }
  onChange(box, [state.config, state.keys, state.meta, state.stats && state.stats.stats.starters_claimed], () => {
    put(box,
      lockLine(state),
      table('Parameters of the coop, read from get_config', HEADS, params(state).map((cells) => row(cells, HEADS)), true),
      h('p', { class: 'fine' }, 'Read live from ', h('code', null, 'get_config'), ' on ', acct(state.game.coop),
        '. Coins you do not roost are never touched.'));
  });
}
