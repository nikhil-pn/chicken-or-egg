// Amounts written for people ("0.3 NEAR", "100 COIN") turned into the integers the contracts take.
const DECIMALS = { NEAR: 24, COIN: 18 };

/** "0.3 NEAR" -> 300000000000000000000000n. Exact: no floating point. */
export function parseAmount(text) {
  const match = /^(\d+)(?:\.(\d+))?\s+(NEAR|COIN)$/.exec(String(text).trim());
  if (!match) throw new Error(`Not an amount: ${text}. Write it like "0.3 NEAR" or "100 COIN".`);
  const [, whole, fraction = '', unit] = match;
  const decimals = DECIMALS[unit];
  if (fraction.length > decimals) throw new Error(`Too many decimals in ${text}`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}

/** Every "<number> NEAR" or "<number> COIN" string in an object becomes an integer string. */
export function withAmounts(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    out[key] = typeof value === 'string' && / (NEAR|COIN)$/.test(value) ? parseAmount(value).toString() : value;
  }
  return out;
}

/** 1234500000000000000000n with 18 decimals -> "1,234.5". For logs and the page, never for maths. */
export function show(amount, decimals = 18, places = 2) {
  const unit = 10n ** BigInt(decimals - places);
  const scaled = Number(BigInt(amount) / unit) / 10 ** places;
  return scaled.toLocaleString('en-US', { maximumFractionDigits: places });
}
