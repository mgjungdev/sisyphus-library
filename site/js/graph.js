// Graph view (#/graph): every readable book is a node. Relations (notes) are the strong lines: style = contact, weight
// = case of the lead reading, colour = kind, particles and arrowheads run from the older work to the newer. Each author is a node too,
// a small medal with its name, tied to its books by hairlines that draw them into one cluster; genre and shelf heading
// only pull books together, with no line drawn.
// Two engines draw it: graph3d.js (3d-force-graph, books as boxes in space; the default) and graph2d.js (force-graph
// on a canvas; when there is no WebGL, or the reader picks 2D). This file holds what they share: the controls, the
// tooltip and popover, the book panel, filters, search, focus and the shelves ⇄ map flight.
import { esc } from './art.js';
import { readingsOf, authorOf, yearOf, isDrafts, locHref, displayName, RELATION_KINDS, CONTACT_KINDS, CASE_KINDS, relKind, relationSentence, plainTitle, relColour } from './catalog.js';
import { pullOut, dropFlight } from './library.js';
import { make2D } from './graph2d.js';
import { make3D } from './graph3d.js';
import { pairHref } from './pair.js';

export const CASE_W = { strong: 3.4, moderate: 2.4, speculative: 1.4 };
// Neighbouring regions share a border: Gothic sits between ghosts and science fiction.
export const GENRES = ['Gothic & Horror', 'Science Fiction & Fantasy', 'Adventure', 'Mystery & Detective', 'Humor & Satire',
  'Fairy Tales & Fables', 'Love & Society', 'Realism & Character', 'Ghost Stories'];
// Filters outlive the view, so they are still set on the way back from a book. An empty set means all.
const filters = { rels: new Set(), genres: new Set(), year: null };

/* ---------- which engine: 3D unless there is no WebGL, the reader chose 2D, or ?view=2d ---------- */
const MODE_KEY = 'sl.graph.view';
// The key starts folded, so the map is framed on the whole stage; once opened it stays open.
const KEY_OPEN = 'sl.graph.key';
const keyOpen = () => { try { return localStorage.getItem(KEY_OPEN) === '1'; } catch { return false; } };
// Opening a WebGL context only to test for one costs a tenth of a second: trust the API being there, and fall back
// to 2D if the 3D engine then cannot get a context (failed3D).
const hasWebGL = () => !!(window.WebGL2RenderingContext || window.WebGLRenderingContext);
function wantedMode() {
  let m = new URLSearchParams(location.search).get('view');
  if (m !== '2d' && m !== '3d') { try { m = localStorage.getItem(MODE_KEY); } catch { m = null; } }
  return m === '2d' || !hasWebGL() ? '2d' : '3d';
}
let loading3D = null, failed3D = false;
const script = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = rej;
  document.head.append(s);
});
// The engine script for the mode the map will be drawn in: the 3D bundle is large, so it loads only when wanted.
export async function ensureEngine(mode = wantedMode()) {
  if (mode === '3d' && !failed3D) {
    try { await (loading3D ||= window.ForceGraph3D ? Promise.resolve() : script('vendor/3d-force-graph.min.js')); return '3d'; }
    catch { failed3D = true; loading3D = null; }
  }
  if (!window.ForceGraph) await new Promise(res => addEventListener('DOMContentLoaded', res, { once: true }));
  return '2d';
}
const engineMode = () => (wantedMode() === '3d' && window.ForceGraph3D && !failed3D ? '3d' : '2d');

/* ---------- which layout: the web of forces, or a timeline (?layout=timeline); the reader's choice is kept ---------- */
const LAYOUT_KEY = 'sl.graph.layout';
function wantedLayout() {
  let m = new URLSearchParams(location.search).get('layout');
  if (m !== 'web' && m !== 'timeline') { try { m = localStorage.getItem(LAYOUT_KEY); } catch { m = null; } }
  return m === 'timeline' ? 'timeline' : 'web';
}

// The timeline: x is the year a book came out, a lane for each genre (in the order of the map's regions) across it.
// Years from 1700 on are to scale; the few older ones (a fable, the Nights) stand in slots of their own left of a
// break. A relation's older book is always left of its newer one, so its particles run left to right. Within a lane
// the books step up and down out of one another's way. Positions are in map units with y down; the 3D engine turns
// them over (yUp).
export const PER_YEAR = 6.5;
const EARLY = 1700, SLOT = 58;
function timelineOf(nodes, relLinks, yUp) {
  const books = nodes.filter(n => !n.isA);
  const late = books.map(n => n.year).filter(y => y >= EARLY);
  const y0 = Math.floor(Math.min(...late, 1800) / 10) * 10, y1 = Math.ceil(Math.max(...late, 1800) / 10) * 10;
  const early = [...new Set(books.map(n => n.year).filter(y => y && y < EARLY))].sort((a, b) => a - b);
  const undated = books.some(n => !n.year);
  const X = y => (!y ? (y1 - y0) * PER_YEAR + SLOT : y >= EARLY ? (y - y0) * PER_YEAR : -(early.length - early.indexOf(y)) * SLOT - 12);
  // Lanes, a little taller for a genre of many books.
  const names = [...GENRES.filter(g => books.some(n => n.genre === g)), ...(books.some(n => !GENRES.includes(n.genre)) ? [null] : [])];
  let top = 0;
  const lanes = names.map(g => {
    const k = books.filter(n => (g ? n.genre === g : !GENRES.includes(n.genre))).length;
    const h = Math.round(40 + 11 * Math.sqrt(k)), L = { name: g || 'Other', genre: g, y0: top, y1: top + h };
    top += h;
    return L;
  });
  const laneOf = g => lanes.find(L => L.genre === g) || lanes[lanes.length - 1];
  // A steady scatter from the id, so the same map comes out every time.
  const jit = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000 - 0.5; };
  const P = nodes.map(n => {
    const L = laneOf(n.isA ? n.home : n.genre);
    const tx = n.isA ? n.books.reduce((a, b) => a + X(b.year), 0) / n.books.length : X(n.year);
    const ty = (L.y0 + L.y1) / 2;
    const rx = n.isA ? n.h / 2 + 5 : n.deg ? Math.max(n.w / 2, 12) + 4 : n.w / 2 + 2;
    const ry = n.isA ? n.h / 2 + 7 : n.h / 2 + (n.deg ? 9 : 2);
    return { n, L, tx, ty, rx, ry, x: tx + jit(n.id) * 4, y: ty + jit(`${n.id}~`) * (L.y1 - L.y0) * 0.6 };
  });
  const at = new Map(P.map(p => [p.n, p]));
  const pairs = relLinks.map(l => [at.get(l.source), at.get(l.target)]);
  const wide = Math.max(...P.map(p => p.rx)) * 2;
  for (let it = 0; it < 180; it++) {
    P.forEach(p => { p.x += (p.tx - p.x) * 0.22; p.y += (p.ty - p.y) * 0.02; });
    P.sort((a, b) => a.x - b.x);
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      for (let j = i + 1; j < P.length && P[j].x - a.x < wide; j++) {
        const b = P[j], dx = b.x - a.x, dy = b.y - a.y;
        const ox = a.rx + b.rx - Math.abs(dx), oy = a.ry + b.ry - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        // Out of each other's way up and down rather than across, which would move a book off its year.
        if (oy < ox * 2.5) { const s = (dy || jit(a.n.id + b.n.id)) >= 0 ? oy * 0.3 : -oy * 0.3; a.y -= s; b.y += s; }
        else { const s = dx >= 0 ? ox * 0.3 : -ox * 0.3; a.x -= s; b.x += s; }
      }
    }
    pairs.forEach(([s, t]) => { const d = s.x + 8 - t.x; if (d > 0) { s.x -= d / 2; t.x += d / 2; } });
    P.forEach(p => {
      const lo = p.L.y0 + p.ry, hi = p.L.y1 - p.ry;
      p.y = lo < hi ? Math.max(lo, Math.min(hi, p.y)) : (p.L.y0 + p.L.y1) / 2;
    });
  }
  // The axis: a tick each decade (every fifty years a major one), one for each older year, and the lanes.
  const x0 = Math.min(...P.map(p => p.x - p.rx), X(y0)) - 14, x1 = Math.max(...P.map(p => p.x + p.rx), X(y1)) + 14;
  const cx = (x0 + x1) / 2, cy = top / 2, sy = yUp ? -1 : 1;
  const ticks = [];
  for (let y = y0; y <= y1; y += 10) ticks.push({ x: X(y) - cx, label: `${y}`, major: y % 50 === 0 });
  early.forEach(y => ticks.push({ x: X(y) - cx, label: y < 0 ? `${-y} BC` : `${y}`, major: true, early: true }));
  if (undated) ticks.push({ x: X(0) - cx, label: 'n.d.', major: true, early: true });
  const pos = new Map(P.map(p => [p.n, { x: p.x - cx, y: (p.y - cy) * sy, z: 0 }]));
  return {
    pos,
    axis: { x0: x0 - cx, x1: x1 - cx, top: -cy, bottom: cy, ticks, brk: early.length ? X(y0) - cx - SLOT / 2 - 6 : null,
      lanes: lanes.map(L => ({ name: L.name, y0: L.y0 - cy, y1: L.y1 - cy })) },
  };
}

