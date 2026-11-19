import './styles.css';
import { ATTRIBUTION } from './anatomy.js';
import { Atlas } from './atlas.js';

const $ = (id) => document.getElementById(id);
$('about-credit').textContent = ATTRIBUTION;
$('footer-credit').textContent = ATTRIBUTION;

const TABS = ['atlas', 'live', 'about'];
const atlas = new Atlas();
let live = null;
let nav = 0;

const tabFromHash = () => { const h = location.hash.replace('#', ''); return TABS.includes(h) ? h : 'atlas'; };

async function showTab(name) {
  const mine = ++nav;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll('.tabs button').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
  });
  document.title = { atlas: 'AnatomyLive — 3D Atlas', live: 'AnatomyLive — Live Scan', about: 'AnatomyLive — About' }[name];
  if (name === 'atlas') atlas.start(); else atlas.stop();
  if (name === 'live') {
    if (!live) { const { LiveScan } = await import('./live/live.js'); if (mine !== nav) return; live = new LiveScan(); window.__live = live; }
    live.onShow();
  } else if (live) {
    live.onHide();
  }
}

// Tabs are real history entries, so the browser's Back / Forward buttons switch tabs.
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  if (location.hash.replace('#', '') === b.dataset.tab) showTab(b.dataset.tab);
  else location.hash = b.dataset.tab;
});
window.addEventListener('hashchange', () => showTab(tabFromHash()));

atlas.start();
atlas.load('male');
if (tabFromHash() !== 'atlas') showTab(tabFromHash());

window.__atlas = atlas; // handy for debugging in the console

// Offline support: cache the app, models and tracking files after the first visit.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
