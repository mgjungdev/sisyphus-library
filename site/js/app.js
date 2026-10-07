import { renderLibrary } from './library.js';
import { renderReader, relationMarks, relationCard, appendixOf, glossMarks, glossCard } from './reader.js';
import { renderSettings } from './pages.js';
import { renderAuthor } from './author.js';
import { loadGraph } from './catalog.js';
import { openNote } from './card.js';
import { renderGraph, ensureEngine } from './graph.js';
import { liftShelves, landShelves } from './transit.js';
import { renderPair, readingById, slugsOf } from './pair.js';

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

// Shelves ⇄ graph. The books fly between their places on the shelves and their nodes on the map (transit.js); the
// rest of the view being left is held on screen in a fixed layer while it fades (the spines that stay go one after
// another, left to right; the map as one), and the rest of the view coming in fades in with it. Under reduced motion
// both views simply crossfade.
const PAIR = new Set(['library', 'graph']);
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sweep = el => Math.max(0, Math.min(el.getBoundingClientRect().left / innerWidth, 1)) * 180;
// The month sections on screen, and the spines in them with their delays, all measured before any starts to move:
// one layout for the page, not one per book. Spines off screen are not animated at all.
const onScreen = r => r.bottom > 0 && r.top < innerHeight;
function swept(root) {
  const secs = [...root.querySelectorAll('.library > section')].map(el => [el, el.getBoundingClientRect()]);
  const books = secs.filter(([, r]) => onScreen(r)).flatMap(([el]) => [...el.querySelectorAll('.book')]).map(el => [el, sweep(el)]);
  return { secs, books };
}
// While books fly, the month sections off screen keep their measured size but are not drawn: every spine is a
// compositor layer, and the page has hundreds. Returns the function that brings them back.
function hush(root, secs = swept(root).secs) {
  const off = secs.filter(([, r]) => !onScreen(r));
  off.forEach(([el, r]) => { el.style.containIntrinsicSize = `${r.width}px ${r.height}px`; el.style.contentVisibility = 'hidden'; });
  return () => off.forEach(([el]) => { el.style.contentVisibility = ''; el.style.containIntrinsicSize = ''; });
}
const crossing = (from, to) => from !== to && PAIR.has(from) && PAIR.has(to);
let transit = null; // books in the air

// after: run once the layer is gone (the map keeps drawing under its departing books until then).
function leave(from, after = null) {
  if (!view.firstChild) { after?.(); return; }
  const layer = document.createElement('div');
  layer.className = `view-leave from-${from}`;
  let books = [];
  if (from === 'library') {
    layer.style.top = `${view.getBoundingClientRect().top}px`;
    // The month sections off screen are not laid out again in the layer: they keep their measured size, empty.
    const w = swept(view);
    hush(view, w.secs);
    books = w.books;
  }
  layer.append(...view.childNodes);
  document.body.append(layer);
  let done;
  if (calm()) {
    done = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-in-out', fill: 'forwards' });
  } else if (from === 'library') {
    books.forEach(([el, delay]) => el.animate([{ opacity: 1 }, { opacity: 0, translate: '0 -8px' }],
      { duration: 280, delay, easing: 'ease-in', fill: 'forwards' }));
    done = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 220, easing: 'ease-in', fill: 'forwards' });
  } else { // the books leave from where they are drawn, so the map fades without moving
    done = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 120, easing: 'ease-in', fill: 'forwards' });
  }
  // The shelves left behind are a large tree: taking it down mid-flight costs a frame, so it waits, unseen, until the
  // books have landed.
  done.finished.finally(() => {
    if (from === 'library' && !calm()) { layer.style.visibility = 'hidden'; setTimeout(() => layer.remove(), 650); } else layer.remove();
    after?.();
  });
}
function arriveShelves() {
  if (calm()) { view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-in-out', fill: 'backwards' }); return; }
  const { secs, books } = swept(view);
  books.forEach(([el, d]) => el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }],
    { duration: 460, delay: 160 + d, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
  const near = secs.filter(([, r]) => onScreen(r)).map(([el]) => el);
  [view.querySelector('.tagbar'), ...near.flatMap(el => [...el.querySelectorAll('.month-head')])].filter(Boolean)
    .forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 200, easing: 'ease-out', fill: 'backwards' }));
}