export function renderGraph(root, G, opts) {
  let inner = null, gone = false;
  const draw = (mode, o) => { inner = drawGraph(root, G, { ...o, mode, switchTo }); };
  // The 2D | 3D switch: remember the choice and draw the map again, on the book in focus.
  async function switchTo(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* private mode: this visit only */ }
    const got = await ensureEngine(mode);
    if (gone || !root.isConnected) return;
    const focus = /^#\/graph\/(.+)/.exec(location.hash)?.[1];
    inner?.();
    draw(got, { ...opts, focus: focus ? decodeURIComponent(focus) : null, arrive: null });
  }
  draw(engineMode(), opts);
  return () => { gone = true; inner?.(); };
}

function drawGraph(root, G, { go, lib, focus = null, arrive = null, mode, switchTo }) {
  const books = G.books;
  const byId = new Map();
  // Related books first: they are drawn, and claim their title space, before the rest.
  const nodes = [...books].sort((a, b) => (b.degree || 0) - (a.degree || 0)).map(b => {
    const n = { id: b.id, b, deg: b.degree || 0, year: +yearOf(b) || 0, genre: b.genre, heads: [], a: 1, s: 1 };
    byId.set(n.id, n);
    return n;
  });
  const bookNodes = [...nodes];
  G.edges.filter(e => e.type === 'index' && byId.has(e.from)).forEach(e => byId.get(e.from).heads.push(e.to));
  // Authors: a node each, holding its books (n.books) and, for the forces, the genre most of them are in (n.home).
  G.authors.forEach(p => {
    const bs = p.works.map(id => byId.get(id)).filter(Boolean);
    if (!bs.length) return;
    const count = new Map();
    bs.forEach(b => count.set(b.genre, (count.get(b.genre) || 0) + 1));
    const home = [...count].sort((a, b) => b[1] - a[1])[0][0];
    const n = { id: p.id, isA: true, p, name: p.byline || displayName(p.name), slug: p.slug, ini: initials(p.byline || displayName(p.name)), books: bs, home, deg: 0, year: 0,
      heads: [], a: 1, s: 1, b: { title: p.byline || displayName(p.name), slugs: [] } };
    // Books in another genre stay in that genre's region, gathered there into one small group (the shelf-heading pull).
    bs.forEach(b => { b.author = n; if (b.genre !== home && !b.deg) b.heads.push(`${p.id}|${b.genre}`); });
    byId.set(n.id, n); nodes.push(n);
  });
  const authorNodes = nodes.filter(n => n.isA);
  const lifeOf = a => (a.p.born || a.p.died ? `${a.p.born || '?'}–${a.p.died || ''}` : '');

  // Relation lines run from the older work (the note's to) to the newer one (its from), so particles and arrows carry
  // influence forward in time, while the sentence reads back: 'the newer book answers the older'.
  const relLinks = G.notes.filter(n => byId.has(n.from) && byId.has(n.to)).map(n => {
    // The lead reading first, then any others, then the readings that dispute it.
    const rs = [...readingsOf(G, n)].sort((a, b) => !!a.disputes - !!b.disputes);
    const lead = rs[0];
    let [s, t] = [byId.get(n.to), byId.get(n.from)];
    if (s.year && t.year && s.year > t.year) [s, t] = [t, s];
    return { kind: 'rel', note: n, source: s, target: t, rel: n.rel, contact: n.contact || 'none', case: lead?.case, claim: lead?.claim, readings: rs };
  });
  // Book -> its author: a hairline, and the pull that keeps an author's books together.
  const authorLinks = (G.authorLinks || []).filter(l => byId.has(l.from) && byId.get(l.to)?.isA)
    .map(l => ({ kind: 'author', source: byId.get(l.from), target: byId.get(l.to) }));
  const links = [...authorLinks, ...relLinks];
  const nbrs = new Map(nodes.map(n => [n, new Set()]));
  links.forEach(l => { nbrs.get(l.source).add(l.target); nbrs.get(l.target).add(l.source); });

  const order = Object.keys(RELATION_KINDS), rank = r => (order.includes(r) ? order.indexOf(r) : 9);
  const rels = [...new Set(relLinks.map(l => l.rel))].sort((a, b) => rank(a) - rank(b));
  const relLabel = r => relKind(r).name;
  const genres = GENRES.filter(g => nodes.some(n => n.genre === g));
  // The slider steps through the years books came out in, so a lone ancient fable does not stretch it.
  const years = [...new Set(nodes.map(n => n.year).filter(Boolean))].sort((a, b) => a - b);
  [...filters.rels].forEach(r => rels.includes(r) || filters.rels.delete(r));
  [...filters.genres].forEach(g => genres.includes(g) || filters.genres.delete(g));
  if (filters.year != null && !years.length) filters.year = null;
  const yearText = y => (y < 0 ? `${-y} BC` : `${y}`);
  let layout = wantedLayout();
  const chip = (group, v, label, count, dot = '') => `<button type="button" class="gc-chip" data-group="${group}" data-v="${esc(v)}"
    aria-pressed="false">${dot}${esc(label)}<span class="n">${count}</span></button>`;
  const modeBtn = (m, label, off) => `<button type="button" data-mode="${m}" aria-pressed="${m === mode}"${off ? ' disabled title="This browser cannot draw in 3D"' : ''}>${label}</button>`;

  root.innerHTML = `
    <section class="graph-view" data-mode="${mode}" data-layout="${layout}">
      <div class="graph-stage" aria-label="Map of the library: books linked by their relations"></div>
      <div class="graph-top">
        <header class="graph-head">
          <h1>Relations</h1>
          <p><span class="graph-count"></span>${isDrafts() ? ' <span class="graph-draft">with drafts</span>' : ''}</p>
        </header>
        <div class="graph-ctrl">
          <div class="gc-search">
            <input type="search" placeholder="Find a book or author" aria-label="Find a book by title or an author by name" autocomplete="off" spellcheck="false"
              role="combobox" aria-expanded="false" aria-controls="gc-hits" aria-autocomplete="list">
            <ul class="gc-hits" id="gc-hits" role="listbox" aria-label="Books and authors" hidden></ul>
          </div>
          <button type="button" class="gc-toggle" aria-expanded="false" aria-controls="gc-panel">Filter<span class="gc-badge" hidden></span></button>
          <div class="gc-mode" role="group" aria-label="Map in two or three dimensions">${modeBtn('2d', '2D')}${modeBtn('3d', '3D', !hasWebGL() || failed3D)}</div>
          <div class="gc-panel" id="gc-panel" hidden>
            ${rels.length ? `<fieldset><legend>Relations</legend><div class="gc-chips">${rels.map(r => chip('rel', r, relLabel(r),
              relLinks.filter(l => l.rel === r).length, `<i class="gc-dot" data-rel="${esc(r)}"></i>`)).join('')}</div></fieldset>` : ''}
            <fieldset><legend>Genres</legend><div class="gc-chips">${genres.map(g => chip('genre', g, g,
              nodes.filter(n => n.genre === g).length)).join('')}</div></fieldset>
            ${years.length > 1 ? `<fieldset class="gc-year"><legend>Published by <output></output></legend>
              <input type="range" min="0" max="${years.length - 1}" step="1" aria-label="Published by">
              <p><span>${yearText(years[0])}</span><span>${yearText(years[years.length - 1])}</span></p></fieldset>` : ''}
            <button type="button" class="gc-clear">Clear filters</button>
          </div>
        </div>
      </div>
      <details class="graph-key"${keyOpen() ? ' open' : ''}>
        <summary>Key</summary>
        <div class="key-body">
          <h3>Relations</h3>
          <ul>${(rels.length ? rels : order.filter(r => !['refers', 'read'].includes(r))).map(r => `
            <li><i class="key-line" data-rel="${esc(r)}"></i><span><b>${esc(relLabel(r))}</b> ${esc(relKind(r).def)}</span></li>`).join('')}
          </ul>
          <h3>Direction</h3>
          <ul><li><i class="key-arrow"></i><span>Arrows and moving dots carry influence forward, from the older book to the newer.
            On the timeline they run left to right. Sentences read back from the newer: <i>Rappaccini's Daughter</i> answers <i>Frankenstein</i>.</span></li></ul>
          <h3>Contact</h3>
          <ul>${Object.entries(CONTACT_KINDS).map(([c, k]) => `
            <li><i class="key-line key-${c}"></i><span><b>${esc(k.name)}</b> ${esc(k.def)}</span></li>`).join('')}
          </ul>
          <h3>Strength of the reading</h3>
          <ul>${Object.entries(CASE_KINDS).map(([c, k]) => `
            <li><i class="key-line key-case" style="border-top-width:${CASE_W[c]}px"></i><span><b>${esc(k.name)}</b> ${esc(k.def)}</span></li>`).join('')}
          </ul>
          <ul class="key-last"><li><i class="key-medal"></i><span>An author, tied to its books</span></li></ul>
        </div>
      </details>
      <div class="graph-layout" role="group" aria-label="Arrange the map">
        <button type="button" data-layout="web" aria-pressed="${layout === 'web'}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6l9-2M5 6l2 9M14 4l-7 11M14 4l2 9M7 15l9-2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="6" r="2"/><circle cx="14" cy="4" r="2"/><circle cx="7" cy="15" r="2"/><circle cx="16" cy="13" r="2"/></svg>Web</button>
        <button type="button" data-layout="timeline" aria-pressed="${layout === 'timeline'}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 16h16M4 14.5v3M10 14.5v3M16 14.5v3" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="9" r="2"/><circle cx="10" cy="5" r="2"/><circle cx="15" cy="10" r="2"/><path d="M6.6 7.6l1.8-1.2M11.8 6.4l1.6 2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>Timeline</button>
      </div>
      <div class="graph-tip" role="tooltip" hidden></div>
      <div class="graph-pop" role="dialog" aria-label="Relation" hidden></div>
      <section class="graph-author" role="dialog" aria-labelledby="ga-name" hidden></section>
      <div class="graph-standin" aria-hidden="true"></div>
    </section>`;
  const view = root.querySelector('.graph-view');
  const stage = root.querySelector('.graph-stage');
  const tip = root.querySelector('.graph-tip');
  const standin = root.querySelector('.graph-standin');
  const pop = root.querySelector('.graph-pop');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- node size: a book whose height grows with its relations ---------- */
  nodes.forEach(n => {
    if (n.isA) { // a medal, a little larger for an author of many books; room around it for the name
      n.h = n.w = 8.5 + 1.6 * Math.sqrt(n.books.length);
      n.r = n.h * 0.5 + 9;
      return;
    }
    n.h = (n.deg ? 21 + 9 * Math.sqrt(n.deg) : 11.5) * (n.b.spine?.height || 0.9);
    n.w = n.h * 0.31;
    n.r = n.h * 0.56 + (n.deg ? 34 : 2); // related books keep room for their titles
  });

  /* ---------- hover state ---------- */
  let hoverNode = null, hoverLink = null, popLink = null, pin = null; // pin: the book found or named in the URL
  const lit = new Set();
  const litLinks = new Set();
  function setFocus(node, link) {
    const over = node || link;
    hoverNode = node; hoverLink = popLink || link;
    lit.clear(); litLinks.clear();
    const n = node || (link ? null : pin); // a found book stays lit while the pointer is elsewhere
    if (popLink) { // an open popover keeps its line lit; a book under the pointer only lights itself
      lit.add(popLink.source); lit.add(popLink.target); litLinks.add(popLink);
      if (node) lit.add(node);
    } else if (n) {
      lit.add(n); nbrs.get(n).forEach(m => lit.add(m));
      links.forEach(l => { if (l.source === n || l.target === n) litLinks.add(l); });
    } else if (link) { lit.add(link.source); lit.add(link.target); litLinks.add(link); }
    stage.style.cursor = over && over !== popLink ? 'pointer' : '';
  }
  // How bright a book is drawn when nothing is lit: a relation filter leaves only the books on its lines bright.
  const restAlpha = n => (filters.rels.size && !n.relOn ? 0.16 : n.deg || n.isA ? 1 : env.C.dark ? 0.78 : 0.62);

  /* ---------- the engine ---------- */
  let touched = false, user = false; // touched: the camera has been moved on purpose; user: by the reader's hand
  let outNode = null;
  const env = {
    stage, view, root, nodes, links, relLinks, nbrs, lit, litLinks, filters, restAlpha, freeRect, reduced,
    C: {},
    layout: () => layout,
    // The timeline's axis (y down) and how far the map has gone over to it (0 the web, 1 the timeline).
    timeline: () => (tlMix > 0 && tl ? { axis: tl.axis, mix: tlMix } : null),
    marked: n => n === hoverNode || n === pin,
    hoverNode: () => hoverNode,
    hoverLink: () => hoverLink,
    touched: () => touched,
    outHidden: n => n === outNode && standin.classList.contains('is-out'),
    on: {
      hoverNode(n) {
        if (n && performance.now() < quiet) return; // the camera is moving under a still pointer
        const l = n && !n.deg && !n.isA && ptr && engine.lineAt(ptr); // a book with no relations never hides the line under it
        if (l) { setFocus(null, l); showTip(null, l === popLink ? null : l); return; }
        setFocus(n, null); showTip(n);
      },
      hoverLink(l) { if (!hoverNode) { setFocus(null, l); showTip(null, l === popLink ? null : l); } },
      clickNode(n, ev) {
        if (n.isA) { closePop(); openAuthor(n); return; }
        // A book with no relations that lies on a relation line must not hide the line from the pointer.
        const l = !n.deg && ev && engine.lineAt(ev);
        if (l) { openPop(l); return; }
        closePop(); openNode(n);
      },
      clickLink(l) { l?.kind === 'rel' ? openPop(l) : closePop(); },
      // Nothing the engine knows of under the pointer: look for a book there (the engine may not have caught up with
      // a finger), then for a relation line, which a book with no relations never hides.
      clickBackground(up) {
        const n = up && engine.bookAt(up), l = up && engine.lineAt(up);
        // Under a mouse the click opens what the tooltip names: the line, though a medal's edge is near.
        if (l && up.pointerType === 'mouse' && hoverLink === l && !hoverNode) { openPop(l); return; }
        if (n && (n.deg || n.isA || !l)) { closePop(); n.isA ? openAuthor(n) : openNode(n); return; }
        if (l) { openPop(l); return; }
        closePop(); closeAuthor(); unpin(); setFocus(null, null); tip.hidden = true;
      },
      // The engine has warmed up the web: on a map opened on the timeline, keep the web to go back to and put the
      // books on the timeline before the first frame is drawn.
      placed() {
        if (placedOnce || layout !== 'timeline') { placedOnce = true; return; }
        placedOnce = true;
        nodes.forEach(n => { if (Number.isFinite(n.x)) n.web = { x: n.x, y: n.y, z: n.z || 0 }; });
        if (!nodes.every(n => n.web)) nodes.forEach(n => { delete n.web; });
        nodes.forEach(n => pinTo(n, timeline().pos.get(n)));
      },
      firstFrame: () => enter(),
      frame: () => placePop(),
      // The books drift until the simulation rests: then settle the view once more on what it was showing.
      engineStop() { if (!touched) fit(900); else if (pin && !user) focusOn(pin, 900); },
    },
  };

  /* ---------- theme: colours follow the CSS tokens ---------- */
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = k => cs.getPropertyValue(k).trim();
    const dark = cs.colorScheme === 'dark' || v('color-scheme') === 'dark';
    const C = { dark, bg: v('--bg'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), rule: v('--rule'), font: v('--font-read') || 'serif' };
    C.rel = r => relColour(r, dark);
    env.C = C;
    root.querySelectorAll('i[data-rel]').forEach(el => el.style.setProperty('--c', C.rel(el.dataset.rel)));
    engine?.restyle();
  }
  let engine = null;
  readTheme();
  /* ---------- layout: the web, or the timeline (books held at their places there: fx, fy, fz) ---------- */
  let prep = 0, tl = null, tlMix = layout === 'timeline' ? 1 : 0, tween = 0, tweenAt = 0, placedOnce = false;
  const pinTo = (n, p) => { n.x = n.fx = p.x; n.y = n.fy = p.y; n.z = n.fz = p.z; };
  const timeline = () => (tl ||= timelineOf(nodes, relLinks, mode === '3d'));
  if (mode === '3d') {
    try { engine = make3D(env); } catch (e) {
      console.warn('3D map unavailable, drawing it flat:', e);
      failed3D = true; mode = '2d';
      stage.replaceChildren(); view.dataset.mode = mode;
      root.querySelectorAll('.gc-mode [data-mode]').forEach(b => { b.setAttribute('aria-pressed', b.dataset.mode === mode); b.disabled ||= b.dataset.mode === '3d'; });
    }
  }
  engine ||= make2D(env);
  engine.layout(layout);
  stage.graph = engine.fg; // for tools/graph_qa.py
  stage.mode = mode;
  const mo = new MutationObserver(readTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', readTheme);

  /* ---------- framing ---------- */
  // The part of the stage the title, the controls and the key leave free.
  function freeRect() {
    const W = stage.clientWidth, H = stage.clientHeight, pad = W < 640 ? 22 : 56;
    const box = stage.getBoundingClientRect();
    // Within the view: it may be on its way out, in the crossfade layer, still drawn.
    const bottomOf = sel => view.querySelector(sel).getBoundingClientRect().bottom - box.top;
    const keyEl = view.querySelector('.graph-key'), key = keyEl.getBoundingClientRect();
    let left = pad, right = W - pad, top = Math.max(pad, bottomOf('.graph-head') + 12, bottomOf('.gc-search') + 12), bottom = H - pad;
    // A folded key is a small tab in the bottom corner, inside the margin. An open one covers the bottom left: leave
    // out whichever side of it (its column, or the band above it) costs the map less room.
    if (keyEl.open && key.width < W * 0.45) { // on a phone an open key covers the map: it lies over it instead
      const byLeft = (right - Math.max(left, key.right - box.left + 24)) * (bottom - top);
      const byBottom = (right - left) * (Math.min(bottom, key.top - box.top - 8) - top);
      if (byLeft > byBottom) left = Math.max(left, key.right - box.left + 24);
      else bottom = Math.min(bottom, key.top - box.top - 8);
    }
    const pill = view.querySelector('.graph-layout').getBoundingClientRect(); // Web | Timeline, in the bottom corner
    if (pill.height) bottom = Math.min(bottom, pill.top - box.top - 6);
    if (W >= 900 && !panel.hidden) right = Math.min(right, panel.getBoundingClientRect().left - box.left - 16); // an open filter panel
    if (authorOpen) { // the author panel: on the right, or a sheet along the bottom on phones
      const a = authorEl.getBoundingClientRect();
      if (authorEl.classList.contains('is-sheet')) bottom = Math.min(bottom, a.top - box.top - 8);
      else right = Math.min(right, a.left - box.left - 16);
    }
    return { W, H, left, right, top, bottom };
  }
  const shown = () => { const v = nodes.filter(n => n.vis); return v.length ? v : nodes; };
  const fit = ms => engine.frame(shown(), ms, 2.4); // short of the zoom where every title shows, so a few books do not crowd
  // One entrance, on the first frame that has positions.
  function enter() {
    if (!root.isConnected) return;
    engine.enter({ pin, arrive, reduced: reduced(), fit, focusOn });
    arrive?.take(flight);
    // The timeline worked out ahead, once the map is in and idle (not while books fly in), so the switch starts at once.
    const idle = f => (window.requestIdleCallback || setTimeout)(f, { timeout: 4000 });
    prep = setTimeout(() => idle(() => { if (root.isConnected) { timeline(); idle(() => root.isConnected && engine.prepare(tl.axis)); } }), 2500);
  }

  const stop = () => { touched = user = true; engine.still(); closePanel(); };
  // Opening or folding the key: remember it, and frame the map again unless the reader has moved it.
  let keyWas = keyOpen(); // a key drawn open fires a toggle of its own on the way in
  root.querySelector('.graph-key').addEventListener('toggle', e => {
    if (e.target.open === keyWas) return;
    keyWas = e.target.open;
    try { localStorage.setItem(KEY_OPEN, e.target.open ? '1' : '0'); } catch { /* storage blocked */ }
    if (!touched && !popLink) fit(500);
  });
  stage.addEventListener('pointerdown', stop);
  stage.addEventListener('wheel', stop, { passive: true });

  /* ---------- tooltip ---------- */
  let mouse = { x: 0, y: 0 };
  let ptr = null; // the last pointer position, for the hover handlers that get no event
  const onMove = e => {
    ptr = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
    const r = view.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (!tip.hidden) placeTip();
  };
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerleave', () => { tip.hidden = true; setFocus(null, null); });
  env.pointer = () => ptr;
  function showTip(n, l) {
    // Not while the camera moves under a still pointer, nor under a book out of the map.
    if ((n || l) && (performance.now() < quiet || document.querySelector('#flight-layer .flight-info'))) { tip.hidden = true; return; }
    if (n?.isA) {
      const life = lifeOf(n), k = n.books.length;
      tip.innerHTML = `<b>${esc(n.name)}</b>${life ? `<span>${esc(life)}</span>` : ''}<span class="tip-rel">${k} ${k === 1 ? 'book' : 'books'} in the library</span>`;
    } else if (n) {
      const yr = yearOf(n.b);
      const rel = n.deg ? `<span class="tip-rel">${n.deg} ${n.deg === 1 ? 'relation' : 'relations'}</span>` : '';
      tip.innerHTML = `<b>${esc(n.b.title)}</b><span>${esc(authorOf(G, n.b))}${yr ? `, ${yr}` : ''}</span>${rel}`;
    } else if (l?.kind === 'rel') {
      // Who does what to whom, what that kind of relation is, then the claim of the lead reading on one line.
      tip.innerHTML = `<b class="tip-pair">${pairHTML(l)}</b><span class="tip-def">${defHTML(l)}</span>${l.claim ? `<span class="tip-claim">${esc(l.claim)}</span>` : ''}`;
    } else if (l?.kind === 'author') {
      tip.innerHTML = `<span><i>${esc(shortTitle(l.source.b.title))}</i>, by ${esc(l.target.name)}</span>`;
    } else { tip.hidden = true; return; }
    tip.hidden = false;
    placeTip();
  }
  // 'Rappaccini's Daughter answers Frankenstein': the note's from (newer) does what its kind says to its to (older).
  const pairHTML = l => {
    const x = relationSentence(G, l.note);
    return `<i>${esc(x.from)}</i> <em style="color:${env.C.rel(l.rel)}">${esc(x.verb)}</em> <i>${esc(x.to)}</i>`;
  };
  // The kind's name (with its narrowing word, as 'Rewrites · inversion') and its one-line definition.
  const defHTML = l => {
    const x = relationSentence(G, l.note), m = x.mode && relKind(l.rel).modes?.[x.mode];
    return `<b class="def-k">${esc(x.name)}${x.mode ? `&nbsp;· <span${m ? ` title="${esc(m)}"` : ''}>${esc(x.mode.replace(/-/g, ' '))}</span>` : ''}:</b> ${esc(x.def)}`;
  };
  function placeTip() {
    const vw = view.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = mouse.x + 16, y = mouse.y + 18;
    if (x + tw > vw - 8) x = mouse.x - tw - 12;
    if (y + th > view.clientHeight - 8) y = mouse.y - th - 12;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  /* ---------- line click: a popover beside the line ---------- */
  let popTab = 0, popAt = '', quiet = 0;
  const W = () => stage.clientWidth;
  const narrow = () => W() < 640; // phones: a sheet along the bottom instead
  function passageHTML(loc, work) {
    const where = `${esc(shortTitle(G.nodes.get(work)?.title || work))}${loc.para ? `, ¶ ${loc.para}` : ''}`;
    return `<blockquote class="gp-psg"><p>“${esc(loc.exact)}”</p>
      <footer><cite>${where}</cite>${loc.para ? `<a href="${locHref(G, loc)}">To this passage →</a>` : ''}</footer></blockquote>`;
  }
  function readingHTML(r) {
    const [a, b] = r.note;
    const tags = [r.status === 'proposed' ? '<span class="tag draft">proposed</span>' : '',
      r.case ? `<span class="tag">${esc(r.case)}</span>` : ''].join('');
    return `<p class="gp-tags">${tags}</p>
      <p class="gp-claim">${esc(r.claim || '')}</p>
      ${(r.alignments || []).some(al => al.from.para && al.to.para) ? `<a class="gp-side" href="${pairHref(r)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="7" height="14" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="13.5" y="5" width="7" height="14" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10h3M10.5 14h3" stroke="currentColor" stroke-width="1.5"/></svg>Read side by side</a>` : ''}
      <ol class="gp-pairs">${(r.alignments || []).map(al => `
        <li>${passageHTML(al.from, a)}${passageHTML(al.to, b)}
          <p class="gp-line"><b>Same</b>${esc(al.same || '')}</p>
          <p class="gp-line"><b>Differs</b>${esc(al.differs || '')}</p></li>`).join('')}</ol>
      ${r.question ? `<div class="gp-q"><h3>Question</h3><p>${esc(r.question)}</p></div>` : ''}`;
  }
  function popHTML(l) {
    const rs = l.readings, many = rs.filter(r => !r.disputes).length > 1;
    let k = 0;
    const tabs = rs.length > 1 ? `<div class="gp-tabs" role="tablist">${rs.map((r, i) => `
      <button type="button" role="tab" data-tab="${i}" aria-selected="${i === popTab}">${r.disputes ? 'Dissent' : many ? `Reading ${++k}` : 'Reading'}</button>`).join('')}</div>` : '';
    return `<header class="gp-head">
        <p class="gp-pair">${pairHTML(l)}</p>
        <p class="gp-def">${defHTML(l)}</p>
        <p class="gp-contact">${CONTACT_KINDS[l.contact] ? `${esc(CONTACT_KINDS[l.contact].name)}: ${esc(CONTACT_KINDS[l.contact].def)}` : ''}</p>
        <button type="button" class="gp-close" aria-label="Close">×</button>
      </header>${tabs}
      <div class="gp-body" role="tabpanel">${rs.length ? readingHTML(rs[popTab]) : ''}</div>`;
  }
  function openPop(l) {
    tip.hidden = true;
    if (popLink === l) return;
    popLink = l; popTab = 0; popAt = '';
    pop.innerHTML = popHTML(l);
    pop.style.setProperty('--c', env.C.rel(l.rel));
    pop.classList.toggle('is-sheet', narrow());
    pop.hidden = false;
    setFocus(null, l);
    quiet = performance.now() + 700; // the camera moves under a still pointer: no tooltips meanwhile
    // Fit both books of the line into the part of the stage the popover leaves free: the right side on wide
    // screens (the popover sits to the left of the line's middle), the band above the sheet on phones.
    engine.still(); touched = true;
    const Wd = W(), H = stage.clientHeight, top = freeRect().top;
    engine.showPair(l, narrow() ? [24, top - 4, Wd - 24, H * 0.36 - 12] : [Math.min(Wd - 160, pop.offsetWidth + 50), 70, Wd - 50, H - 50], 500);
    placePop();
  }
  function closePop() {
    if (!popLink) return;
    popLink = null; pop.hidden = true; pop.innerHTML = '';
    setFocus(null, null);
  }
  function placePop() {
    if (!popLink || pop.classList.contains('is-sheet')) return;
    const l = popLink;
    const box = stage.getBoundingClientRect(), vb = view.getBoundingClientRect(), ox = box.left - vb.left, oy = box.top - vb.top;
    const vw = view.clientWidth, vh = view.clientHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
    const scr = p => ({ x: ox + p.x, y: oy + p.y });
    // Level with the middle of the line, beside it: left of its leftmost book when that fits, else right of the
    // rightmost one, so neither book nor the line is covered.
    const ends = [l.source, l.target].map(n => ({ ...scr(engine.screen(n)), half: Math.max(engine.size(n).w / 2, 44) + 12 }));
    const c = scr(engine.mid(l));
    const left = Math.min(c.x - 6, ...ends.map(e => e.x - e.half)), right = Math.max(c.x + 6, ...ends.map(e => e.x + e.half));
    let x = left - pw;
    if (x < 10) x = right + pw <= vw - 10 ? right : Math.max(10, Math.min(vw - pw - 10, c.x + 16));
    const y = Math.max(10, Math.min(vh - ph - 10, c.y - ph / 2));
    const at = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (at !== popAt) pop.style.transform = popAt = at;
  }
  pop.addEventListener('click', e => {
    const t = e.target.closest('[data-tab], .gp-close');
    if (!t) return;
    if (t.classList.contains('gp-close')) { closePop(); return; }
    popTab = +t.dataset.tab;
    pop.innerHTML = popHTML(popLink);
  });
  const onKey = e => { if (e.key === 'Escape') { if (popLink) closePop(); else if (authorOpen) closeAuthor(); } };
  document.addEventListener('keydown', onKey);

  /* ---------- for tools/graph_qa.py: where things are on screen, in viewport px ---------- */
  const client = p => { const r = stage.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; };
  stage.linkMid = (from, to) => {
    const l = relLinks.find(l => l.note.from === from && l.note.to === to);
    if (!l) return null;
    const m = client(engine.mid(l)), at = n => { const p = client(engine.screen(n)); return [p.x, p.y]; };
    return { x: m.x, y: m.y, ends: [at(l.source), at(l.target)] };
  };
  stage.screenOf = id => { const n = byId.get(id); return n && engine.has(n) ? client(engine.screen(n)) : null; };
  stage.nodeIds = () => nodes.filter(n => n.vis && engine.has(n)).map(n => ({ id: n.id, slug: n.isA ? n.slug : n.b.slugs?.[0], deg: n.deg, author: !!n.isA }));
  stage.cam = () => engine.cam();
  // The shown books (year, x on screen) and relation lines (x of the older and of the newer book on screen).
  stage.timelineReport = () => ({
    books: bookNodes.filter(n => n.vis && engine.has(n)).map(n => ({ id: n.id, year: n.year, x: client(engine.screen(n)).x, y: client(engine.screen(n)).y, gx: n.x, gy: n.y, gz: n.z || 0, held: n.fx != null })),
    lines: relLinks.filter(l => l.on && l.source.vis && l.target.vis).map(l => ({ from: l.source.id, to: l.target.id, fy: l.source.year, ty: l.target.year,
      fx: client(engine.screen(l.source)).x, tx: client(engine.screen(l.target)).x })),
  });

  /* ---------- node click: the camera closes in, then the book comes out of the map ---------- */
  const libBy = new Map((lib?.books || []).map(b => [b.slug, b]));
  // Its relations first, each as what this book does to the other ('answers Frankenstein') or has done to it
  // ('answered by Rappaccini's Daughter'), then the author's other books.
  function connected(n) {
    const seen = new Set(), out = [];
    relLinks.forEach(l => {
      const m = l.source === n ? l.target : l.target === n ? l.source : null;
      if (!m || seen.has(m)) return;
      seen.add(m);
      const k = relKind(l.rel), mine = l.note.from === n.id;
      out.push({ m, verb: mine ? k.verb : k.by, rel: l.rel, def: `${k.name}: ${k.def}` });
    });
    (n.author?.books || []).forEach(m => { if (m !== n && !seen.has(m)) { seen.add(m); out.push({ m, verb: 'same author' }); } });
    return out;
  }
  function panelHTML(n) {
    const list = connected(n);
    if (!list.length) return '';
    return `<div class="fi-links"><h3>Connected books</h3><ul>${list.map(({ m, verb, rel, def }) => `
      <li><button type="button" data-pick="${esc(m.id)}"${def ? ` title="${esc(def)}"` : ''}><span class="s">
        <span class="v"${rel ? ` style="color:${env.C.rel(rel)}"` : ''}>${esc(verb)}</span> <span class="t">${esc(plainTitle(m.b.title))}</span></span></button></li>`).join('')}</ul></div>`;
  }
  const flyTo = (n, ms) => { touched = true; return engine.flyTo(n, ms); };
  async function openNode(n) {
    if (n.isA) { openAuthor(n); return; }
    const book = libBy.get(n.b.slugs?.[0]);
    if (!book || book.status !== 'ready') return;
    closeAuthor();
    tip.hidden = true; setFocus(null, null);
    await flyTo(n);
    if (!root.isConnected) return;
    // A stand-in the size of the book on screen, where the node is drawn: pullOut flies the book out of it.
    const p = engine.screen(n), { w: t, h } = engine.size(n), box = stage.getBoundingClientRect(), vb = view.getBoundingClientRect();
    standin.style.cssText = `--h:${h}px;--t:${t}px;--w:${h * 0.68}px;left:${box.left - vb.left + p.x - t / 2}px;top:${box.top - vb.top + p.y - h / 2}px;width:${t}px;height:${h}px`;
    outNode = n;
    pullOut(standin, book, go, panelHTML(n), id => { const m = byId.get(id); if (m) flyTo(m).then(() => { setFocus(m, null); }); });
  }
  stage.openNode = id => byId.has(id) && openNode(byId.get(id)); // for tools/graph_qa.py

  /* ---------- author click: the camera takes in the author and its books, a panel lists them ---------- */
  const authorEl = root.querySelector('.graph-author');
  let authorOpen = null;
  function authorHTML(a) {
    const life = lifeOf(a);
    const books = [...a.books].sort((x, y) => (x.year || 0) - (y.year || 0) || x.b.title.localeCompare(y.b.title));
    return `<header class="ga-head">
        <span class="ga-medal" aria-hidden="true">${esc(a.ini)}</span>
        <div><h2 id="ga-name">${esc(a.name)}</h2>${life ? `<p class="ga-life">${esc(life)}</p>` : ''}</div>
        <button type="button" class="gp-close" aria-label="Close">×</button>
      </header>
      <div class="ga-body">
        ${a.p.about ? `<p class="ga-about">${esc(a.p.about)}</p>` : ''}
        <h3>In this library</h3>
        <ul class="ga-books">${books.map(b => `<li><button type="button" data-book="${esc(b.id)}"${b.vis ? '' : ' class="is-out"'}>
          <span class="t">${esc(b.b.title)}</span><span class="k">${b.year ? esc(yearText(b.year)) : ''}</span></button></li>`).join('')}</ul>
        ${a.p.doc ? `<a class="ga-more" href="#/author/${encodeURIComponent(a.slug)}">About the author →</a>` : ''}
      </div>`;
  }
  function openAuthor(a) {
    tip.hidden = true; closePop(); closePanel();
    authorOpen = a;
    quiet = performance.now() + 900;
    authorEl.innerHTML = authorHTML(a);
    authorEl.classList.toggle('is-sheet', narrow());
    authorEl.hidden = false;
    focusOn(a, 750); // framed in the part of the stage the panel leaves free
  }
  function closeAuthor() {
    if (!authorOpen) return;
    authorOpen = null; authorEl.hidden = true; authorEl.innerHTML = '';
  }
  authorEl.addEventListener('click', e => {
    if (e.target.closest('.gp-close')) { closeAuthor(); return; }
    const b = e.target.closest('[data-book]'), m = b && byId.get(b.dataset.book);
    if (!m) return;
    closeAuthor(); reveal(m);
    openNode(m);
  });
  stage.openAuthor = id => byId.get(id)?.isA && openAuthor(byId.get(id)); // for tools/graph_qa.py
  stage.booksOf = id => byId.get(id)?.books?.map(b => b.id) || [];

  /* ---------- shelves ⇄ map flight (transit.js) ---------- */
  // Where each volume's book is drawn on screen, and hiding a node while its spines are in the air.
  const bySlug = new Map();
  nodes.forEach(n => (n.b.slugs || []).forEach(s => bySlug.set(s, n)));
  const awaySlugs = new Set();
  const markAway = () => nodes.forEach(n => { n.away = (n.b.slugs || []).some(s => awaySlugs.has(s)); });
  // The stage's box, read once a frame: the flights write a transform per book between their reads.
  let boxAt = -1, boxNow = null;
  const stageBox = () => {
    const t = document.timeline?.currentTime ?? performance.now();
    if (t !== boxAt) { boxAt = t; boxNow = stage.getBoundingClientRect(); }
    return boxNow;
  };
  const flight = {
    rect(slug) {
      const n = bySlug.get(slug);
      if (!n || !n.vis || !engine.has(n) || !view.isConnected) return null;
      const box = stageBox(), p = engine.screen(n), { w, h } = engine.size(n, true);
      const x = box.left + p.x, y = box.top + p.y;
      if (!Number.isFinite(x) || x < box.left - 40 || x > box.right + 40 || y < box.top - 40 || y > box.bottom + 40) return null;
      return { x, y, w, h, a: n.away ? restAlpha(n) : n.a };
    },
    hide(slugs) { slugs.forEach(s => awaySlugs.add(s)); markAway(); },
    land(slug) { awaySlugs.delete(slug); markAway(); },
    // The map being left: draw the hidden nodes away once more, then stop drawing while it fades.
    freeze() { engine.freeze(); },
  };
  stage.flight = flight;
  if (arrive) flight.hide(arrive.slugs);

  /* ---------- filters: relation kinds, genres, a year to read up to ---------- */
  const ctrl = root.querySelector('.graph-ctrl');
  const panel = ctrl.querySelector('.gc-panel'), toggle = ctrl.querySelector('.gc-toggle');
  const range = ctrl.querySelector('.gc-year input'), yearOut = ctrl.querySelector('.gc-year output');
  const countEl = root.querySelector('.graph-count');
  const sliderYear = () => (range && +range.value < years.length - 1 ? years[+range.value] : null);
  function applyFilters() {
    const { rels: R, genres: Gs, year: Y } = filters;
    bookNodes.forEach(n => { n.vis = (!Gs.size || Gs.has(n.genre)) && (Y == null || !n.year || n.year <= Y); n.relOn = false; });
    relLinks.forEach(l => {
      l.on = !R.size || R.has(l.rel);
      if (l.on && l.source.vis && l.target.vis) l.source.relOn = l.target.relOn = true;
    });
    // An author stays while any of its books does, and is bright while any of them is.
    authorNodes.forEach(a => { a.vis = a.books.some(b => b.vis); a.relOn = a.books.some(b => b.vis && b.relOn); });
    if (authorOpen && !authorOpen.vis) closeAuthor();
    if (popLink && !(popLink.on && popLink.source.vis && popLink.target.vis)) closePop();
    if (pin && !pin.vis) { unpin(); input.value = ''; }
    const nv = bookNodes.filter(n => n.vis).length, av = authorNodes.filter(n => n.vis).length, lv = relLinks.filter(l => l.on && l.source.vis && l.target.vis).length;
    const of = (v, all, one, many) => `${v === all ? '' : `${v} of `}${all} ${all === 1 ? one : many}`;
    countEl.textContent = `${of(nv, bookNodes.length, 'book', 'books')}, ${of(av, authorNodes.length, 'author', 'authors')}, ${of(lv, relLinks.length, 'relation', 'relations')}`;
    syncControls();
    setFocus(hoverNode, null);
    engine.refresh();
  }
  function syncControls() {
    ctrl.querySelectorAll('.gc-chip').forEach(b => {
      b.setAttribute('aria-pressed', (b.dataset.group === 'rel' ? filters.rels : filters.genres).has(b.dataset.v));
    });
    if (range) {
      range.value = filters.year == null ? years.length - 1 : Math.max(0, years.findLastIndex(y => y <= filters.year));
      yearOut.textContent = filters.year == null ? 'any year' : yearText(filters.year);
      range.style.setProperty('--at', `${(+range.value / (years.length - 1)) * 100}%`);
    }
    const k = filters.rels.size + filters.genres.size + (filters.year != null);
    const badge = toggle.querySelector('.gc-badge');
    badge.hidden = !k; badge.textContent = k;
    toggle.classList.toggle('is-on', k > 0);
    ctrl.querySelector('.gc-clear').disabled = !k;
  }
  function openPanel(open) {
    panel.hidden = !open; toggle.setAttribute('aria-expanded', open);
    if (open) { hideHits(); closeAuthor(); }
  }
  function closePanel() { if (!panel.hidden) openPanel(false); }
  toggle.addEventListener('click', () => openPanel(panel.hidden));
  // After a change the camera takes in what is left on the map, or stays with the found book.
  const refit = () => { touched = true; engine.still(); if (pin) focusOn(pin, 700); else fit(700); };
  panel.addEventListener('click', e => {
    const b = e.target.closest('.gc-chip, .gc-clear');
    if (!b) return;
    if (b.classList.contains('gc-clear')) { filters.rels.clear(); filters.genres.clear(); filters.year = null; }
    else {
      const set = b.dataset.group === 'rel' ? filters.rels : filters.genres;
      set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
    }
    applyFilters(); refit();
  });
  range?.addEventListener('input', () => { filters.year = sliderYear(); applyFilters(); });
  range?.addEventListener('change', refit);
  ctrl.querySelector('.gc-mode').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (b && !b.disabled && b.dataset.mode !== mode) switchTo(b.dataset.mode);
  });

  /* ---------- Web | Timeline: the books glide to their new places, left to right, the axis fading in ---------- */
  const layoutEl = root.querySelector('.graph-layout');
  const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let regrow = 0;
  function setLayout(next) {
    if (next === layout) return;
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* private mode: this visit only */ }
    layout = next; view.dataset.layout = next;
    layoutEl.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', b.dataset.layout === next));
    cancelAnimationFrame(tween); clearTimeout(regrow);
    closePop(); closePanel(); tip.hidden = true;
    const T = timeline();
    // Leaving the web: remember where every book was, to go back there.
    if (next === 'timeline' && nodes.every(n => n.fx == null)) nodes.forEach(n => { n.web = { x: n.x, y: n.y, z: n.z || 0 }; });
    const to = next === 'timeline' ? T.pos : nodes.every(n => n.web) ? new Map(nodes.map(n => [n, n.web])) : null;
    const from = new Map(nodes.map(n => [n, { x: n.x, y: n.y, z: n.z || 0 }]));
    const ms = reduced() ? 0 : 1500, span = ms * 0.8;
    // Books further right on the timeline set off a little later: the change sweeps across in time order.
    const xs = [...T.pos.values()].map(p => p.x), xa = Math.min(...xs), xw = Math.max(...xs) - xa || 1;
    const lag = n => (ms - span) * ((T.pos.get(n).x - xa) / xw);
    const m0 = tlMix, m1 = next === 'timeline' ? 1 : 0;
    engine.layout(next);
    engine.still(); touched = true;
    if (to) engine.frame(nodes.filter(n => n.vis).map(n => to.get(n)), ms, 2.4, true);
    else {
      // No web to go back to (the map opened on the timeline): let the forces grow it, and frame it as it settles.
      nodes.forEach(n => { n.fx = n.fy = n.fz = undefined; });
      touched = false;
      regrow = setTimeout(() => { if (!touched) fit(1200); }, 1300);
    }
    engine.reheat(!!to);
    const t0 = performance.now();
    const step = now => {
      const e = ms ? Math.min(1, (now - t0) / ms) : 1;
      tweenAt = now;
      if (to) nodes.forEach(n => {
        const a = from.get(n), b = to.get(n), u = easeIO(Math.max(0, Math.min(1, ms ? (e * ms - lag(n)) / span : 1)));
        pinTo(n, { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u });
      });
      tlMix = m0 + (m1 - m0) * easeIO(e);
      if (e < 1) { tween = requestAnimationFrame(step); return; }
      tween = 0;
      // Back in the web: the books are free again, where they were.
      if (next === 'web') nodes.forEach(n => { n.fx = n.fy = n.fz = undefined; n.vx = n.vy = n.vz = 0; });
      if (to) engine.rest();
    };
    step(t0);
  }
  layoutEl.addEventListener('click', e => { const b = e.target.closest('[data-layout]'); if (b) setLayout(b.dataset.layout); });

  /* ---------- search: the camera goes to the book as its title is typed ---------- */
  const input = ctrl.querySelector('.gc-search input'), hitsEl = ctrl.querySelector('.gc-hits');
  const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  nodes.forEach(n => {
    if (n.isA) { n.key = n.keyT = fold(n.name); n.keyA = ''; return; } // an author is found by its name
    n.key = fold(n.b.title); n.keyT = n.key.replace(/^(the|a|an) /, ''); n.keyA = fold(authorOf(G, n.b));
  });
  function find(q) {
    q = fold(q);
    if (!q) return [];
    const rank = n => (n.keyT.startsWith(q) || n.key.startsWith(q) ? 0 : ` ${n.key}`.includes(` ${q}`) ? 1
      : n.key.includes(q) ? 2 : ` ${n.keyA}`.includes(` ${q}`) ? 3 : 9);
    return nodes.map(n => [rank(n), n]).filter(([r]) => r < 9)
      .sort((a, b) => a[0] - b[0] || !!b[1].isA - !!a[1].isA || b[1].deg - a[1].deg || a[1].b.title.localeCompare(b[1].b.title))
      .map(([, n]) => n).slice(0, 7);
  }
  let hits = [], active = -1, typing = 0;
  function showHits() {
    hitsEl.innerHTML = hits.map((n, i) => {
      if (n.isA) {
        const life = lifeOf(n), k = n.books.length;
        return `<li role="option" id="gc-hit-${i}" data-i="${i}" aria-selected="${i === active}" class="is-author${n.vis ? '' : ' is-out'}">
          <b>${esc(n.name)}</b><span>${life ? `${esc(life)} · ` : ''}${k} ${k === 1 ? 'book' : 'books'}${n.vis ? '' : ' · filtered out'}</span></li>`;
      }
      const yr = yearOf(n.b);
      return `<li role="option" id="gc-hit-${i}" data-i="${i}" aria-selected="${i === active}"${n.vis ? '' : ' class="is-out"'}>
        <b>${esc(n.b.title)}</b><span>${esc(authorOf(G, n.b))}${yr ? `, ${yearText(+yr)}` : ''}${n.vis ? '' : ' · filtered out'}</span></li>`;
    }).join('') || (input.value.trim() ? '<li class="gc-none">No book or author by that name</li>' : '');
    hitsEl.hidden = !hitsEl.innerHTML;
    input.setAttribute('aria-expanded', !hitsEl.hidden);
    if (active >= 0) input.setAttribute('aria-activedescendant', `gc-hit-${active}`); else input.removeAttribute('aria-activedescendant');
  }
  function hideHits() { hitsEl.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  input.addEventListener('input', () => {
    hits = find(input.value); active = hits.length ? 0 : -1;
    showHits(); closePanel();
    clearTimeout(typing);
    if (!input.value.trim()) { unpin(); return; }
    typing = setTimeout(() => { if (hits[0]) focusOn(hits[0], 650); }, 220);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      showHits(); clearTimeout(typing); focusOn(hits[active], 450);
    } else if (e.key === 'Enter') {
      if (hits[active]) { e.preventDefault(); pick(hits[active]); }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (!hitsEl.hidden) hideHits(); else { input.value = ''; unpin(); }
    }
  });
  input.addEventListener('focus', () => { if (input.value.trim()) { hits = find(input.value); showHits(); } closePanel(); });
  input.addEventListener('blur', () => setTimeout(hideHits, 150));
  hitsEl.addEventListener('pointerdown', e => e.preventDefault()); // keep the field focused while choosing
  hitsEl.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) pick(hits[+li.dataset.i]); });
  function pick(n) {
    clearTimeout(typing);
    input.value = n.isA ? n.name : n.b.title; hideHits();
    if (narrow()) input.blur(); // put the keyboard away so the map shows
    focusOn(n, 700);
  }

  // A book in focus: lit with its neighbours, framed with them, its address in the URL (#/graph/<slug>).
  function reveal(n) {
    if (n.vis) return;
    if (n.isA) { // an author filtered out: bring back its books' genres, or the years they came out in
      if (filters.genres.size) n.books.forEach(b => filters.genres.add(b.genre));
      if (filters.year != null) filters.year = null;
      applyFilters();
      return;
    }
    if (filters.genres.size) filters.genres.add(n.genre);
    if (filters.year != null && n.year > filters.year) filters.year = null;
    applyFilters();
  }
  function focusOn(n, ms = 800) {
    reveal(n);
    engine.still(); touched = true;
    if (pin !== n) { pin = n; history.replaceState(null, '', `#/graph/${n.isA ? n.slug : n.b.slugs[0]}`); }
    if (popLink) closePop(); else setFocus(hoverNode, null);
    if (!engine.has(n)) return; // before the first frame: enter() frames it
    // An author with its books; a book with the books its shown relations reach.
    const near = n.isA ? [n, ...n.books.filter(m => m.vis)] : [n, ...[...nbrs.get(n)].filter(m => m.vis && links.some(l => l.kind === 'rel' && l.on
      && ((l.source === n && l.target === m) || (l.target === n && l.source === m))))];
    engine.frame(near, ms, near.length > 1 ? 2.2 : W() < 640 ? 2.2 : 2.6);
  }
  function unpin() {
    if (!pin) return;
    pin = null;
    if (location.hash !== '#/graph') history.replaceState(null, '', '#/graph');
    setFocus(hoverNode, null);
  }
  const onDocKey = e => { if (e.key === 'Escape') { closePanel(); hideHits(); } };
  document.addEventListener('keydown', onDocKey);

  applyFilters();
  // #/graph/<slug>: a volume's slug or the work's own name; else an author's slug (the author with its books).
  const start = focus && (bookNodes.find(n => n.b.slugs?.includes(focus) || n.id === `work:${focus}`)
    || authorNodes.find(n => n.slug === focus));
  if (start) { focusOn(start, 0); input.value = start.isA ? start.name : start.b.title; }
  // For tools/graph_qa.py: what the map shows and where the camera is.
  stage.state = () => {
    const c = engine.cam();
    return { mode, layout, mix: tlMix, tweenAt, pin: pin?.id || null, center: { x: c.x, y: c.y }, zoom: c.k, hash: location.hash,
      visible: bookNodes.filter(n => n.vis).length, authors: authorNodes.filter(n => n.vis).length, author: authorOpen?.id || null, lit: [...lit].map(n => n.id), lines: relLinks.filter(l => l.on && l.source.vis && l.target.vis).length,
      bright: nodes.filter(n => n.vis && (!filters.rels.size || n.relOn)).length, away: nodes.filter(n => n.away).length,
      years: bookNodes.filter(n => n.vis).map(n => n.year), genres: [...new Set(bookNodes.filter(n => n.vis).map(n => n.genre))],
      at: Object.fromEntries(nodes.filter(n => n === pin).map(n => [n.id, { x: n.x, y: n.y, z: n.z }])) };
  };

  const ro = new ResizeObserver(() => engine.resize());
  ro.observe(stage);
  return () => {
    clearTimeout(typing); clearTimeout(regrow); clearTimeout(prep); cancelAnimationFrame(tween); dropFlight();
    document.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onDocKey);
    ro.disconnect(); mo.disconnect(); mq.removeEventListener('change', readTheme);
    engine.destroy();
  };
}

