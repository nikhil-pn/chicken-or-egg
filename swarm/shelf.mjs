// Reads today's shelf prices of chicken and eggs in three grocery delivery apps.
//
// The app readers and the product filters belong to our older price tracker, which is
// not part of this repository (see docs/INDEX.md). TRACKER_DIR points at it.
// Usage: TRACKER_DIR=<tracker> node swarm/shelf.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KOCHI = { lat: 9.9312328, lng: 76.2673041 };
const PLATFORMS = ['zepto', 'blinkit', 'instamart'];
/** Which tracker watches feed which side, and the unit price each side uses. */
const SIDES = [
  { side: 'hen', watch: /curry/, unit: (p) => p.pricePerKg }, // rupees per kg
  { side: 'egg', watch: /egg/, unit: (p) => p.pricePerUnit }, // rupees per egg
];

/** The raw listings kept per side, for the scouts that pick their own products. */
const RAW_CAP = 80;

const has = (name, word) => name.includes(word.toLowerCase());
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** One listing as the AI scout sees it: what the shop says, before any filter. */
const listing = (key, p) => ({
  key, name: p.name, price: p.price, weightInGms: p.weightInGms ?? null, unitCount: p.unitCount ?? null,
  pricePerKg: p.pricePerKg ?? null, pricePerUnit: p.pricePerUnit ?? null,
});

/** At most `n` listings, taken from each app in turn, so one app cannot crowd out the others. */
function capFair(list, n) {
  const byApp = new Map();
  for (const item of list) {
    const app = item.key.split(':')[0];
    byApp.set(app, [...(byApp.get(app) ?? []), item]);
  }
  const queues = [...byApp.values()];
  const out = [];
  for (let i = 0; out.length < n && queues.some((q) => i < q.length); i += 1) {
    for (const q of queues) if (i < q.length && out.length < n) out.push(q[i]);
  }
  return out;
}

/** The apps sometimes answer a search with no products at all, so an empty answer is asked again. */
async function searchOnce(search, query, tries = 3) {
  for (let i = 1; ; i += 1) {
    const result = await search(query);
    if (result.products?.length || i >= tries) return result;
    await pause(5000 * i);
  }
}

/** The tracker's filter rules for one watch, applied to one product. */
function fits(p, m) {
  const name = p.name.toLowerCase();
  if (m.include && !m.include.every((w) => has(name, w))) return false;
  if (m.includeAny && !m.includeAny.some((w) => has(name, w))) return false;
  if (m.exclude && m.exclude.some((w) => has(name, w))) return false;
  if (m.maxWeightG && p.weightInGms > m.maxWeightG) return false;
  if (m.minWeightG && p.weightInGms && p.weightInGms < m.minWeightG) return false;
  if (m.minUnits || m.maxUnits) {
    if (!p.unitCount || p.unitCount < (m.minUnits ?? 0) || p.unitCount > (m.maxUnits ?? Infinity)) return false;
  }
  return true;
}

/** Keeps the products of the `n` brands with the most ratings. */
function topBrands(products, n) {
  if (!n) return products;
  const brand = (p) => (p.brand || p.name.split(/\s+/).slice(0, 2).join(' ')).toLowerCase().trim();
  const best = new Map();
  for (const p of products) best.set(brand(p), Math.max(best.get(brand(p)) ?? 0, p.ratingCount ?? 0));
  const keep = new Set([...best].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name));
  return products.filter((p) => keep.has(brand(p)));
}

/**
 * One reading: { hen: { "<app>:<product>": rupees per kg }, egg: { ...: rupees per egg }, raw }. In-stock products only.
 * `raw` is { hen: [listing], egg: [listing] }: everything the searches for that side returned, before the filters.
 */
export async function readShelf(dir = process.env.TRACKER_DIR, log = () => {}) {
  if (!dir) throw new Error('TRACKER_DIR is not set. The shop reader is not part of this repository.');
  const load = (file) => import(pathToFileURL(join(dir, file)).href);
  const [zepto, blinkit, instamart] = await Promise.all(PLATFORMS.map((name) => load(`lib/${name}.mjs`)));
  const open = { zepto: zepto.openZepto, instamart: instamart.openInstamart };
  const watches = JSON.parse(readFileSync(join(dir, 'watchlist.json'), 'utf8'))
    .filter((w) => w.enabled !== false && w.type !== 'link' && w.match);
  const shelf = { hen: {}, egg: {} };
  const raw = { hen: new Map(), egg: new Map() };

  // One app at a time, so only one browser is open.
  for (const platform of PLATFORMS) {
    let session;
    let packs = 0;
    try {
      session = open[platform] ? await open[platform](KOCHI) : null;
      const search = session ? (q) => session.search(q) : (q) => blinkit.fetchBlinkit(q, KOCHI);
      const searches = new Map();
      for (const w of watches.filter((w) => w.platform === platform)) {
        const feeds = SIDES.find(({ watch }) => watch.test(w.id));
        if (!feeds) continue;
        if (!searches.has(w.query)) {
          searches.set(w.query, await searchOnce(search, w.query));
        }
        for (const p of searches.get(w.query).products ?? []) {
          const key = `${platform}:${p.variantId}`;
          if (!p.outOfStock && p.variantId && p.price > 0) raw[feeds.side].set(key, listing(key, p));
        }
        const hits = topBrands(searches.get(w.query).products.filter((p) => fits(p, w.match)), w.match.topBrands);
        for (const p of hits) {
          if (p.outOfStock || !(feeds.unit(p) > 0)) continue;
          shelf[feeds.side][`${platform}:${p.variantId}`] = feeds.unit(p);
          packs += 1;
        }
      }
      log(`shelf: ${platform} has ${packs} packs in stock`);
    } catch (error) {
      log(`shelf: ${platform} could not be read (${error.message})`);
    } finally {
      await session?.close().catch(() => {});
    }
  }
  return { ...shelf, raw: { hen: capFair([...raw.hen.values()], RAW_CAP), egg: capFair([...raw.egg.values()], RAW_CAP) } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shelf = await readShelf(undefined, console.error);
  console.error(`${Object.keys(shelf.hen).length} chicken packs, ${Object.keys(shelf.egg).length} egg packs in stock`);
  console.error(`raw listings: ${shelf.raw.hen.length} for chicken, ${shelf.raw.egg.length} for eggs`);
  console.log(JSON.stringify(shelf));
}
