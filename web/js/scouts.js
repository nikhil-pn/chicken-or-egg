// The scout swarm: one row per scout, the middle price they set, and who got what.
import { $, h, put, onChange, empty, table, row, chip } from './dom.js';
import { big, near, coins, price, pricePer, acct, plural, SIDE } from './format.js';
import { ledgerOfRound } from './result.js';

/**
 * The middle value, by the same rule as the contract: with an even count
 * it is the mean of the two middle values, rounded down.
 */
export function middle(values) {
  const sorted = values.map(big).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2n;
}

/**
 * The chain keeps opened reports only until the round settles.
 * The page remembers the ones it saw, so the last round's bids stay readable.
 */
export function remember(state) {
  const { round, scouts, seen } = state;
  if (!round || !scouts || (round.phase !== 'reveal' && round.phase !== 'settle')) return;
  for (const scout of scouts) {
    if (!scout.revealed || scout.hen_price === null || scout.egg_price === null) continue;
    if (!seen.has(round.id)) seen.set(round.id, new Map());
    seen.get(round.id).set(scout.scout_id, { hen: scout.hen_price, egg: scout.egg_price });
  }
  for (const id of [...seen.keys()]) if (id < round.id - 2) seen.delete(id);
}

const HEADS = [
  { label: 'Scout' },
  { label: 'This round' },
  { label: 'Price report (bid)' },
  { label: 'Bond', num: true },
  { label: 'Honest rounds', num: true },
  { label: 'Slashed rounds', num: true },
  { label: 'Earned, not collected yet' },
];

function status(scout, phase) {
  if (scout.benched) return chip('bad', 'Benched', 'The bond fell below the minimum. This scout cannot report until it is topped up.');
  if (scout.revealed) return chip('good', 'Opened');
  if (scout.sealed) {
    return phase === 'settle'
      ? chip('bad', 'Sealed, never opened', 'A sealed report that is never opened is slashed when the round settles.')
      : chip('warn', 'Sealed');
  }
  return chip('plain', phase === 'roost' ? 'Waiting' : 'No report');
}

const pair = (hen, egg, unit) => `🐔 ${price(hen, unit)} · 🥚 ${price(egg, unit)}`;

function report(scout, state, last) {
  const unit = state.game.price;
  const lines = [];
  if (scout.revealed && scout.hen_price !== null) lines.push(h('span', { class: 'bid' }, pair(scout.hen_price, scout.egg_price, unit)));
  else if (scout.sealed) lines.push(h('span', { class: 'bid muted' }, '🔒 hidden until the reveal'));
  else lines.push(h('span', { class: 'bid muted' }, '—'));
  const before = last && state.seen.get(last.id) && state.seen.get(last.id).get(scout.scout_id);
  if (before) {
    lines.push(h('span', { class: 'bid-last' }, `Round ${last.id}: ${pair(before.hen, before.egg, unit)}`,
      last.slashed.includes(scout.scout_id) ? chip('bad', 'slashed') : null));
  } else if (last && last.slashed.includes(scout.scout_id)) {
    lines.push(h('span', { class: 'bid-last' }, `Round ${last.id}: `, chip('bad', 'slashed')));
  }
  return h('div', { class: 'bid-cell' }, lines);
}

function earned(scout) {
  const bits = [];
  if (big(scout.earned_near) > 0n) bits.push(near(scout.earned_near));
  if (big(scout.earned_hen) > 0n) bits.push(`${coins(scout.earned_hen)} HEN`);
  if (big(scout.earned_egg) > 0n) bits.push(`${coins(scout.earned_egg)} EGG`);
  return bits.length ? bits.join(' · ') : 'Nothing yet';
}

function scoutCell(scout) {
  const funded = scout.funder && scout.funder !== scout.scout_id
    ? h('span', { class: 'bid-last' }, 'funded by ', acct(scout.funder)) : null;
  return h('div', { class: 'bid-cell' }, acct(scout.scout_id), funded);
}

