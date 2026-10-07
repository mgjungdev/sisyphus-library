import { esc, roman, volOf } from './art.js';
import { openCard, closeCard, cardOpen } from './card.js';
import { getProgress, setProgress, prefs } from './store.js';
import { pairHref } from './pair.js';
import { locHref, readSlug, authorOf, yearOf, relationSentence, relKind } from './catalog.js';

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
// The reader's type, for other pages set like it (the author essays): size, leading, alignment, side margin.
export function readingType() {
  const o = opt();
  return { fs: o.fs, lh: LH[o.lh], align: o.align, margin: MARGIN[o.margin][innerWidth < 600 ? 1 : 0] };
}
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
  graph: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8.3 7.4l7.4-.9M7.2 9.1l3.7 6.8M16.9 8.2l-3.8 7.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

/* ---------- footnotes: the glosses anchored in one book ---------- */
// Map(para -> [{ g, n }]) for one slug, numbered in reading order.
export function glossMarks(G, slug) {
  const marks = new Map();
  (G.glossesBySlug.get(slug) || []).filter(g => g.loc.para).sort((x, y) => x.loc.para - y.loc.para)
    .forEach((g, i) => { if (!marks.has(g.loc.para)) marks.set(g.loc.para, []); marks.get(g.loc.para).push({ g, n: i + 1 }); });
  return marks;
}

export function glossCard(G, g) {
  const t = g.target && G.nodes.get(g.target);
  const read = t && readSlug(G, t.id);
  return {
    title: g.label,
    html: `<p class="gloss-text">${esc(g.text)}</p>`,
    links: [
      ...(g.see ? [{ href: locHref(G, g.see), label: 'See also' }] : []),
      ...(read ? [{ href: `#/read/${read}`, label: `Read ${t.title.split(';')[0]}` }] : []),
      ...(t?.slugs?.length ? [{ href: `#/graph/${t.slugs[0]}`, label: 'In the graph' }] : []),
    ],
  };
}

/* ---------- relation marks: passages a reading aligns with a passage in another book ---------- */
// A short name for the other book: "The Island of Doctor Moreau" → "Moreau", "Frankenstein; or, …" → "Frankenstein".
export function shortTitle(title = '') {
  let t = title.split(/[;:]/)[0].trim();
  const of = t.lastIndexOf(' of ');
  if (of > 0) t = t.slice(of + 4);
  t = t.replace(/^(the|a|an)\s+/i, '').replace(/\b(Doctor|Dr\.?|Mr\.?|Mrs\.?|Miss|Captain|Sir)\s+/g, '');
  return t || title;
}

// Map(para -> [{ rel }]) for one slug: one mark per paragraph and other book, holding every alignment that meets there.
export function relationMarks(G, slug) {
  const marks = new Map(), byKey = new Map();
  G.readings.forEach(list => list.forEach(r => (r.alignments || []).forEach((a, i) => {
    [[a.from, a.to, r.note[1]], [a.to, a.from, r.note[0]]].forEach(([here, there, otherWork]) => {
      if (here.source !== slug || !here.para) return;
      const key = `${here.para}|${otherWork}`;
      let m = byKey.get(key);
      if (!m) {
        const w = G.nodes.get(otherWork);
        m = { id: key, para: here.para, work: w, label: shortTitle(w?.title || otherWork), exact: here.exact, items: [] };
        byKey.set(key, m);
        if (!marks.has(here.para)) marks.set(here.para, []);
        marks.get(here.para).push({ rel: m });
      }
      m.items.push({ r, a, n: i + 1, there });
    });
  })));
  return marks;
}

export function relationCard(G, m) {
  const w = m.work;
  // Each item opens on who does what to whom ('Rappaccini's Daughter answers Frankenstein') and what that kind means.
  const head = r => {
    const [from, to, rel] = r.note, note = G.notes.find(n => n.from === from && n.to === to && n.rel === rel) || { from, to, rel };
    const x = relationSentence(G, note), mode = x.mode && relKind(rel).modes?.[x.mode];
    return `<p class="rel-sent"><i>${esc(x.from)}</i> <em>${esc(x.verb)}</em> <i>${esc(x.to)}</i></p>
      <p class="rel-type">${esc(x.name)}${x.mode ? `&nbsp;· <span${mode ? ` title="${esc(mode)}"` : ''}>${esc(x.mode.replace(/-/g, ' '))}</span>` : ''}${r.status === 'proposed' ? ' <span class="tag draft">proposed</span>' : ''}${r.disputes ? ' <span class="tag">dissent</span>' : ''}</p>
      <p class="rel-def">${esc(x.def)}</p>`;
  };
  const items = m.items.map(({ r, a, there }) => `
    <section class="rel-item">
      ${head(r)}
      <p class="rel-line"><b>Same</b> ${esc(a.same)}</p>
      <p class="rel-line"><b>Differs</b> ${esc(a.differs)}</p>
      <blockquote class="rel-psg"><p>“${esc(there.exact)}”</p><a href="${locHref(G, there)}">${esc(m.label)}${there.para ? `, ¶ ${there.para}` : ''} →</a></blockquote>
    </section>`).join('');
  // One passage across the alignments: a footer link to it; several: each item carries its own link.
  const places = [...new Map(m.items.map(({ there }) => [locHref(G, there), there])).values()];
  return {
    title: `↔ ${w?.title?.split(';')[0] || m.label}`,
    meta: w ? `${esc(authorOf(G, w))}${yearOf(w) ? `, ${esc(String(yearOf(w)))}` : ''}` : '',
    html: items,
    links: [...(places.length === 1 ? [{ href: locHref(G, places[0]), label: `Go to the passage in ${m.label}` }] : []),
      ...[...new Map(m.items.map(({ r, n }) => [r.id, { href: pairHref(r, n), label: 'Read side by side' }])).values()].slice(0, 1)],
  };
}

