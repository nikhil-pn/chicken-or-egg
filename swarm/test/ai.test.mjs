import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basketOf, parseAnswer, pickBaskets, validate } from '../ai.mjs';
import { loadRaw, saveRaw } from '../daily.mjs';
import { aiSource } from '../sources.mjs';

// Six chicken packs and six egg packs, each price times a factor, plus two listings no basket wants.
const rawAt = (hen = 1, egg = 1) => ({
  hen: [
    ...[0, 1, 2, 3, 4, 5].map((i) => ({
      key: `shop:c${i}`, name: `Chicken Curry Cut ${i}`, price: (400 + i) * hen / 2, weightInGms: 500,
      unitCount: null, pricePerKg: (400 + i) * hen, pricePerUnit: null,
    })),
    { key: 'shop:masala', name: 'Chicken Masala', price: 60, weightInGms: 100, unitCount: null, pricePerKg: 600, pricePerUnit: null },
  ],
  egg: [
    ...[0, 1, 2, 3, 4, 5].map((i) => ({
      key: `shop:e${i}`, name: `Farm Eggs ${i}`, price: (8 + i) * egg * 12, weightInGms: null,
      unitCount: 12, pricePerKg: null, pricePerUnit: (8 + i) * egg,
    })),
    { key: 'shop:quail', name: 'Quail Eggs', price: 90, weightInGms: null, unitCount: 12, pricePerKg: null, pricePerUnit: 7.5 },
  ],
});
const fileIn = () => join(mkdtempSync(join(tmpdir(), 'coe-ai-')), 'ai-chain.json');

/** A fake model that picks the plain packs and counts how often it is asked. */
function fakeModel() {
  const ask = async (raw) => {
    ask.calls += 1;
    const plain = (list) => list.map((p) => p.key).filter((key) => /:(c|e)\d$/.test(key));
    return { model: 'fake', hen: plain(raw.hen), egg: plain(raw.egg) };
  };
  ask.calls = 0;
  return ask;
}

/** A fake chat endpoint that always gives the same answer, or the same HTTP error. */
function fakeFetch(content, status = 200) {
  const fetch = async (url, init) => {
    fetch.calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: status === 200, status,
      json: async () => (status === 200 ? { model: 'Qwen/Test', choices: [{ message: { content } }] } : { error: { message: 'Invalid or expired API key' } }),
    };
  };
  fetch.calls = [];
  return fetch;
}
const quick = (fetch) => ({ fetch, env: { NEAR_AI_API_KEY: 'test-key', NEAR_AI_BASE_URL: 'https://example.test/v1/', NEAR_AI_MODEL: 'm' }, retryMs: 0 });

test('picks become a basket of unit prices', () => {
  const basket = basketOf(rawAt(), { hen: ['shop:c0', 'shop:c1'], egg: ['shop:e2'] });
  assert.deepEqual(basket, { hen: { 'shop:c0': 400, 'shop:c1': 401 }, egg: { 'shop:e2': 10 } });
});

test('the first reading starts at the shared index, later ones move by its own picks', async () => {
  const source = aiSource({ file: fileIn(), ask: fakeModel() });
  // The median of its picks would be 402.5 rupees per kg; the shared index says 38000 paise. It starts there.
  const first = await source({ round: 1, raw: rawAt(), truth: { hen: 38000n, egg: 13000n } });
  assert.deepEqual(first, { hen: 38000n, egg: 13000n });
  // Its own picks rose 2% (chicken) and fell 1% (eggs). The shared index is ignored from now on.
  const second = await source({ round: 2, raw: rawAt(1.02, 0.99), truth: { hen: 1n, egg: 1n } });
  assert.deepEqual(second, { hen: 38760n, egg: 12870n });
});

test('a round is decided once, and a restart reports the same thing without asking again', async () => {
  const file = fileIn();
  const ask = fakeModel();
  const source = aiSource({ file, ask });
  const ctx = { round: 1, raw: rawAt(), truth: { hen: 38000n, egg: 13000n } };
  const first = await source(ctx);
  assert.deepEqual(await source({ ...ctx, raw: rawAt(2, 2) }), first);
  assert.deepEqual(await aiSource({ file, ask })(ctx), first); // after a restart
  assert.equal(ask.calls, 1);
  // A skipped round stays skipped.
  const broken = async () => { throw new Error('down'); };
  assert.equal(await aiSource({ file, ask: broken })({ round: 2, raw: rawAt(), truth: null }), null);
  assert.equal(await aiSource({ file, ask })({ round: 2, raw: rawAt(), truth: null }), null);
  assert.equal(ask.calls, 1);
});

test('no raw listings, too few picks or no key: no report', async () => {
  const ask = fakeModel();
  const source = aiSource({ file: fileIn(), ask });
  const truth = { hen: 38000n, egg: 13000n };
  assert.equal(await source({ round: 1, raw: null, truth }), null);
  assert.equal(ask.calls, 0);
  const few = async () => ({ model: 'fake', hen: ['shop:c0', 'shop:c1'], egg: ['shop:e0'] });
  assert.equal(await aiSource({ file: fileIn(), ask: few })({ round: 1, raw: rawAt(), truth }), null);
  const noKey = (raw, opts) => pickBaskets(raw, { ...opts, env: {} });
  assert.equal(await aiSource({ file: fileIn(), ask: noKey })({ round: 1, raw: rawAt(), truth }), null);
});

test('an invalid model answer gives no report, after two more tries', async () => {
  const fetch = fakeFetch('These all look like chicken to me.');
  const ask = (raw, opts) => pickBaskets(raw, { ...opts, ...quick(fetch) });
  const report = await aiSource({ file: fileIn(), ask })({ round: 1, raw: rawAt(), truth: { hen: 38000n, egg: 13000n } });
  assert.equal(report, null);
  assert.equal(fetch.calls.length, 3);
  // A rejected key is not asked again.
  const refused = fakeFetch('', 401);
  await assert.rejects(pickBaskets(rawAt(), quick(refused)), /HTTP 401: Invalid or expired API key/);
  assert.equal(refused.calls.length, 1);
  assert.throws(() => parseAnswer('{"hen": "shop:c0"}'), /"hen" and an "egg" list/);
});

test('the model call: temperature 0, the chosen model, and only valid keys come back', async () => {
  const answer = '<think>maybe {"hen": []}</think>\n```json\n'
    + '{"hen": ["shop:c0", "shop:c1", "shop:e0", "made-up", "shop:c2"], "egg": ["shop:e1", "shop:c2", "shop:c3"]}\n```';
  const fetch = fakeFetch(answer);
  const picks = await pickBaskets(rawAt(), quick(fetch));
  const [{ url, init, body }] = fetch.calls;
  assert.equal(url, 'https://example.test/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer test-key');
  assert.equal(body.temperature, 0);
  assert.equal(body.model, 'm');
  assert.match(body.messages[1].content, /shop:quail \| Quail Eggs \| 12 pieces/);
  // An egg as chicken has no price per kg, a made-up key does not exist, a key on both sides is dropped from both,
  // and chicken as eggs has no price per egg.
  assert.deepEqual(picks, { model: 'Qwen/Test', hen: ['shop:c0', 'shop:c1'], egg: ['shop:e1'] });
  assert.equal(validate({ hen: ['shop:c0'], egg: ['shop:c0'] }, rawAt()).dropped, 2);
});

test('the raw listings of a round are kept on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coe-raw-'));
  assert.equal(loadRaw(dir, 3), null);
  saveRaw(dir, 3, rawAt());
  assert.deepEqual(loadRaw(dir, 3), rawAt());
});
