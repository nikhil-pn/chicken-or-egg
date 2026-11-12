import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chain, link, move } from '../live.mjs';

// A shelf of six chicken packs and six egg packs, each price times a factor.
const shelf = (hen = 1, egg = 1, skip = []) => {
  const side = (base, factor) => Object.fromEntries(
    [0, 1, 2, 3, 4, 5].filter((i) => !skip.includes(i)).map((i) => [`shop:${i}`, (base + i) * factor]));
  return { hen: side(380, hen), egg: side(10, egg) };
};

test('the first link is the middle shop price, in paise', () => {
  const first = link(null, shelf());
  assert.equal(first.level.hen, 382.5 * 100); // per kg
  assert.equal(first.level.egg, 12.5 * 1200); // per dozen
});

test('a later link moves by the mean change of the matched products', () => {
  const second = link(link(null, shelf()), shelf(1.02, 0.99));
  assert.ok(Math.abs(second.level.hen / 38250 - 1.02) < 1e-9);
  assert.ok(Math.abs(second.level.egg / 15000 - 0.99) < 1e-9);
  assert.deepEqual(second.matched, { hen: 6, egg: 6 });
});

test('a product that appears or sells out cannot move the index', () => {
  const before = { a: 100, b: 100, c: 100, d: 100, e: 100, gone: 100 };
  const today = { a: 100, b: 100, c: 100, d: 100, e: 100, fresh: 999 };
  assert.deepEqual(move(before, today), { ratio: 1, matched: 5 });
});

test('too few matched products: the reading is not used', () => {
  assert.equal(link(link(null, shelf()), shelf(1, 1, [0, 1])), null);
  assert.equal(link(null, { hen: { a: 1 }, egg: {} }), null);
});

test('the chain survives a restart and reports whole numbers', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'coe-')), 'chain.json');
  const chain = new Chain(file);
  assert.equal(chain.at(1), null);
  assert.deepEqual(chain.add(1, shelf()), { hen: 38250n, egg: 15000n });
  assert.equal(chain.add(2, shelf(1, 1, [0, 1, 2])), null); // a bad reading leaves the chain alone
  const again = new Chain(file);
  assert.deepEqual(again.at(1), { hen: 38250n, egg: 15000n });
  assert.deepEqual(again.add(3, shelf(1.1, 1)), { hen: 42075n, egg: 15000n });
});