/* ---------- appendix: the back matter after "The End" of the last volume, from the work's dossier ---------- */
const ROLE = { composition: 'Composition', preface: 'Preface', letter: 'Letters', review: 'Reception', source: 'Sources', criticism: 'Criticism' };

// { html, parts: [[id, title]] } for the book's work, or null when the catalog holds nothing to put there.
export function appendixOf(G, slug) {
  const id = G.slugs[slug];
  const w = id && G.nodes.get(id);
  if (!w) return null;
  const dossier = G.dossiers.get(id);
  const texts = G.textsOf.get(id) || [];
  const cited = new Set();
  const cite = evs => (evs || []).forEach(e => cited.add(e.src));
  cite(w.ev);
  const parts = [];
  const part = (pid, title, body) => { parts.push([pid, title]); return `<section class="app-part" id="${pid}"><h3>${esc(title)}</h3>${body}</section>`; };

  // Contexts: the dossier's arrangement, or the context edges grouped by role.
  const ctxEdges = G.edges.filter(e => e.type === 'context' && e.to === id);
  ctxEdges.forEach(e => cite(e.ev));
  const byRole = ctxEdges.reduce((m, e) => ((m[e.role] ||= []).push(e.from), m), {});
  const sections = dossier?.sections || Object.entries(byRole).map(([role, items]) => ({ title: ROLE[role] || role, items }));
  const vol = (w.slugs || []).length > 1 ? s => w.slugs.indexOf(s) + 1 : () => 0;
  const where = loc => `${vol(loc.source) ? `, Volume ${roman(vol(loc.source))}` : ''}${loc.para ? `, ¶ ${loc.para}` : ''}`;
  const item = itemId => {
    const g = G.glosses.get(itemId);
    if (g) {
      cite(g.ev);
      return `<li class="app-gloss"><p class="app-title">${esc(g.label)}</p><p>${esc(g.text)}</p>
        <p class="app-links"><a href="${locHref(G, g.loc)}">In the text${where(g.loc)}</a></p></li>`;
    }
    const c = G.nodes.get(itemId);
    if (!c) return '';
    cite(c.ev);
    const fp = c.first_pub || {};
    const s = G.contexts[itemId];
    const head = `<i>${esc(c.title)}</i>`;
    // A context printed inside the book itself (Dorian Gray's Preface) has no ctx- text; its locus points into the book.
    const at = !s && ctxEdges.find(e => e.from === itemId)?.loci?.[0];
    return `<li class="app-ctx"><p class="app-title">${s ? `<a href="#/read/${esc(s)}">${head}</a>` : head}</p>
      <p class="app-sub">${esc(authorOf(G, c))}${fp.venue ? `, ${esc(fp.venue)}` : ''}${yearOf(c) ? `, ${esc(String(yearOf(c)))}` : ''}</p>${at
      ? `<p class="app-links"><a href="${locHref(G, at)}">In the text${where(at)}</a></p>` : ''}</li>`;
  };
  const ctxHTML = sections.map(s => {
    const items = s.items.map(item).join('');
    return items ? `<h4>${esc(s.title)}</h4><ul class="app-list">${items}</ul>` : '';
  }).join('');

  // A Note on the Text: the editor's note, the editions of each text, and the collation behind the copy-text.
  const col = G.collate[id];
  const editions = [...G.nodes.values()].filter(n => n.kind === 'edition' && texts.some(t => t.id === n.text)).sort((a, b) => a.year - b.year);
  editions.forEach(e => cite(e.ev));
  texts.forEach(t => cite(t.ev));
  const label = tid => G.nodes.get(tid)?.label || tid;
  const noteHTML = (dossier?.note_on_text ? `<p>${esc(dossier.note_on_text)}</p>` : '')
    + (editions.length ? `<table class="app-table"><thead><tr><th>Edition</th><th>Text</th></tr></thead><tbody>${editions.map(e =>
      `<tr><td>${esc(e.label)}</td><td>${esc(label(e.text))}</td></tr>`).join('')}</tbody></table>` : '')
    + (col ? `<h4>Collation</h4><p class="app-sub">Sentences found in only one of the two editions, and how many of them occur in this edition's text.</p>
      <table class="app-table"><thead><tr><th>Sentences unique to</th><th class="num">Found here</th></tr></thead><tbody>${Object.entries(col.texts).map(([tid, v]) =>
        `<tr><td>${esc(label(tid))}${tid === col.copytext ? ' <span class="app-sub">(copy-text)</span>' : ''}</td><td class="num">${v.found} of ${v.probes}</td></tr>`).join('')}</tbody></table>` : '');

  // Sources: the dossier's bibliography, then every source the records above rest on.
  const author = G.nodes.get(w.author);
  if (author?.lccn) cited.add(`src:lcnaf-${author.lccn}`);
  const src = sid => {
    const s = G.sources.get(sid);
    return s ? `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}</li>` : '';
  };
  const bib = dossier?.bibliography || [];
  const rest = [...cited].filter(s => !s.startsWith('ctx:') && !bib.includes(s)).sort();
  const srcHTML = [...bib, ...rest].map(src).join('');

  if (!ctxHTML && !noteHTML && !dossier) return null;
  const html = (ctxHTML ? part('app-contexts', 'Contexts', ctxHTML) : '')
    + (noteHTML ? part('app-note', 'A Note on the Text', noteHTML) : '')
    + (srcHTML ? part('app-sources', 'Sources', `<ul class="app-list app-src">${srcHTML}</ul>`) : '');
  return html ? { html: `<section class="appendix" id="appendix"><h2>Appendix</h2>${html}</section>`, parts } : null;
}

