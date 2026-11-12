// Die-cut stickers drawn in img/stickers.svg. No emojis anywhere on the page: these take their place.

const SPRITE = 'img/stickers.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';
const NAMES = new Set(['hen', 'egg', 'chick', 'fried', 'scout', 'seal', 'coin-hen', 'coin-egg', 'nest']);

/**
 * sticker('hen', { size: 'lg', tilt: -6, label: 'A hen' })
 * size: xs | sm | md | lg | xl. Without a label the sticker is decoration and hidden from screen readers.
 */
export function sticker(name, { size = 'md', tilt = 0, label = null, hover = false } = {}) {
  const art = NAMES.has(name) ? name : 'egg';
  const box = document.createElement('span');
  box.className = `stk stk-${size}${hover ? ' stk-hover' : ''}`;
  if (tilt) box.style.setProperty('--tilt', `${tilt}deg`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    box.setAttribute('aria-hidden', 'true');
  }
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${SPRITE}#${art}`);
  svg.append(use);
  box.append(svg);
  return box;
}

/** The sticker of a side: the hen for $HEN, the egg for $EGG. */
export const sideSticker = (side, opts) => sticker(side === 'hen' ? 'hen' : 'egg', opts);

/** The coin of a side. */
export const coinSticker = (side, opts) => sticker(side === 'hen' ? 'coin-hen' : 'coin-egg', opts);