/** Middle prices: the last settled ones, and the ones forming in the open round. */
function middleBox(state, last) {
  const { round, scouts, config, game } = state;
  const unit = game.price;
  const kids = [h('p', { class: 'card-label' }, 'Middle price (clearing price)')];
  if (round.last_hen_price === null || round.last_egg_price === null) {
    kids.push(h('p', { class: 'mid-none' }, 'No middle price yet. It is set the first time enough scouts open their reports.'));
  } else {
    // Name the round only when the history is complete up to the open round.
    const synced = state.history.length === round.id - 1;
    const from = synced ? [...state.history].reverse().find((r) => r.outcome !== 'void') : null;
    kids.push(h('div', { class: 'mid-prices' },
      h('div', { class: 'mid-price mid-hen' }, h('span', { class: 'mid-name' }, '🐔 Chicken'),
        h('b', null, pricePer(round.last_hen_price, unit, 'hen'))),
      h('div', { class: 'mid-price mid-egg' }, h('span', { class: 'mid-name' }, '🥚 Eggs'),
        h('b', null, pricePer(round.last_egg_price, unit, 'egg')))));
    kids.push(h('p', { class: 'mid-note' }, from
      ? `Set by round ${from.id} from ${plural(from.reveals, 'opened report')}. Half of the scouts reported this much or more, half this much or less.`
      : 'The middle of the reports the scouts opened in the last decided round.'));
  }
  const open = scouts.filter((sc) => sc.revealed && sc.hen_price !== null);
  if (open.length && (round.phase === 'reveal' || round.phase === 'settle')) {
    const need = config ? config.min_reveals : null;
    const enough = need === null || open.length >= need;
    kids.push(h('p', { class: 'mid-live' }, chip('warn', 'Not final'),
      ` Round ${round.id} so far: ${plural(open.length, 'report')} opened, middle `
      + `${pair(middle(open.map((sc) => sc.hen_price)), middle(open.map((sc) => sc.egg_price)), unit)}.`
      + (enough ? ' It counts when someone settles the round.' : ` It needs ${need} opened reports to count.`)));
  }
  if (unit && unit.place) {
    kids.push(h('p', { class: 'mid-note' }, `The prices are a price index of real shop shelves in ${unit.place}: `
      + 'it starts at the middle shop price and then moves by how the same products changed in price.'));
  }
  if (last) kids.push(whoGotWhat(state, last));
  return h('div', { class: 'card mid' }, kids);
}

/** What the scouts got in the last settled round. */
function whoGotWhat(state, last) {
  const bits = [];
  const log = ledgerOfRound(state.ledger, last.id);
  if (last.honest > 0 && log.scout_pay > 0n) {
    const coin = SIDE[last.outcome] ? SIDE[last.outcome].coin : '';
    bits.push(`${plural(last.honest, 'honest scout')} got ${coins(log.scout_pay / BigInt(last.honest))} ${coin} each (scout pay)`);
  } else if (last.honest > 0) {
    bits.push(`${plural(last.honest, 'scout')} reported honestly`);
  }
  if (big(last.pot_paid) > 0n && last.honest > 0) {
    bits.push(`they shared ${near(last.pot_paid)} from the pot`);
  }
  const text = bits.length ? `${bits.join(' and ')}.` : 'No scout was paid.';
  const slashed = last.slashed.length
    ? [' Slashed: ', last.slashed.map((id, i) => [i ? ', ' : '', acct(id)]), '.']
    : ' Nobody was slashed.';
  return h('p', { class: 'mid-who' }, h('b', null, `Who got what in round ${last.id}: `), text, slashed);
}

export function renderScouts(state) {
  const box = $('scouts-body');
  const { round, scouts, config } = state;
  if (!round || !scouts) {
    onChange(box, ['wait'], () => put(box, h('p', { class: 'loading' }, 'Reading the scouts from the chain…')));
    return;
  }
  const last = state.history[state.history.length - 1] || null;
  const seenLast = last && state.seen.get(last.id) ? state.seen.get(last.id).size : 0;
  onChange(box, [scouts, round.id, round.phase, round.pot, round.last_hen_price, round.last_egg_price, last && last.id,
    state.ledger.length, seenLast, config && config.min_reveals], () => {
    if (!scouts.length) {
      const bond = config ? near(config.scout_bond) : 'a bond';
      const need = config ? config.min_reveals : 'enough';
      put(box, empty('🔭', 'No scouts have joined yet',
        `A scout joins by locking ${bond}. A round is decided once at least ${need} scouts open a report.`));
      return;
    }
    const pot = big(round.pot);
    const benched = scouts.filter((sc) => sc.benched).length;
    put(box,
      middleBox(state, last),
      h('p', { class: 'section-note' },
        `${plural(scouts.length, 'scout')} in the swarm${benched ? `, ${benched} benched` : ''}. `
        + `Pot waiting for honest scouts: ${near(pot)}.`),
      table('Scouts and their reports', HEADS, scouts.map((scout) => row([
        scoutCell(scout),
        status(scout, round.phase),
        report(scout, state, last),
        near(scout.bond),
        String(scout.honest_rounds),
        String(scout.slashed_rounds),
        earned(scout),
      ], HEADS, scout.benched ? 'row-off' : null)), true),
      h('p', { class: 'fine' },
        'A report is sealed first and opened later, so no scout can copy another. '
        + 'The chain shows opened reports only until the round settles; '
        + 'the reports of the round before are the ones this page saw while it was open.'));
  });
}
