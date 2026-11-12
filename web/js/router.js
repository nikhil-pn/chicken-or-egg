// The views: #/ Play (the default), #/how, #/scouts, #/stats, #/proof. And the phone menu sheet.
import { $ } from './dom.js';
import { sticker } from './stickers.js';

const VIEWS = ['play', 'how', 'scouts', 'stats', 'proof'];
const TITLES = { play: 'Chicken or Egg', how: 'How it works', scouts: 'The scouts', stats: 'Stats', proof: 'On chain' };

let shown = null;

/** The view the address asks for; null for a plain anchor such as #main (the view stays as it is). */
function wanted() {
  if (!location.hash || location.hash === '#') return 'play';
  const m = location.hash.match(/^#\/([a-z]*)/);
  if (!m) return null;
  return VIEWS.includes(m[1]) ? m[1] : 'play';
}

function show(name, byUser) {
  if (name === shown) return;
  shown = name;
  for (const view of document.querySelectorAll('[data-view]')) view.hidden = view.dataset.view !== name;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = name === 'play' ? TITLES.play : `${TITLES[name]} · Chicken or Egg`;
  if (byUser) {
    window.scrollTo({ top: 0 });
    const heading = document.querySelector(`[data-view="${name}"] h1, [data-view="${name}"] h2`);
    if (heading) heading.focus({ preventScroll: true });
  }
}

export function startRouter() {
  for (const link of document.querySelectorAll('.sheet-links a[data-sticker]')) {
    link.prepend(sticker(link.dataset.sticker, { size: 'sm', tilt: -6 }));
  }
  const menu = $('menu');
  $('menu-open').addEventListener('click', () => menu.showModal());
  $('menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) { menu.close(); return; }
    if (event.target !== menu) return;
    const box = menu.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) menu.close(); // a tap on the backdrop
  });
  window.addEventListener('hashchange', () => {
    const name = wanted();
    if (name) show(name, true);
  });
  show(wanted() || 'play', false);
}
