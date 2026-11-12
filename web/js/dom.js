// Small DOM helpers. Chain data only ever reaches the page through textContent.

const SVG_NS = 'http://www.w3.org/2000/svg';

function fill(node, props, kids) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.setAttribute('class', value);
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

/** h('p', { class: 'x' }, 'text', child) */
export const h = (tag, props, ...kids) => fill(document.createElement(tag), props, kids);

/** Same as h, for SVG elements. */
export const s = (tag, props, ...kids) => fill(document.createElementNS(SVG_NS, tag), props, kids);

export const $ = (id) => document.getElementById(id);

/** Replaces everything inside `node` with `kids`. */
export function put(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return node;
}

/**
 * Runs `draw` only when `inputs` changed since the last call for this node.
 * Sections call it on every poll, so an unchanged section costs nothing and
 * keeps its scroll position and open <details>.
 */
export function onChange(node, inputs, draw) {
  const sig = JSON.stringify(inputs, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (node.dataset.sig === sig) return false;
  node.dataset.sig = sig;
  draw();
  return true;
}

/** A friendly box for a section that has nothing to show yet. */
export const empty = (emoji, title, text) =>
  h('div', { class: 'empty' }, h('span', { class: 'empty-emoji', 'aria-hidden': 'true' }, emoji),
    h('p', { class: 'empty-title' }, title), text ? h('p', { class: 'empty-text' }, text) : null);

/**
 * A table inside its own sideways scroll box, so the page never scrolls sideways.
 * With `stack`, a phone shows each row as a small card instead (label: value lines).
 */
export function table(caption, heads, rows, stack) {
  const head = h('tr', null, heads.map((x) => h('th', { scope: 'col', class: x.num ? 'num' : null }, x.label)));
  return h('div', { class: stack ? 'scroll stack' : 'scroll', tabindex: '0', role: 'region', 'aria-label': caption },
    h('table', null, h('caption', { class: 'sr' }, caption), h('thead', null, head), h('tbody', null, rows)));
}

/** One table row. `cells` are nodes or strings; `heads` marks right-aligned columns and gives the phone labels. */
export const row = (cells, heads, cls) =>
  h('tr', { class: cls || null }, cells.map((c, i) => {
    const head = heads[i] || {};
    const kind = [head.num ? 'num' : '', head.phone === false ? 'phone-hide' : ''].join(' ').trim();
    return h('td', { class: kind || null, 'data-label': head.label || null }, c);
  }));

/** A small label pill. kind: hen | egg | tie | void | base | good | warn | bad | plain */
export const chip = (kind, text, title) => h('span', { class: `chip chip-${kind}`, title: title || null }, text);