// The top bar: the switch's thumb sits on the view on screen; the settings icon lights on its page.
const viewSwitch = document.querySelector('.view-switch');
function markNav(name) {
  viewSwitch.dataset.on = PAIR.has(name) ? name : '';
  document.querySelectorAll('.topbar-actions [data-nav]').forEach(a =>
    a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
}

const ROUTES = new Set(['read', 'pair', 'graph', 'author', 'settings']);

async function route() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0]?.startsWith('shelf-')) return; // in-page anchors
  transit?.cancel(); transit = null;
  const from = document.body.dataset.view;
  let name = ROUTES.has(parts[0]) ? parts[0] : 'library';
  if ((name === 'read' || name === 'pair' || name === 'author') && !parts[1]) name = 'library';
  const screen = name === 'read' ? 'reader' : name;
  const cross = crossing(from, screen), fly = cross && !calm();
  // Going to the map, the spines on screen lift off before the shelves go; leaving it, the map stays alive (in the
  // layer) until its books have left it.
  const lifted = fly && from === 'library' ? (transit = liftShelves(view)) : null;
  const map = fly && from === 'graph' ? view.querySelector('.graph-stage')?.flight : null;
  const late = map ? cleanup : null;
  if (!map) cleanup?.();
  cleanup = null;
  if (cross) leave(from, late);
  document.body.dataset.view = screen;
  markNav(screen);
  titleEl.textContent = '';
  try {
    if (name === 'read') {
      const book = await loadBook(parts[1]);
      titleEl.textContent = book.title;
      document.title = `${book.title} · Sisyphus Library`;
      const G = await loadGraph();
      const marks = glossMarks(G, parts[1]);
      const rels = relationMarks(G, parts[1]);
      const relById = new Map();
      rels.forEach((list, para) => list.forEach(x => {
        relById.set(x.rel.id, x.rel);
        marks.set(para, [...(marks.get(para) || []), x]);
      }));
      const open = (anchor, kind, id) => openNote({ anchor, ...(kind === 'rel' ? relationCard(G, relById.get(id)) : glossCard(G, G.glosses.get(id))) });
      const notes = marks.size ? { marks, open } : null;
      const node = G.nodes.get(G.slugs[parts[1]]);
      const graph = node?.slugs?.includes(parts[1]) ? `#/graph/${parts[1]}` : null;
      const writer = node && G.nodes.get(G.authorLinks.find(l => l.from === node.id)?.to);
      const author = writer?.doc ? `#/author/${writer.slug}` : null;
      cleanup = renderReader(view, book, parts[2] ? +parts[2] : null, notes, appendixOf(G, parts[1]), graph, author);
    } else if (name === 'pair') {
      const G = await loadGraph();
      const r = readingById(G, decodeURIComponent(parts[1]));
      if (!r) throw new Error(`no reading ${parts[1]}`);
      const [from, to] = await Promise.all(['from', 'to'].map(s => Promise.all(slugsOf(r, s).map(loadBook))));
      document.title = `${from[0].title} · ${to[0].title} · Sisyphus Library`;
      cleanup = renderPair(view, G, r, { from, to }, parts[2] ? +parts[2] : 1);
    } else if (name === 'author') {
      const doc = await getJSON(`data/authors/${encodeURIComponent(parts[1])}.json`);
      titleEl.textContent = doc.name;
      document.title = `${doc.name} · Sisyphus Library`;
      cleanup = renderAuthor(view, doc);
    } else if (name === 'graph') {
      document.title = 'Relations · Sisyphus Library';
      const [G, lib] = await Promise.all([loadGraph(), loadLibrary(), ensureEngine()]);
      cleanup = renderGraph(view, G, { go, lib, focus: parts[1] ? decodeURIComponent(parts[1]) : null, arrive: lifted });
      if (cross && calm()) view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-in-out', fill: 'backwards' });
    } else if (name === 'settings') {
      document.title = 'Settings · Sisyphus Library';
      scrollTo(0, 0);
      cleanup = renderSettings(view);
    } else {
      document.title = 'Sisyphus Library';
      cleanup = renderLibrary(view, await loadLibrary(), { go });
      if (cross) arriveShelves();
      // The map's engine is a large script: read it while the shelves sit idle, so the switch to the map is quick.
      (window.requestIdleCallback || setTimeout)(() => { ensureEngine(); loadGraph(); }, { timeout: 5000 });
      // Once the shelves are scrolled to where the reader left them, the books on screen fly out of the map.
      if (map) requestAnimationFrame(() => {
        if (document.body.dataset.view !== 'library' || transit) return;
        transit = landShelves(view, map, hush(view));
        transit.flown.forEach(el => el.getAnimations().forEach(a => a.cancel()));
      });
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
