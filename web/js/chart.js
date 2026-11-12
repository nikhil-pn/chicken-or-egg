// A small line chart in plain SVG: one y axis, a legend, end labels,
// a crosshair with one tooltip for all series, and the same numbers as a table.
import { h, s, put } from './dom.js';
import { compact } from './format.js';

const MARGIN = { top: 14, right: 96, bottom: 30, left: 48 };

/** Round tick values that cover [min, max]. */
function ticks(min, max, want = 4) {
  if (min === max) {
    const pad = Math.max(1, 10 ** Math.floor(Math.log10(Math.abs(min) || 1)) / 2); // a flat line sits mid-chart with clean ticks
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / want;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= raw);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Moves end labels apart so two close lines do not print on top of each other. */
function spread(items, gap, top, bottom) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  }
  const over = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (over > 0) sorted.forEach((it) => { it.y = Math.max(top, it.y - over); });
  return items;
}

function draw(box) {
  const spec = box.chartSpec;
  const plot = box.querySelector('.chart-plot');
  const width = Math.max(280, Math.floor(plot.clientWidth || 640));
  const height = width < 480 ? 230 : 290;
  const m = { ...MARGIN, right: width < 480 ? 84 : MARGIN.right };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const n = spec.series[0].values.length;
  const all = spec.series.flatMap((se) => se.values);
  const lo = spec.zero ? Math.min(0, ...all) : Math.min(...all);
  const yTicks = ticks(lo, Math.max(...all));
  const y0 = yTicks[0];
  const y1 = yTicks[yTicks.length - 1];
  const x = (i) => m.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => m.top + innerH - ((v - y0) / (y1 - y0)) * innerH;

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart-svg', tabindex: '0',
    role: 'img', 'aria-label': `${spec.title}. Use the left and right arrow keys to read values.` });

  for (const t of yTicks) {
    svg.append(s('line', { class: 'grid', x1: m.left, x2: m.left + innerW, y1: y(t), y2: y(t) }),
      s('text', { class: 'tick', x: m.left - 8, y: y(t) + 4, 'text-anchor': 'end' }, compact(t)));
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 76))));
  for (let i = 0; i < n; i += every) {
    if (n - 1 - i < every * 0.6 && i !== n - 1 && i !== 0) continue; // keep room for the last label
    svg.append(s('text', { class: 'tick', x: x(i), y: height - 9, 'text-anchor': 'middle' }, spec.xTick(i)));
  }
  if ((n - 1) % every !== 0 && n > 1) {
    svg.append(s('text', { class: 'tick', x: x(n - 1), y: height - 9, 'text-anchor': 'middle' }, spec.xTick(n - 1)));
  }
  svg.append(s('line', { class: 'axis', x1: m.left, x2: m.left + innerW, y1: m.top + innerH, y2: m.top + innerH }));

  const ends = [];
  for (const se of spec.series) {
    const path = se.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    svg.append(s('path', { class: 'line', d: path, stroke: `var(${se.color})` }));
    if (n <= 12) {
      se.values.slice(0, -1).forEach((v, i) => svg.append(s('circle', { class: 'dot', cx: x(i), cy: y(v), r: 3, fill: `var(${se.color})` })));
    }
    svg.append(s('circle', { class: 'dot', cx: x(n - 1), cy: y(se.values[n - 1]), r: 5, fill: `var(${se.color})` }));
    ends.push({ y: y(se.values[n - 1]), text: `${se.name} ${compact(se.values[n - 1])}` });
  }
  for (const end of spread(ends, 16, m.top + 4, m.top + innerH)) {
    svg.append(s('text', { class: 'end-label', x: x(n - 1) + 11, y: end.y + 4 }, end.text));
  }

  // Hover layer: a crosshair and one dot per series, moved by pointer or arrow keys.
  const cross = s('g', { class: 'cross', visibility: 'hidden' }, s('line', { class: 'cross-line', y1: m.top, y2: m.top + innerH }));
  const dots = spec.series.map((se) => s('circle', { class: 'dot', r: 5, fill: `var(${se.color})` }));
  cross.append(...dots);
  svg.append(cross);
  const tip = box.querySelector('.chart-tip');
  let at = -1;

  function show(i) {
    at = Math.max(0, Math.min(n - 1, i));
    cross.setAttribute('visibility', 'visible');
    cross.firstChild.setAttribute('x1', x(at));
    cross.firstChild.setAttribute('x2', x(at));
    dots.forEach((dot, k) => { dot.setAttribute('cx', x(at)); dot.setAttribute('cy', y(spec.series[k].values[at])); });
    put(tip, h('p', { class: 'tip-title' }, spec.xLabel(at)), spec.series.map((se, k) =>
      h('p', { class: 'tip-row' }, h('span', { class: 'swatch', style: `background:var(${se.color})` }),
        h('span', { class: 'tip-name' }, se.name), h('b', null, spec.format(se.values[at], k, at)))));
    tip.hidden = false;
    const left = x(at) + 14 + tip.offsetWidth > width ? x(at) - 14 - tip.offsetWidth : x(at) + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${m.top + 6}px`;
  }
  function hide() {
    at = -1;
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }
  const nearest = (event) => {
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    return n === 1 ? 0 : Math.round(((px - m.left) / innerW) * (n - 1));
  };
  svg.addEventListener('pointermove', (e) => show(nearest(e)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      show(at < 0 ? n - 1 : at + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Escape') hide();
  });
  put(plot, svg);
  tip.hidden = true;
}

function twin(spec) {
  const n = spec.series[0].values.length;
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    rows.push(h('tr', null, h('td', null, spec.xLabel(i)), spec.series.map((se, k) => h('td', { class: 'num' }, spec.format(se.values[i], k, i)))));
  }
  return h('details', { class: 'twin' }, h('summary', null, 'Show these numbers as a table'),
    h('div', { class: 'scroll twin-scroll', tabindex: '0', role: 'region', 'aria-label': `${spec.title}, as a table` },
      h('table', null, h('caption', { class: 'sr' }, spec.title),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, spec.xName),
          spec.series.map((se) => h('th', { scope: 'col', class: 'num' }, se.name)))),
        h('tbody', null, rows))));
}

/**
 * Draws (or redraws) a chart inside `box`.
 * spec: { title, xName, series: [{ name, color: '--css-var', values: number[] }],
 *         xTick(i), xLabel(i), format(value, seriesIndex, i), zero: start the axis at zero }
 */
export function lineChart(box, spec) {
  const wasOpen = box.querySelector('details.twin') ? box.querySelector('details.twin').open : false;
  box.chartSpec = spec;
  box.classList.add('chart');
  const table = twin(spec);
  table.open = wasOpen;
  put(box,
    h('div', { class: 'legend' }, spec.series.map((se) =>
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: `background:var(${se.color})` }), se.name))),
    h('div', { class: 'chart-area' }, h('div', { class: 'chart-plot' }), h('div', { class: 'chart-tip', hidden: true, role: 'status' })),
    table);
  draw(box);
  if (!box.chartWatch) {
    let width = box.clientWidth;
    box.chartWatch = new ResizeObserver(() => {
      if (box.clientWidth === width || !box.chartSpec) return;
      width = box.clientWidth;
      draw(box);
    });
    box.chartWatch.observe(box);
  }
}
