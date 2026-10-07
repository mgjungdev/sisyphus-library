// Side by side (#/pair/<reading>[/<n>]): the two books of a reading open next to each other (one above the other on
// phones), each passage of its alignments marked in both. Scrolling either book carries the other along: the passage
// pairs are fixed points, and between them the other book moves in proportion, so a marked passage arrives at the
// reading line together with its counterpart.
import { esc, roman } from './art.js';
import { authorOf, yearOf, relationSentence, relKind, relColour, darkTheme, plainTitle } from './catalog.js';
import { readingType } from './reader.js';

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const LINE = 0.38; // the reading line, as a share of a pane's height: passage pairs meet there
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const readingById = (G, id) => [...G.readings.values()].flat().find(r => r.id === id || r.id === `r:${id}`) || null;
export const pairHref = (r, n) => `#/pair/${encodeURIComponent(r.id.replace(/^r:/, ''))}${n > 1 ? `/${n}` : ''}`;

// The volumes one side of the reading needs, in reading order: every slug its passages are in.
export const slugsOf = (r, side) => [...new Set((r.alignments || []).map(a => a[side].source))]
  .sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));

// sides: { from: [book JSON], to: [book JSON] } for the volumes slugsOf names.
export function renderPair(root, G, r, sides, start = 1) {
  const [fromId, toId, rel] = r.note;
  const note = G.notes.find(n => n.from === fromId && n.to === toId && n.rel === rel) || { from: fromId, to: toId, rel };
  const x = relationSentence(G, note), mode = x.mode && relKind(rel).modes?.[x.mode];
  const als = (r.alignments || []).filter(a => a.from.para && a.to.para);
  const type = readingType();

  // One paragraph of a book as plain text, the aligned passages in it marked with their pair's number.
  const plain = p => p.map(t => (typeof t === 'string' ? t : t[0])).join('');
  function paraHTML(book, i, side) {
    const p = book.paragraphs[i - 1];
    if (p.length === 1 && p[0]?.h) return `<h3 class="pv-ch">${esc(p[0].h)}</h3>`;
    const text = plain(p);
    const here = als.map((a, k) => ({ loc: a[side], n: k + 1 })).filter(({ loc }) => loc.source === book.slug && loc.para === i);
    // Marks in text order; a passage not found in the paragraph marks the whole paragraph.
    const found = here.map(h => ({ ...h, at: text.indexOf(h.loc.exact) })).sort((p1, p2) => p1.at - p2.at);
    let html = '', pos = 0;
    for (const { loc, n, at } of found) {
      if (at < pos) continue;
      html += esc(text.slice(pos, at)) + `<mark class="pv-mark" data-n="${n}">${esc(loc.exact)}</mark>`;
      pos = at + loc.exact.length;
    }
    html += esc(text.slice(pos));
    const ns = here.map(h => h.n);
    return `<p id="${side}-${book.slug}-${i}" class="${ns.length ? 'pv-al' : ''}"${ns.length ? ` data-ns="${ns.join(' ')}"` : ''}>${
      ns.length ? `<button type="button" class="pv-num" data-go="${ns[0]}" aria-label="Passage pair ${ns[0]}">${ns.join(' · ')}</button>` : ''}${html}</p>`;
  }
  const workOf = side => G.nodes.get(side === 'from' ? fromId : toId);
  function paneHTML(side) {
    const books = sides[side], w = workOf(side);
    const body = books.map(b => `${books.length > 1 || b.vol ? `<h2 class="pv-vol">${esc(b.vol ? `Volume ${roman(b.vol)}` : b.title)}</h2>` : ''}${
      b.paragraphs.map((_, i) => paraHTML(b, i + 1, side)).join('')}`).join('');
    return `<section class="pv-pane" data-side="${side}" aria-label="${esc(plainTitle(w?.title || ''))}">
      <header class="pv-book"><p class="pv-title"><i>${esc(plainTitle(w?.title || books[0].title))}</i></p>
        <p class="pv-by">${esc(authorOf(G, w) || books[0].author)}${yearOf(w) ? `, ${esc(String(yearOf(w)))}` : ''}</p>
        <a class="pv-open" href="#/read/${esc(books[0].slug)}">Open<span> in the reader</span></a></header>
      <div class="pv-scroll" tabindex="0"><div class="pv-text">${body}<p class="pv-end"></p></div></div>
    </section>`;
  }
  const back = workOf('from')?.slugs?.[0];

  root.innerHTML = `
  <div class="pair" style="--c:${relColour(rel, darkTheme())}; --fs:${type.fs}px; --lh:${type.lh}; --align:${type.align}">
    <header class="pv-top">
      <a class="pv-back" href="${back ? `#/graph/${esc(back)}` : '#/graph'}">${ICON.back}<span>Graph</span></a>
      <div class="pv-head">
        <p class="pv-sent"><i>${esc(x.from)}</i> <em>${esc(x.verb)}</em> <i>${esc(x.to)}</i>${r.status === 'proposed' ? ' <span class="tag draft">proposed</span>' : ''}</p>
        <p class="pv-kind">${esc(x.name)}${x.mode ? `&nbsp;· <span${mode ? ` title="${esc(mode)}"` : ''}>${esc(x.mode.replace(/-/g, ' '))}</span>` : ''}: ${esc(r.claim || x.def)}</p>
      </div>
    </header>
    <div class="pv-panes">${paneHTML('from')}<svg class="pv-ties" aria-hidden="true"></svg>${paneHTML('to')}</div>
    <footer class="pv-note" aria-live="polite">
      <div class="pv-step">
        <button type="button" class="pv-prev" aria-label="Previous passage pair">${ICON.prev}</button>
        <span class="pv-count"></span>
        <button type="button" class="pv-next" aria-label="Next passage pair">${ICON.next}</button>
      </div>
      <div class="pv-lines"></div>
    </footer>
  </div>`;

  const P = root.querySelector('.pair');
  const panes = Object.fromEntries(['from', 'to'].map(s => [s, P.querySelector(`.pv-pane[data-side="${s}"] .pv-scroll`)]));
  const ties = P.querySelector('.pv-ties');
  const other = s => (s === 'from' ? 'to' : 'from');
  // Each pair's passage in each pane: its mark (or its paragraph, when the passage was not found in it).
  const el = (side, n) => {
    const a = als[n - 1], p = P.querySelector(`#${CSS.escape(`${side}-${a[side].source}-${a[side].para}`)}`);
    return p?.querySelector(`.pv-mark[data-n="${n}"]`) || p;
  };

  /* ---------- the fixed points: where each pair's passages sit on the reading line ---------- */
  let anchors = []; // [{ n, from, to }] scrollTop of each pane that puts the passage's middle on the reading line
  const maxOf = s => Math.max(0, panes[s].scrollHeight - panes[s].clientHeight);
  function measure() {
    const top = s => panes[s].getBoundingClientRect().top - panes[s].scrollTop;
    const at = (s, n) => {
      const e = el(s, n);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return Math.max(0, Math.min(maxOf(s), r.top - top(s) + r.height / 2 - panes[s].clientHeight * LINE));
    };
    anchors = als.map((_, k) => ({ n: k + 1, from: at('from', k + 1), to: at('to', k + 1) })).filter(a => a.from != null && a.to != null);
  }
  // The other pane's scrollTop for this one's, piecewise linear from the two tops to the two ends. Near each pair
  // (half a pane either way, a third of the way to the next pair when they are close) the two move together line for
  // line, so the passages stay side by side while they are read; between pairs the other book makes up the difference.
  function follow(lead, y) {
    const f = other(lead), H = panes[lead].clientHeight * 0.5, mf = maxOf(f);
    const as = [...anchors].sort((p, q) => p[lead] - q[lead]);
    const pts = [{ [lead]: 0, [f]: 0 }];
    as.forEach((a, i) => {
      const d = Math.min(H, (a[lead] - (as[i - 1]?.[lead] ?? -Infinity)) / 3, ((as[i + 1]?.[lead] ?? Infinity) - a[lead]) / 3);
      [-d, 0, d].forEach(k => pts.push({ [lead]: a[lead] + k, [f]: Math.max(0, Math.min(mf, a[f] + k)) }));
    });
    pts.push({ [lead]: maxOf(lead), [f]: mf });
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (y > q[lead]) continue;
      const span = q[lead] - p[lead];
      return span < 1 ? q[f] : p[f] + ((y - p[lead]) / span) * (q[f] - p[f]);
    }
    return mf;
  }

  /* ---------- scrolling: the pane the reader handles leads, the other follows ---------- */
  let lead = null, gliding = 0, cur = 0, easing = 0;
  // A small step is taken at once; a long one (pairs whose passages lie far apart in the other book) is eased, so
  // the other book is seen travelling rather than jumping.
  function chase(s) {
    const f = panes[other(s)], to = follow(s, panes[s].scrollTop);
    if (easing || Math.abs(to - f.scrollTop) > f.clientHeight * 0.5) {
      if (!easing) easing = requestAnimationFrame(function step() {
        const goal = follow(s, panes[s].scrollTop), d = goal - f.scrollTop;
        if (Math.abs(d) < 1 || lead !== s) { f.scrollTop = goal; easing = 0; return; }
        f.scrollTop += d * 0.28;
        easing = requestAnimationFrame(step);
      });
    } else f.scrollTop = to;
  }
  const take = s => () => {
    if (gliding) { cancelAnimationFrame(gliding); gliding = 0; }
    if (lead !== s) { cancelAnimationFrame(easing); easing = 0; }
    lead = s;
  };
  Object.entries(panes).forEach(([s, pane]) => {
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(t => pane.addEventListener(t, take(s), { passive: true }));
    pane.addEventListener('scroll', () => {
      if (lead === s && !gliding) chase(s);
      frame();
    }, { passive: true });
  });

  // Both panes to pair n, together.
  function goTo(n, smooth = !calm()) {
    const a = anchors.find(a => a.n === n);
    if (!a) return;
    cancelAnimationFrame(gliding); cancelAnimationFrame(easing);
    lead = null; easing = 0;
    const from = { from: panes.from.scrollTop, to: panes.to.scrollTop }, t0 = performance.now(), ms = smooth ? 520 : 0;
    const step = now => {
      const t = ms ? Math.min(1, (now - t0) / ms) : 1, e = 1 - (1 - t) ** 3;
      panes.from.scrollTop = from.from + (a.from - from.from) * e;
      panes.to.scrollTop = from.to + (a.to - from.to) * e;
      gliding = t < 1 ? requestAnimationFrame(step) : 0;
      if (!gliding) setCur(n);
    };
    gliding = requestAnimationFrame(step);
  }

  /* ---------- the pair on the reading line: its note below, its marks lit, ties drawn between them ---------- */
  const count = P.querySelector('.pv-count'), lines = P.querySelector('.pv-lines');
  function setCur(n) {
    if (n === cur) return;
    cur = n;
    const a = als[n - 1];
    count.textContent = `${n} of ${als.length}`;
    lines.innerHTML = `<p class="pv-line"><b>Same</b>${esc(a.same || '')}</p><p class="pv-line"><b>Differs</b>${esc(a.differs || '')}</p>`;
    P.querySelectorAll('.pv-mark, .pv-al').forEach(m => m.classList.toggle('is-cur',
      m.dataset.n ? +m.dataset.n === n : m.dataset.ns.split(' ').includes(String(n))));
    P.querySelector('.pv-prev').disabled = n <= 1;
    P.querySelector('.pv-next').disabled = n >= als.length;
  }
  // The current pair is the one nearest the reading line in the pane being read.
  function nearest() {
    const s = lead || 'from', y = panes[s].scrollTop;
    let best = null;
    anchors.forEach(a => { if (!best || Math.abs(a[s] - y) < Math.abs(best[s] - y)) best = a; });
    return best?.n;
  }
  let tick = 0;
  function frame() {
    if (tick) return;
    tick = requestAnimationFrame(() => {
      tick = 0;
      if (!gliding) { const n = nearest(); if (n) setCur(n); }
      drawTies();
    });
  }
  // Side by side, a thin curve joins each pair's passages across the gutter while either is on screen.
  function drawTies() {
    if (!ties.getClientRects().length) return;
    const box = ties.getBoundingClientRect(), w = box.width;
    const mid = (s, n) => {
      const e = el(s, n), pr = panes[s].getBoundingClientRect(), r = e?.getBoundingClientRect();
      if (!r) return null;
      return { y: Math.max(pr.top, Math.min(pr.bottom, r.top + r.height / 2)) - box.top, seen: r.bottom > pr.top && r.top < pr.bottom };
    };
    ties.innerHTML = anchors.map(({ n }) => {
      const a = mid('from', n), b = mid('to', n);
      if (!a || !b || !(a.seen || b.seen)) return '';
      return `<path d="M0 ${a.y.toFixed(1)} C${w / 2} ${a.y.toFixed(1)} ${w / 2} ${b.y.toFixed(1)} ${w} ${b.y.toFixed(1)}" class="${n === cur ? 'is-cur' : ''}"/>`;
    }).join('');
  }

  P.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { goTo(+g.dataset.go); return; }
    const m = e.target.closest('.pv-mark');
    if (m) { goTo(+m.dataset.n); return; }
    if (e.target.closest('.pv-prev')) goTo(Math.max(1, cur - 1));
    if (e.target.closest('.pv-next')) goTo(Math.min(als.length, cur + 1));
  });
  // The reader link opens each book at the passage of the current pair.
  P.querySelectorAll('.pv-open').forEach(a => a.addEventListener('click', () => {
    const loc = als[cur - 1]?.[a.closest('.pv-pane').dataset.side];
    if (loc) a.href = `#/read/${loc.source}/${loc.para}`;
  }));
  const onKey = e => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'j' || (e.key === 'ArrowDown' && e.altKey)) goTo(Math.min(als.length, cur + 1));
    if (e.key === 'k' || (e.key === 'ArrowUp' && e.altKey)) goTo(Math.max(1, cur - 1));
  };
  addEventListener('keydown', onKey);

  /* ---------- start at pair `start`; measure again when the layout changes ---------- */
  // A resized window, or the text set again once its web font arrives: the pair being read stays on the line (or,
  // once the reader has scrolled, the other book is put back in step with the one being read).
  let started = false, rz;
  const keep = () => {
    if (!started) return;
    measure();
    if (lead) panes[other(lead)].scrollTop = follow(lead, panes[lead].scrollTop); else goTo(cur || start, false);
    drawTies();
  };
  const sizes = new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(keep, 100); });
  P.querySelectorAll('.pv-scroll, .pv-text').forEach(e => sizes.observe(e));
  const begin = () => {
    if (started || !P.isConnected) return;
    started = true;
    measure();
    goTo(Math.max(1, Math.min(als.length, start)), false);
    drawTies();
  };
  (document.fonts?.ready || Promise.resolve()).then(() => requestAnimationFrame(begin));
  setTimeout(begin, 1200);
  scrollTo(0, 0);

  // for tools/graph_qa.py
  P.pairState = () => ({ cur, lead, anchors: anchors.map(a => ({ ...a })), tops: { from: panes.from.scrollTop, to: panes.to.scrollTop } });

  return () => {
    cancelAnimationFrame(gliding); cancelAnimationFrame(tick); cancelAnimationFrame(easing);
    removeEventListener('keydown', onKey);
    clearTimeout(rz); sizes.disconnect();
  };
}
