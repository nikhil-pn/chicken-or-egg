import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readShelf } from '../shelf.mjs';

// A stand-in for the old price tracker: three app readers and a watchlist, no browser and no network.
const product = (variantId, name, price, { g = null, units = null, out = false } = {}) => ({
  variantId, name, price, weightInGms: g, unitCount: units, outOfStock: out, brand: null, ratingCount: 0, url: 'x',
  pricePerKg: g ? Math.round((price / g) * 1000) : null, pricePerUnit: units ? Math.round((price / units) * 100) / 100 : null,
});
const SEARCHES = {
  zepto: {
    'chicken curry cut': [
      product('z1', 'Fresh Chicken Curry Cut', 200, { g: 500 }),
      product('z2', 'Chicken Curry Cut Marinated', 250, { g: 500 }),
      product('z3', 'Chicken Curry Cut', 190, { g: 500, out: true }),
    ],
    eggs: [
      product('z4', 'Farm Eggs', 96, { units: 12 }),
      product('z5', 'Quail Eggs', 90, { units: 12 }),
      product('z6', 'Farm Eggs Tray', 210, { units: 30 }),
    ],
  },
  blinkit: {
    'chicken curry cut': [product('b1', 'Chicken Curry Cut (Skinless)', 230, { g: 500 })],
    // A long egg aisle: the raw listings are capped, and every app keeps its share.
    eggs: Array.from({ length: 100 }, (_, i) => product(`b${100 + i}`, `Brand ${i} White Eggs`, 80 + i, { units: 10 })),
  },
};
const watch = (platform, side) => (side === 'hen'
  ? { id: `${platform}-chicken-curry-cut`, platform, query: 'chicken curry cut', match: { includeAny: ['curry cut'], exclude: ['marinated'], minWeightG: 250 } }
  : { id: `${platform}-eggs-10-12`, platform, query: 'eggs', match: { include: ['egg'], exclude: ['quail'], minUnits: 10, maxUnits: 12 } });

function fakeTracker() {
  const dir = mkdtempSync(join(tmpdir(), 'coe-tracker-'));
  mkdirSync(join(dir, 'lib'));
  const session = (app) => `({ search: async (q) => ({ products: ${JSON.stringify(SEARCHES[app])}[q] ?? [] }), close: async () => {} })`;
  writeFileSync(join(dir, 'lib/zepto.mjs'), `export const openZepto = async () => ${session('zepto')};\n`);
  writeFileSync(join(dir, 'lib/blinkit.mjs'), `export const fetchBlinkit = async (q) => ${session('blinkit')}.search(q);\n`);
  writeFileSync(join(dir, 'lib/instamart.mjs'), 'export const openInstamart = async () => { throw new Error("no products"); };\n');
  const watches = ['zepto', 'blinkit', 'instamart'].flatMap((app) => [watch(app, 'hen'), watch(app, 'egg')]);
  writeFileSync(join(dir, 'watchlist.json'), JSON.stringify(watches));
  return dir;
}

test('a reading keeps the filtered shelf and adds the raw listings of each side', async () => {
  const shelf = await readShelf(fakeTracker());
  // The tracker's filters, unchanged: no marinated chicken, no quail, no tray of 30.
  assert.deepEqual(shelf.hen, { 'zepto:z1': 400, 'blinkit:b1': 460 });
  assert.equal(shelf.egg['zepto:z4'], 8);
  assert.equal(Object.keys(shelf.egg).length, 101);
  // Raw: everything in stock that the searches returned, before the filters.
  assert.deepEqual(shelf.raw.hen.map((p) => p.key).sort(), ['blinkit:b1', 'zepto:z1', 'zepto:z2']);
  assert.deepEqual(shelf.raw.hen.find((p) => p.key === 'zepto:z2'), {
    key: 'zepto:z2', name: 'Chicken Curry Cut Marinated', price: 250, weightInGms: 500, unitCount: null, pricePerKg: 500, pricePerUnit: null,
  });
  assert.equal(shelf.raw.egg.length, 80);
  for (const key of ['zepto:z4', 'zepto:z5', 'zepto:z6']) assert.ok(shelf.raw.egg.some((p) => p.key === key), key);
});
