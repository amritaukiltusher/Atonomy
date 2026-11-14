import './styles.css';
import { ATTRIBUTION } from './anatomy.js';
import { Atlas } from './atlas.js';

const $ = (id) => document.getElementById(id);
$('about-credit').textContent = ATTRIBUTION;
$('footer-credit').textContent = ATTRIBUTION;

const atlas = new Atlas();
let live = null;

async function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'atlas') { atlas.start(); } else { atlas.stop(); }
  if (name === 'live') {
    if (!live) { const { LiveScan } = await import('./live/live.js'); live = new LiveScan(); window.__live = live; }
    live.onShow();
  } else if (live) {
    live.onHide();
  }
  history.replaceState(null, '', `#${name}`);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

atlas.start();
atlas.load('male');
const initial = location.hash.replace('#', '');
if (['live', 'about'].includes(initial)) showTab(initial);

window.__atlas = atlas; // handy for debugging in the console
