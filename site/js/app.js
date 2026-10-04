import { renderLibrary } from './library.js';
import { renderReader } from './reader.js';
import { renderSettings } from './pages.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('topbar-title');
let cleanup = null;
let library = null;
const books = new Map();

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
const loadLibrary = async () => (library ||= await getJSON('data/library.json'));
async function loadBook(slug) {
  if (!books.has(slug)) books.set(slug, getJSON(`data/books/${slug}.json`));
  return books.get(slug);
}

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

async function route() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0]?.startsWith('shelf-')) return; // in-page anchors
  cleanup?.(); cleanup = null;
  const name = parts[0] || 'library';
  document.body.dataset.view = name === 'read' ? 'reader' : name;
  document.querySelectorAll('.topbar-actions a').forEach(a => a.removeAttribute('aria-current'));
  titleEl.textContent = '';
  try {
    if (name === 'read' && parts[1]) {
      const book = await loadBook(parts[1]);
      titleEl.textContent = book.title;
      document.title = `${book.title} · Sisyphus Library`;
      cleanup = renderReader(view, book, parts[2] ? +parts[2] : null);
    } else if (name === 'settings') {
      document.querySelector('.topbar-actions a[href="#/settings"]').setAttribute('aria-current', 'page');
      document.title = 'Settings · Sisyphus Library';
      scrollTo(0, 0);
      cleanup = renderSettings(view);
    } else {
      document.body.dataset.view = 'library';
      document.title = 'Sisyphus Library';
      cleanup = renderLibrary(view, await loadLibrary(), { go });
    }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<section class="page"><h1>Not found</h1><p><a class="btn" href="#/">Back to the shelves</a></p></section>`;
  }
}

addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // A new worker replacing an old one means a deploy: reload once so the page runs the new code and data.
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