// notes: { marks: Map(para -> [{ g, n } | { rel }]), open(anchor, kind, id) } — footnote and relation markers from the catalog.
// appendix: { html, parts } from appendixOf, set after "The End" of the last volume and listed in the contents.
// graph: the book's place in the graph (#/graph/<slug>), when it is a node there.
// author: the author's essay (#/author/<slug>), when there is one.
export function renderReader(root, book, startPara, notes = null, appendix = null, graph = null, author = null) {
  const total = book.paragraphs.length;
  const o = opt();

  const tok = x => typeof x === 'string' ? esc(x) : `<span class="w" data-l="${esc(x[1])}">${esc(x[0])}</span>`;
  const chapters = book.chapters || [];
  const segs = chapters.length
    ? chapters.map((c, i) => ({ title: c.title, start: i === 0 ? 1 : c.para, end: (chapters[i + 1]?.para ?? total + 1) - 1 }))
    : [{ title: '', start: 1, end: total }];
  const segOf = para => Math.max(0, segs.findIndex(x => para >= x.start && para <= x.end));
  const titlePage = `<section class="tp"><p class="tp-author">${author ? `<a href="${esc(author)}">${esc(book.author)}</a>` : esc(book.author)}</p><h1>${esc(book.title)}</h1>${book.vol ? `<p class="tp-vol">${volOf(book)}</p>` : ''}<p class="tp-year">${book.year < 0 ? `c. ${-book.year} BC` : book.year < 1000 ? `c. ${book.year}` : book.year}</p></section>`;
  // The last volume ends the novel; the others hand over to the next volume once it is on the shelf.
  const more = book.vol && book.vol < book.vols;
  if (more) appendix = null;
  const endHTML = !more ? '<p class="the-end">The End</p>' + (appendix?.html || '')
    : `<p class="the-end">End of Volume ${roman(book.vol)}</p>` + (book.next
      ? `<p class="next-vol"><a href="#/read/${esc(book.next.slug)}">Continue to Volume ${roman(book.next.vol)}</a></p>`
      : `<p class="next-vol soon">Volume ${roman(book.vol + 1)} is coming soon</p>`);
  const paraHTML = i => {
    const p = book.paragraphs[i - 1];
    if (p.length === 1 && p[0] && p[0].h) return `<h2 class="ch" id="p${i}" data-p="${i}">${esc(p[0].h)}</h2>`;
    return `<p id="p${i}" data-p="${i}">${withMarks(p, notes?.marks?.get(i))}</p>`;
  };
  // A footnote marker goes right after the passage it glosses (at the paragraph's end if the passage is not found).
  function withMarks(p, list) {
    const html = p.map(tok);
    if (!list) return html.join('');
    const text = p.map(x => (typeof x === 'string' ? x : x[0]));
    const full = text.join('');
    const tail = [];
    for (const { g, n, rel } of list) {
      const mark = rel
        ? `<button class="rel-mark" data-rel="${esc(rel.id)}" aria-label="Related passage in ${esc(rel.label)}">↔ ${esc(rel.label)}</button>`
        : `<button class="fn" data-gloss="${esc(g.id)}" aria-label="Note ${n}: ${esc(g.label)}">${n}</button>`;
      const loc = rel ? { exact: rel.exact } : g.loc;
      let at = full.indexOf(loc.exact);
      if (loc.prefix) { const k = full.indexOf(loc.prefix + loc.exact); if (k >= 0) at = k + loc.prefix.length; }
      if (at < 0) { tail.push(mark); continue; }
      const end = at + loc.exact.length;
      let pos = 0;
      for (let k = 0; k < text.length; k++) {
        pos += text[k].length;
        if (pos >= end) { html[k] += mark; break; }
      }
    }
    return html.join('') + tail.join('');
  }
  const seg = (name, items, cur) => `<div class="seg" role="group">${items.map(([v, l]) =>
    `<button class="chip" data-set="${name}" data-val="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;

  root.innerHTML = `
  <div class="ereader">
    <header class="r-top chrome">
      <a class="r-back" href="#/">${ICON.back}<span>Library</span></a>
      <div class="r-title"><b>${esc(book.title)}${book.vol ? ` ${roman(book.vol)}` : ''}</b>${author ? `<a class="r-author" href="${esc(author)}">${esc(book.author)}</a>` : `<span>${esc(book.author)}</span>`}</div>
      <div class="r-actions">
        ${graph ? `<a class="icon-btn" href="${esc(graph)}" aria-label="Show in the graph" title="Show in the graph">${ICON.graph}</a>` : ''}
        ${chapters.length || appendix ? `<button class="icon-btn" data-panel="toc" aria-label="Contents" aria-expanded="false">${ICON.list}</button>` : ''}
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
    const theEnd = flow.querySelector('.the-end');
    L.endPage = theEnd ? pageOf(theEnd) : null;
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

  // The appendix starts on a fresh page after the one with "The End".
  const inAppendix = () => !!appendix && si === segs.length - 1 && L?.endPage != null && page > L.endPage;

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
    // The story is done once "The End" is on screen; the appendix may follow on later pages.
    const done = end || (si === segs.length - 1 && L.endPage != null && page + L.per > L.endPage);
    const a = page, b = Math.min(page + L.per - 1, L.pages - 1);
    const pages = L.per === 2 ? `ages ${a + 1}–${b + 1} of ${L.pages}` : `age ${a + 1} of ${L.pages}`;
    const where = inAppendix() ? 'Appendix' : segs.length > 1 ? segs[si].title : '';
    R.querySelector('.pos').textContent = where ? `${where}, p${pages}` : `P${pages}`;
    const para = page === 0 ? segs[si].start : firstParaOnPage(page);
    const left = Math.max(0, Math.round(book.minutes * (1 - para / total)));
    R.querySelector('.left').textContent = done ? (more ? 'End of volume' : 'End of story') : left <= 1 ? 'Less than a minute left' : `${left} min left`;
    R.querySelectorAll('.prev').forEach(b => { b.disabled = page === 0 && si === 0; });
    R.querySelectorAll('.next').forEach(b => { b.disabled = end; });
    setProgress(book.slug, done ? total : para, done ? 100 : (para / total) * 100, total);
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
    if (e.target.closest('.clip a')) return; // links in the text (next volume, appendix) navigate
    const tb = e.target.closest('.turn');
    if (tb) return turn(tb.classList.contains('next') ? 1 : -1);
    const fn = e.target.closest('.clip .fn');
    if (fn && notes) return notes.open(fn, 'gloss', fn.dataset.gloss);
    const rm = e.target.closest('.clip .rel-mark');
    if (rm && notes) return notes.open(rm, 'rel', rm.dataset.rel);
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
    const inApp = inAppendix();
    panels.toc.querySelector('.toc').innerHTML = segs.map((x, n) => `<li><button data-seg="${n}"${n === si && !inApp ? ' aria-current="true"' : ''}>${esc(x.title || book.title)}</button></li>`).join('')
      + (appendix ? `<li class="toc-app"><button data-app="appendix"${inApp ? ' aria-current="true"' : ''}>Appendix</button>
        <ol>${appendix.parts.map(([id, t]) => `<li><button data-app="${id}">${esc(t)}</button></li>`).join('')}</ol></li>` : '');
  }
  panels.toc.addEventListener('click', e => {
    const b = e.target.closest('[data-seg]');
    if (b) { closePanels(); held = null; renderSeg(+b.dataset.seg); layout(null); show(0); }
    const a = e.target.closest('[data-app]');
    if (a) {
      closePanels(); held = null;
      if (si !== segs.length - 1) renderSeg(segs.length - 1);
      layout(flow.querySelector(`#${a.dataset.app}`));
    }
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
