// Numbers and names for display. Amounts stay BigInt until the last step.
import { h } from './dom.js';

export const COIN = 18; // decimals of $HEN and $EGG
export const NEAR = 24; // decimals of NEAR
export const EXPLORER = 'https://testnet.nearblocks.io/address/';

export function big(value) {
  try { return BigInt(value ?? 0); } catch { return 0n; }
}

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Base units to a readable number, rounded to the nearest step, trailing zeros removed.
 * units("1500000000000000000", 18) -> "1.5". A tiny non-zero amount shows as "<0.01".
 */
export function units(value, decimals, places = 2) {
  const v = big(value);
  const abs = v < 0n ? -v : v;
  const step = 10n ** BigInt(decimals - places);
  const steps = (abs + step / 2n) / step; // whole number of 0.01s (for two places)
  const per = 10n ** BigInt(places);
  const frac = places ? (steps % per).toString().padStart(places, '0').replace(/0+$/, '') : '';
  if (abs > 0n && steps === 0n) return places ? `<0.${'0'.repeat(places - 1)}1` : '<1';
  return (v < 0n ? '-' : '') + group((steps / per).toString()) + (frac ? `.${frac}` : '');
}

export const coins = (value, places = 2) => units(value, COIN, places);
export const near = (value, places = 3) => `${units(value, NEAR, places)} NEAR`;

/** Base units to a plain Number of whole coins (two decimals). Only for chart geometry. */
export const coinsNumber = (value) => Number((big(value) + 5n * 10n ** BigInt(COIN - 3)) / 10n ** BigInt(COIN - 2)) / 100;

/** 213551 -> "213.6k", for chart axes and end labels. */
export function compact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${trim((n / 1e6).toFixed(2))}M`;
  if (abs >= 1e4) return `${trim((n / 1e3).toFixed(1))}k`;
  return group(trim(n.toFixed(abs < 100 ? 2 : 0)));
}

const trim = (text) => (text.includes('.') ? text.replace(/\.?0+$/, '') : text);

/** Basis points to a percent: 300 -> "3%", 10 -> "0.1%". */
export const bps = (n) => `${trim((Number(n) / 100).toFixed(2))}%`;

/** Parts per million to a percent without a sign: 10000 -> "1.0%", 2710 -> "0.27%". */
export function ppm(n) {
  const p = Math.abs(Number(n)) / 10000;
  const text = p === 0 || p >= 0.01 ? p.toFixed(2) : p.toFixed(4);
  return `${text.replace(/0+$/, '').replace(/\.$/, '.0')}%`;
}

/** Signed move for tables: "+1.0%", "−0.27%", "0%". */
export const move = (n) => (Number(n) === 0 ? '0%' : `${Number(n) > 0 ? '+' : '−'}${ppm(n)}`);

/** Move in words for the result sentence. */
export function moveWords(name, n) {
  const v = Number(n);
  if (v === 0) return `${name} stayed flat`;
  return `${name} went ${v > 0 ? 'up' : 'down'} ${ppm(v)}`;
}

/**
 * A scout price. With a `price` block in games.json it reads as money
 * ("₹380.00"); without one it is shown as the raw whole number.
 */
export function price(value, unit) {
  if (value === null || value === undefined) return '';
  const v = big(value);
  if (!unit || !unit.minor_per_major) return `${group(v.toString())} pts`;
  const minor = BigInt(unit.minor_per_major);
  const places = String(unit.minor_per_major).length - 1;
  const frac = places ? `.${(v % minor).toString().padStart(places, '0')}` : '';
  return `${unit.symbol || ''}${group((v / minor).toString())}${frac}`;
}

export const pricePer = (value, unit, side) =>
  unit && unit[`${side}_unit`] ? `${price(value, unit)} per ${unit[`${side}_unit`]}` : price(value, unit);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-07" -> "7 Aug 2026" (no time zone maths). */
export function isoDate(text) {
  const [y, m, d] = String(text).split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : String(text);
}

const two = (n) => String(n).padStart(2, '0');

/** Chain time (nanoseconds) to the viewer's local clock: "12 Nov, 14:03:22". */
export function when(ns) {
  const date = new Date(Number(ns) / 1e6);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export const clock = (ms) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

/** A countdown: "1:05" under an hour, "11:59:07" from an hour up. */
export function mmss(secs) {
  const t = Math.max(0, Math.floor(secs));
  if (t >= 3600) return `${Math.floor(t / 3600)}:${two(Math.floor((t % 3600) / 60))}:${two(t % 60)}`;
  return `${Math.floor(t / 60)}:${two(t % 60)}`;
}

/** A phase length in words: 40 -> "40 seconds", 43200 -> "12 hours", 5400 -> "1 hour 30 minutes". */
export function duration(secs) {
  const t = Number(secs);
  if (t < 120) return plural(t, 'second');
  if (t < 3600) return t % 60 ? `${plural(Math.floor(t / 60), 'minute')} ${plural(t % 60, 'second')}` : plural(t / 60, 'minute');
  const rest = Math.round((t % 3600) / 60);
  return plural(Math.floor(t / 3600), 'hour') + (rest ? ` ${plural(rest, 'minute')}` : '');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Chain time (nanoseconds) to a date on the viewer's calendar: "13 Nov 2026" (short: "13 Nov"). */
export function dateOf(ns, short) {
  const date = new Date(Number(ns) / 1e6);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${short ? '' : ` ${date.getFullYear()}`}`;
}

/** A moment on the viewer's clock, with the weekday when it is not today: "Fri 13 Nov, 05:30" or "17:30". */
export function stamp(ms) {
  const date = new Date(ms);
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (date.toDateString() === new Date().toDateString()) return `today ${time}`;
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}, ${time}`;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/** Long account names are cut in the middle; the full name stays in the tooltip and the link. */
export function shortName(account) {
  const a = String(account);
  return a.length > 36 ? `${a.slice(0, 14)}…${a.slice(-8)}` : a;
}

/** An account as a link to the block explorer. */
export const acct = (account, label) =>
  h('a', { class: 'acct', href: EXPLORER + encodeURIComponent(account), target: '_blank', rel: 'noopener', title: account },
    label || shortName(account));

export const SIDE = { hen: { coin: 'HEN', food: 'chicken', emoji: '🐔' }, egg: { coin: 'EGG', food: 'eggs', emoji: '🥚' } };
export const other = (side) => (side === 'hen' ? 'egg' : 'hen');