// Forces both engines share: books push apart (related books more), relation lines hold their books loosely, and each
// author draws its books in close. The pull is strong on the books in the author's main genre and weak on the rest, so
// an author across genres keeps one tight cluster in its home region and only reaches out to the others; related books
// stay in the middle, where the relations are.
export function authorForces(fg) {
  fg.d3Force('charge').strength(n => (n.deg ? -110 : n.isA ? -30 : -16)).distanceMax(220);
  fg.d3Force('link')
    .distance(l => (l.kind === 'rel' ? 120 : 14 + l.target.h))
    .strength(l => (l.kind === 'rel' ? 0.08 : l.source.deg ? 0.03 : l.source.genre === l.target.home ? 0.5 : 0.04));
}

// A gilt medal with initials, centred on (x, y), on a 2D canvas context.
export function drawMedal(ctx, x, y, r, ini, font = 'Georgia, serif') {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#f3dc94'); g.addColorStop(0.55, '#c9a24a'); g.addColorStop(1, '#8a6a24');
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(r * 0.08, 0.3); ctx.strokeStyle = 'rgba(92,66,20,.7)';
  ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.stroke();
  if (!ini) return;
  ctx.font = `600 ${r * (ini.length > 1 ? 0.78 : 0.95)}px ${font}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a4012';
  ctx.fillText(ini, x, y + r * 0.05);
}

// An author's medal: the first and last capitalised words of the name ("H. G. Wells" -> "HW").
export function initials(name) {
  const ws = name.replace(/\(.*?\)/g, '').split(/[\s-]+/).filter(w => /^\p{Lu}/u.test(w));
  return ws.length > 1 ? ws[0][0] + ws[ws.length - 1][0] : (ws[0] || name)[0];
}

export function shortTitle(t) {
  return t.replace(/^(The|A|An) /, '').split(/[;:]/)[0].replace(/^(.{26}).+$/, '$1…');
}
