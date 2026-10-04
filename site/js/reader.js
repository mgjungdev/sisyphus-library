import { esc, roman, volOf } from './art.js';
import { openCard, closeCard, cardOpen } from './card.js';
import { getProgress, setProgress, prefs } from './store.js';

/* ---------- reading preferences ---------- */
const DEFAULTS = { fs: 20, lh: 'normal', margin: 'normal', layout: 'auto', align: 'justify', turn: 'slide' };
const LH = { compact: 1.42, normal: 1.6, relaxed: 1.85 };
const MARGIN = { narrow: [22, 16], normal: [40, 24], wide: [64, 36] }; // [wide screens, phones]
const THEMES = [['auto', 'Auto'], ['white', 'White'], ['paper', 'Paper'], ['gray', 'Gray'], ['night', 'Night']];
const opt = () => {
  const o = { ...DEFAULTS, align: innerWidth < 600 ? 'left' : 'justify', ...prefs.get('reader', {}) };
  if (o.turn === 'flip') o.turn = 'slide'; // flip was removed
  return o;
};
const saveOpt = o => prefs.set('reader', o);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function applyTheme(t) {
  prefs.set('theme', t);
  try { localStorage.setItem('sl.theme', t); } catch { /* ignore */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}
export function currentTheme() {
  const t = prefs.get('theme', 'auto');
  return { light: 'white', sepia: 'paper', dark: 'night' }[t] || t;
}

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14M5 12h14M5 17.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

export function renderReader(root, book, startPara) {
  const total = book.paragraphs.length;
  const o = opt();

  const tok = x => typeof x === 'string' ? esc(x) : `<span class="w" data-l="${esc(x[1])}">${esc(x[0])}</span>`;
  const chapters = book.chapters || [];
  const segs = chapters.length
    ? chapters.map((c, i) => ({ title: c.title, start: i === 0 ? 1 : c.para, end: (chapters[i + 1]?.para ?? total + 1) - 1 }))
    : [{ title: '', start: 1, end: total }];
  const segOf = para => Math.max(0, segs.findIndex(x => para >= x.start && para <= x.end));
  const titlePage = `<section class="tp"><p class="tp-author">${esc(book.author)}</p><h1>${esc(book.title)}</h1>${book.vol ? `<p class="tp-vol">${volOf(book)}</p>` : ''}<p class="tp-year">${book.year < 0 ? `c. ${-book.year} BC` : book.year < 1000 ? `c. ${book.year}` : book.year}</p></section>`;
  // The last volume ends the novel; the others hand over to the next volume once it is on the shelf.
  const more = book.vol && book.vol < book.vols;
  const endHTML = !more ? '<p class="the-end">The End</p>'
    : `<p class="the-end">End of Volume ${roman(book.vol)}</p>` + (book.next
      ? `<p class="next-vol"><a href="#/read/${esc(book.next.slug)}">Continue to Volume ${roman(book.next.vol)}</a></p>`
      : `<p class="next-vol soon">Volume ${roman(book.vol + 1)} is coming soon</p>`);
  const paraHTML = i => {
    const p = book.paragraphs[i - 1];
    if (p.length === 1 && p[0] && p[0].h) return `<h2 class="ch" id="p${i}" data-p="${i}">${esc(p[0].h)}</h2>`;
    return `<p id="p${i}" data-p="${i}">${p.map(tok).join('')}</p>`;
  };
  const seg = (name, items, cur) => `<div class="seg" role="group">${items.map(([v, l]) =>
    `<button class="chip" data-set="${name}" data-val="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;

  root.innerHTML = `
  <div class="ereader">
    <header class="r-top chrome">
      <a class="r-back" href="#/">${ICON.back}<span>Library</span></a>
      <div class="r-title"><b>${esc(book.title)}${book.vol ? ` ${roman(book.vol)}` : ''}</b><span>${esc(book.author)}</span></div>
      <div class="r-actions">
        ${chapters.length ? `<button class="icon-btn" data-panel="toc" aria-label="Contents" aria-expanded="false">${ICON.list}</button>` : ''}
        <button class="icon-btn aa" data-panel="aa" aria-label="Reading settings" aria-expanded="false">Aa</button>
      </div>
    </header>

    <div class="stage">
      <div class="sheet s1"><span class="folio"></span></div>
      <div class="sheet s2"><span class="folio"></span></div>
      <div class="hover-mark" aria-hidden="true"><i></i><i></i></div>
      <div class="clip">
        <div class="flow"></div>
        <i class="clip-end"></i>
      </div>
      <button class="turn prev" aria-label="Previous page">${ICON.prev}</button>
      <button class="turn next" aria-label="Next page">${ICON.next}</button>
    </div>

    <footer class="r-bottom chrome">
      <div class="r-scrub">
        <button class="foot-turn prev" aria-label="Previous page">${ICON.prev}</button>
        <input class="scrub" type="range" min="1" max="1" value="1" aria-label="Page">
        <button class="foot-turn next" aria-label="Next page">${ICON.next}</button>
      </div>
      <div class="r-pos"><span class="pos"></span><span class="left"></span></div>
    </footer>

    <aside class="panel-aa" hidden aria-label="Reading settings">
      <div class="row"><span class="lbl">Text size</span>
        <div class="stepper"><button class="chip" data-fs="-1" aria-label="Smaller text">A</button><output class="fs-val">${o.fs}</output><button class="chip big" data-fs="1" aria-label="Larger text">A</button></div></div>
      <div class="row"><span class="lbl">Line spacing</span>${seg('lh', [['compact', 'Compact'], ['normal', 'Normal'], ['relaxed', 'Relaxed']], o.lh)}</div>
      <div class="row"><span class="lbl">Margins</span>${seg('margin', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']], o.margin)}</div>
      <div class="row"><span class="lbl">Layout</span>${seg('layout', [['auto', 'Auto'], ['single', 'One page'], ['double', 'Two pages']], o.layout)}</div>
      <div class="row"><span class="lbl">Alignment</span>${seg('align', [['left', 'Left'], ['justify', 'Justified']], o.align)}</div>
      <div class="row"><span class="lbl">Page turn</span>${seg('turn', [['slide', 'Slide'], ['none', 'None']], o.turn)}</div>
      <div class="row"><span class="lbl">Theme</span>
        <div class="swatches">${THEMES.map(([v, l]) => `<button class="swatch" data-theme-set="${v}" data-t="${v}" aria-pressed="${currentTheme() === v}"><i></i>${l}</button>`).join('')}</div></div>
    </aside>

    <aside class="panel-toc" hidden aria-label="Contents">
      <header><h2>Contents</h2><button class="icon-btn" data-close-panel aria-label="Close">${ICON.close}</button></header>
      <ol class="toc"></ol>
    </aside>
  </div>`;

  const R = root.querySelector('.ereader');
  const stage = R.querySelector('.stage');
  const clip = R.querySelector('.clip');
  const flow = R.querySelector('.flow');
  const sheets = [...R.querySelectorAll('.sheet')];
  const scrub = R.querySelector('.scrub');
  let paras = [];
  let si = -1;

  // Word hover: two pre-composited boxes under the text, moved with transform and shown with opacity.
  // Restyling a span inside the columns would repaint and re-layerize the whole chapter.
  const marks = [...R.querySelectorAll('.hover-mark i')];
  let hovEl = null;
  function markHover(el) {
    if (el === hovEl) return;
    hovEl = el;
    const rs = el ? el.getClientRects() : [];
    const sr = rs.length ? stage.getBoundingClientRect() : null;
    marks.forEach((m, n) => {
      const r = rs[n];
      if (!r) { m.style.opacity = '0'; return; }
      // Sized directly: scaling a 1px box up stretched its texture past the word's edge.
      Object.assign(m.style, { width: r.width + 'px', height: r.height + 'px', transform: `translate(${r.left - sr.left}px, ${r.top - sr.top}px)` });
      m.style.opacity = '1';
    });
  }              // current segment (chapter)
  function renderSeg(n) {
    si = n;
    page = 0;
    const sg = segs[n];
    let html = n === 0 ? titlePage : '';
    for (let i = sg.start; i <= sg.end; i++) html += paraHTML(i);
    if (n === segs.length - 1) html += endHTML;
    flow.innerHTML = html + '<span class="flow-end"></span>';
    paras = [...flow.querySelectorAll('[data-p]')];
  }

  let L = null;         // layout metrics
  let page = 0;         // index of first visible page
  let busy = false;

  /* ---------- layout ---------- */
  function measure() {
    const W = innerWidth, H = innerHeight;
    const phone = W < 600;
    const spread = o.layout === 'double' ? W >= 700 : o.layout === 'single' ? false : (W >= 900 && W > H * 1.05);
    const top = phone ? 52 : 60, bottom = phone ? 62 : 70;
    const side = phone ? 0 : 64;
    const m = MARGIN[o.margin][phone ? 1 : 0];
    const vpad = phone ? 22 : 40;
    const measureW = o.fs * 30 + 2 * m; // about 65 characters of Times at this size
    const pageW = Math.floor(spread ? Math.min((W - 2 * side) / 2, measureW) : Math.min(W - 2 * side, measureW + 40));
    const pageH = H - top - bottom;
    const colW = pageW - 2 * m, textH = pageH - 2 * vpad;
    const x0 = Math.round((W - pageW * (spread ? 2 : 1)) / 2);
    return { W, H, phone, spread, top, bottom, m, vpad, pageW, pageH, colW, textH, x0, per: spread ? 2 : 1 };
  }

  // anchor: a paragraph number, or an element of the current chapter to keep in view
  function layout(anchor, atEnd = false) {
    const anchorPara = typeof anchor === 'number' ? anchor : null;
    if (anchorPara && segOf(anchorPara) !== si) renderSeg(segOf(anchorPara));
    else if (si < 0) renderSeg(0);
    stopSlide();
    L = measure();
    R.classList.toggle('is-spread', L.spread);
    R.classList.toggle('phone', L.phone);
    R.style.setProperty('--fs', o.fs + 'px');
    R.style.setProperty('--lh', LH[o.lh]);
    R.style.setProperty('--align', o.align);
    sheets.forEach((s, i) => {
      Object.assign(s.style, { left: L.x0 + i * L.pageW + 'px', top: L.top + 'px', width: L.pageW + 'px', height: L.pageH + 'px' });
      s.hidden = i === 1 && !L.spread;
    });
    Object.assign(clip.style, { left: L.x0 + L.m + 'px', top: L.top + L.vpad + 'px', width: (L.spread ? 2 * L.pageW - 2 * L.m : L.colW) + 'px', height: L.textH + 'px' });
    Object.assign(flow.style, { transform: 'none', width: clip.style.width, height: L.textH + 'px', columnCount: L.per, columnGap: 2 * L.m + 'px' });
    L.pages = pageOf(flow.querySelector('.flow-end')) + 1;
    if (L.pages % L.per) L.pages += L.per - (L.pages % L.per);
    // The clip can only scroll as far as its content: stretch it to the padded last spread.
    R.querySelector('.clip-end').style.left = L.pages * L.pageW - 2 * L.m - 1 + 'px';
    mapPages();
    scrub.max = String(L.pages / L.per);
    const anchorEl = anchorPara ? flow.querySelector(`[data-p="${anchorPara}"]`) : anchor?.isConnected ? anchor : null;
    let pg = atEnd ? L.pages - 1 : anchorEl ? pageOf(anchorEl) : Math.min(page, L.pages - 1);
    pg -= pg % L.per;
    show(pg);
  }

  function pageOf(el) {
    if (!el) return 0;
    const fr = flow.getBoundingClientRect();
    const r = el.getClientRects()[0] || el.getBoundingClientRect();
    return Math.max(0, Math.floor((r.left - fr.left + 2) / L.pageW));
  }

  // One pass per layout: the first paragraph that reaches each page. Turning pages only looks it up.
  let pageFirst = [];
  function mapPages() {
    const fl = flow.getBoundingClientRect().left;
    pageFirst = new Array(L.pages).fill(segs[si].end);
    let pg = 0;
    for (const p of paras) {
      const rs = p.getClientRects();
      if (!rs.length) continue;
      const last = Math.floor((rs[rs.length - 1].left - fl + 2) / L.pageW);
      for (; pg <= last && pg < L.pages; pg++) pageFirst[pg] = +p.dataset.p;
      if (pg >= L.pages) break;
    }
  }
  const firstParaOnPage = pg => pageFirst[pg] ?? segs[si].end;
  // The first word on the current page. Relayouts return to it, not to the start of a paragraph
  // carried over from the page before, which moved the reader back a page or two each time.
  // It is held until the reader moves, so a run of resizes keeps returning to the same word.
  let held = null;
  const hold = () => (held ||= page === 0 ? null : firstWordOnPage());
  function firstWordOnPage() {
    const p = flow.querySelector(`[data-p="${firstParaOnPage(page)}"]`);
    if (!p) return null;
    for (const w of p.querySelectorAll('.w')) if (pageOf(w) >= page) return w;
    return p;
  }

  // Pages move by scrolling the clip, never by transforming the flow: a transform moves every word span,
  // and with accessibility on (common on Windows) the browser reports each one's new place, freezing for seconds.
  function show(pg, scroll = true) {
    page = Math.max(0, Math.min(pg, L.pages - L.per));
    markHover(null);
    if (scroll) { stopSlide(); clip.scrollLeft = page * L.pageW; }
    sheets[0].querySelector('.folio').textContent = page ? page + 1 : '';
    sheets[1].querySelector('.folio').textContent = L.spread && page + 1 < L.pages ? page + 2 : '';
    scrub.value = String(page / L.per + 1);
    const last = page + L.per >= L.pages;
    const end = last && si === segs.length - 1;
    const a = page, b = Math.min(page + L.per - 1, L.pages - 1);
    const pages = L.per === 2 ? `ages ${a + 1}–${b + 1} of ${L.pages}` : `age ${a + 1} of ${L.pages}`;
    R.querySelector('.pos').textContent = segs.length > 1 ? `${segs[si].title}, p${pages}` : `P${pages}`;
    const para = page === 0 ? segs[si].start : firstParaOnPage(page);
    const left = Math.max(0, Math.round(book.minutes * (1 - para / total)));
    R.querySelector('.left').textContent = end ? (more ? 'End of volume' : 'End of story') : left <= 1 ? 'Less than a minute left' : `${left} min left`;
    R.querySelectorAll('.prev').forEach(b => { b.disabled = page === 0 && si === 0; });
    R.querySelectorAll('.next').forEach(b => { b.disabled = end; });
    setProgress(book.slug, end ? total : para, end ? 100 : (para / total) * 100, total);
  }

  /* ---------- page turning ---------- */
  // A turn during a slide retargets it from where it is, so quick presses each count.
  function turn(dir) {
    if (!L) return;
    held = null;
    const target = page + dir * L.per;
    if (target < 0 || target > L.pages - L.per) {
      const next = si + dir;
      if (next < 0 || next >= segs.length) return;
      closeCard(true);
      stopSlide();
      renderSeg(next);
      layout(null, dir < 0);
      if (!reduceMotion()) clip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
      return;
    }
    closeCard(true);
    if (reduceMotion() || o.turn === 'none') return show(target);
    slide(target);
  }

  let raf = 0;
  function slide(target) {
    cancelAnimationFrame(raf);
    const from = clip.scrollLeft;
    show(target, false);
    const to = page * L.pageW, t0 = performance.now();
    busy = true;
    const step = now => {
      const t = Math.min(1, (now - t0) / 380);
      clip.scrollLeft = from + (to - from) * (1 - (1 - t) ** 3);
      if (t < 1) raf = requestAnimationFrame(step); else { raf = 0; busy = false; }
    };
    raf = requestAnimationFrame(step);
  }
  function stopSlide() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0; busy = false;
    clip.scrollLeft = page * L.pageW;
  }

  // Focus (Tab onto a word) or find-in-page can scroll the clip itself: follow it to that page.
  clip.addEventListener('scroll', () => {
    if (busy || !L || Math.abs(clip.scrollLeft - page * L.pageW) < 2) return;
    const a = document.activeElement;
    const pg = flow.contains(a) ? pageOf(a) : Math.round(clip.scrollLeft / L.pageW);
    held = null;
    show(pg - (pg % L.per));
  }, { passive: true });

  /* ---------- chrome ---------- */
  let chromeShown = true;
  const setChrome = on => { chromeShown = on; R.classList.toggle('chrome-hidden', !on); };

  /* ---------- input ---------- */
  const openFor = span => openCard({ anchor: span, surface: span.textContent, lemma: span.dataset.l });

  let down = null, swiped = false;
  stage.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; swiped = false; });
  stage.addEventListener('pointerup', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - down.t < 800) { swiped = true; turn(dx < 0 ? 1 : -1); }
    down = null;
  });
  stage.addEventListener('click', e => {
    if (swiped) { swiped = false; return; }
    const tb = e.target.closest('.turn');
    if (tb) return turn(tb.classList.contains('next') ? 1 : -1);
    const span = e.target.closest('.clip .w');
    const sel = getSelection();
    if (span && !(sel && !sel.isCollapsed && sel.toString().trim().length > 1)) return openFor(span);
    if (cardOpen()) return closeCard();
    if (Object.values(panels).some(p => p && !p.hidden)) return closePanels();
    setChrome(!chromeShown);
  });
  R.querySelector('.r-scrub').addEventListener('click', e => {
    const b = e.target.closest('.foot-turn');
    if (b) turn(b.classList.contains('next') ? 1 : -1);
  });
  if (matchMedia('(hover: hover)').matches) {
    clip.addEventListener('pointerover', e => { if (!busy) markHover(e.target.closest('.w')); });
    clip.addEventListener('pointerleave', () => markHover(null));
  }
  const onKey = e => {
    if (e.target.closest?.('input, textarea, .card, .panel-aa, .panel-toc')) return;
    if (['ArrowRight', 'PageDown'].includes(e.key) || e.key === ' ') { e.preventDefault(); turn(1); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
    if (e.key === 'Escape') closePanels();
  };
  addEventListener('keydown', onKey);
  let wheelAt = 0;
  stage.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) < 20 || Date.now() - wheelAt < 500) return;
    wheelAt = Date.now(); turn(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  scrub.addEventListener('input', () => { closeCard(true); held = null; show((+scrub.value - 1) * L.per); });

  /* ---------- panels ---------- */
  const panels = { aa: R.querySelector('.panel-aa'), toc: R.querySelector('.panel-toc') };
  function closePanels() {
    Object.values(panels).forEach(p => { p.hidden = true; });
    R.querySelectorAll('[data-panel]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  R.querySelectorAll('[data-panel]').forEach(b => b.addEventListener('click', () => {
    const p = panels[b.dataset.panel];
    const open = p.hidden;
    closePanels(); closeCard(true);
    p.hidden = !open; b.setAttribute('aria-expanded', String(open));
    if (open && b.dataset.panel === 'toc') drawToc();
  }));
  R.querySelector('[data-close-panel]').addEventListener('click', closePanels);

  function drawToc() {
    panels.toc.querySelector('.toc').innerHTML = segs.map((x, n) => `<li><button data-seg="${n}"${n === si ? ' aria-current="true"' : ''}>${esc(x.title || book.title)}</button></li>`).join('');
  }
  panels.toc.addEventListener('click', e => {
    const b = e.target.closest('[data-seg]');
    if (b) { closePanels(); held = null; renderSeg(+b.dataset.seg); layout(null); show(0); }
  });

  panels.aa.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const anchor = hold();
    if (b.dataset.fs) { o.fs = Math.min(30, Math.max(15, o.fs + +b.dataset.fs)); panels.aa.querySelector('.fs-val').textContent = o.fs; }
    else if (b.dataset.set) {
      const v = b.dataset.val;
      o[b.dataset.set] = v === 'true' ? true : v === 'false' ? false : v;
      panels.aa.querySelectorAll(`[data-set="${b.dataset.set}"]`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    } else if (b.dataset.themeSet) {
      applyTheme(b.dataset.themeSet);
      panels.aa.querySelectorAll('[data-theme-set]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      return;
    } else return;
    saveOpt(o);
    layout(anchor);
  });

  /* ---------- start ---------- */
  let rz;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => layout(hold()), 150); };
  addEventListener('resize', onResize);
  const saved = getProgress(book.slug);
  const startAt = startPara || (saved && !saved.done ? saved.para : null);
  let started = false;
  const start = () => { if (started || !R.isConnected) return; started = true; layout(startAt && startAt > 1 ? startAt : null); };
  (document.fonts?.ready || Promise.resolve()).then(() => requestAnimationFrame(start));
  setTimeout(start, 1200);
  scrollTo(0, 0);

  return () => {
    closeCard(true);
    removeEventListener('keydown', onKey);
    removeEventListener('resize', onResize);
  };
}
