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
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ── Install button: native prompt on Chrome/Edge/Android, instructions on iPhone/iPad Safari ──
{
  const btn = $('btn-install'), help = $('install-help');
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone()) btn.hidden = false; });
  window.addEventListener('appinstalled', () => { deferred = null; btn.hidden = true; });
  if (isIOS && !standalone()) btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null; btn.hidden = true;
    } else {
      $('install-help-text').innerHTML = isIOS
        ? 'Tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.<br><span class="bn">Safari-তে <b>Share</b> চাপুন, তারপর <b>Add to Home Screen</b>।</span>'
        : 'Open your browser menu and choose <b>Install app</b> / <b>Add to Home screen</b>.<br><span class="bn">ব্রাউজারের মেনু থেকে <b>Install app</b> / <b>Add to Home screen</b> বেছে নিন।</span>';
      help.hidden = false;
    }
  });
  $('install-close').addEventListener('click', () => { help.hidden = true; });
  help.addEventListener('click', (e) => { if (e.target === help) help.hidden = true; });
}
