import { coverHTML, initials, esc, roman, volOf } from './art.js';
import { getProgress, prefs } from './store.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => innerWidth < 640;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const num = n => NUM[n] || String(n);
const SHORT = {
  'Fairy Tales & Fables': 'Fairy tales', 'Adventure': 'Adventure', 'Mystery & Detective': 'Mystery', 'Gothic & Horror': 'Gothic',
  'Ghost Stories': 'Ghosts', 'Science Fiction & Fantasy': 'SF & fantasy', 'Love & Society': 'Love', 'Humor & Satire': 'Humor',
  'Realism & Character': 'Realism',
};
const MODES = [['month', 'Month'], ['century', 'Century'], ['genre', 'Genre']];

let flight = null; // active pull-out state

function groupBooks(lib, mode) {
  const groups = new Map();
  const add = (key, head, b) => { if (!groups.has(key)) groups.set(key, { key, ...head, books: [] }); groups.get(key).books.push(b); };
  for (const b of lib.books) {
    if (mode === 'century') add(b.century.key, { big: b.century.label, small: b.century.sub, nav: b.century.label }, b);
    else if (mode === 'genre') add(b.genre, { big: b.genre, small: '', nav: SHORT[b.genre] || b.genre, long: true }, b);
    else {
      const [y, m] = b.month.split('-');
      add(b.month, { big: MONTHS[+m - 1], small: y, nav: `${MONTHS[+m - 1].slice(0, 3)} ${y.slice(2)}` }, b);
    }
  }
  const list = [...groups.values()];
  if (mode === 'genre') list.sort((a, b) => lib.genres.indexOf(a.key) - lib.genres.indexOf(b.key));
  else list.sort((a, b) => a.key.localeCompare(b.key));
  for (const g of list) g.books.sort(mode === 'month' ? (a, b) => a.plan - b.plan : (a, b) => a.year - b.year || a.plan - b.plan);
  return list;
}

function summary(g) {
  const n = g.books.length;
  const ready = g.books.filter(b => b.status === 'ready');
  const mins = ready.reduce((t, b) => t + b.minutes, 0);
  const time = mins >= 90 ? `about ${Math.round(mins / 60)} hours` : `about ${mins} minutes`;
  const stories = `${num(n)} ${n === 1 ? 'story' : 'stories'}`;
  if (!ready.length) return `${stories}, coming soon.`;
  if (ready.length === n) return `${stories}, ${time} of reading.`;
  return `${stories}. ${num(ready.length)} ready, ${time} of reading.`;
}

export function renderLibrary(root, lib, { go }) {
  let mode = prefs.get('shelveBy', 'month');
  let tag = null;
  const books = new Map(lib.books.map(b => [b.slug, b]));
  const tagCounts = {};
  lib.books.forEach(b => b.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16).map(([t]) => t).sort();

  // the arrange control lives in the top bar
  const bar = document.getElementById('topbar-title');
  bar.innerHTML = `<div class="arrange seg" role="group" aria-label="Arrange shelves by">${MODES.map(([m, l]) =>
    `<button class="chip" data-mode="${m}" aria-pressed="${m === mode}">${l}</button>`).join('')}</div>`;

  let spy = null;
  // The wall: shelves side by side in columns (one per group), a group too long for one column spans more.
  function wall() {
    const narrow = isNarrow();
    const pad = Math.min(48, Math.max(16, innerWidth * 0.04));
    const nav = innerWidth >= 1100 ? 84 : 0; // the timeline at the right edge keeps its own lane
    const inner = Math.min(innerWidth - nav, 1240) - 2 * pad;
    const gap = narrow ? 20 : 56, min = narrow ? 150 : 290;
    const cols = Math.max(1, Math.min(3, Math.floor((inner + gap) / (min + gap))));
    return { narrow, cols, gap, cell: (inner - gap * (cols - 1)) / cols, shelfH: narrow ? 188 : 214, scale: narrow ? 0.95 : 1.12, edge: narrow ? 12 : 24 };
  }
  function draw() {
    const W = wall();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const groups = groupBooks(lib, mode);
    const target = mode === 'month' ? (groups.find(g => g.key >= thisMonth) || groups[groups.length - 1]) : null;
    const thick = b => Math.round((b.spine?.thickness || 22) * W.scale) + 4;

    const span = g => {
      const total = g.books.reduce((t, b) => t + thick(b), 0) + W.edge;
      return Math.max(1, Math.min(W.cols, Math.ceil(total / W.cell)));
    };
    const ledges = (g, n) => {
      const rowW = n * W.cell + (n - 1) * W.gap - W.edge;
      const rows = [[]];
      let w = 0;
      for (const b of g.books) {
        const t = thick(b);
        if (w + t > rowW && rows[rows.length - 1].length) { rows.push([]); w = 0; }
        rows[rows.length - 1].push(b); w += t;
      }
      return rows.map(r => `<div class="ledge-wrap"><div class="shelf-row" style="height:${Math.round(W.shelfH * 0.93)}px">${r.map(b => bookHTML(b, W.shelfH, g.big, W.scale)).join('')}</div><div class="ledge"></div></div>`).join('');
    };
    root.innerHTML = `
    <div class="library" data-mode="${mode}" style="--cols:${W.cols};--gap:${W.gap}px">
      <div class="tagbar" role="group" aria-label="Show stories tagged">
        <div class="tag-track">
          <button class="chip" data-tag="" aria-pressed="${!tag}">All stories</button>
          ${tags.map(t => `<button class="chip" data-tag="${esc(t)}" aria-pressed="${tag === t}">${esc(t)}</button>`).join('')}
        </div>
      </div>
      ${groups.map(g => { const n = span(g); return `
      <section class="month${g === target ? ' is-current' : ''}${g.long ? ' long' : ''}" id="grp-${slugify(g.key)}" data-group="${esc(g.key)}" aria-label="${esc(g.big)}"${n > 1 ? ` style="grid-column: span ${n}"` : ''}>
        <header class="month-head">
          <h2><span class="m">${esc(g.big)}</span>${g.small ? `<span class="y">${esc(g.small)}</span>` : ''}</h2>
          <p>${summary(g)}</p>
        </header>
        <div class="month-body">
          ${ledges(g, n)}
        </div>
      </section>`; }).join('')}
    </div>
    ${timeline(groups, mode)}`;

    applyTag();
    const shelves = [...root.querySelectorAll('.month')];
    spy?.disconnect();
    spy = new IntersectionObserver(es => {
      const vis = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) markTimeline(vis.target.dataset.group);
    }, { rootMargin: '-35% 0px -55% 0px' });
    shelves.forEach(s => spy.observe(s));
    return { target };
  }

  // The timeline at the right edge: years, and under the one on screen its months (month mode); the group names
  // otherwise.
  function markTimeline(key) {
    const nav = root.querySelector('.month-nav');
    if (!nav) return;
    nav.querySelectorAll('a').forEach(a => a.setAttribute('aria-current', String(a.dataset.group === key)));
    if (mode === 'month') {
      const y = key.slice(0, 4);
      nav.querySelectorAll('.tl-year').forEach(el => el.classList.toggle('open', el.dataset.year === y));
    }
  }

  function applyTag() {
    root.querySelectorAll('.book').forEach(el => el.classList.toggle('dim', !!tag && !books.get(el.dataset.slug).tags.includes(tag)));
  }

  function reshelf(next) {
    if (next === mode) return;
    const before = new Map([...root.querySelectorAll('.book')].map(el => [el.dataset.slug, el.getBoundingClientRect()]));
    mode = next;
    prefs.set('shelveBy', mode);
    bar.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    draw();
    scrollTo(0, 0);
    if (reduceMotion()) return;
    root.querySelectorAll('.month-head').forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 380, fill: 'backwards' }));
    let i = 0;
    for (const el of root.querySelectorAll('.book')) {
      const r = el.getBoundingClientRect();
      if (r.top > innerHeight + 60 || r.bottom < -60) continue;
      let from = before.get(el.dataset.slug);
      if (!from || from.top > innerHeight || from.bottom < 0) {
        from = { left: r.left + (Math.random() - 0.5) * 240, top: innerHeight + 30 + Math.random() * 80 };
      }
      const dx = from.left - r.left, dy = from.top - r.top;
      const tilt = (Math.random() - 0.5) * 10;
      el.style.zIndex = '5';
      el.animate([
        { transform: `translate3d(${dx}px, ${dy}px, 0)` },
        { transform: `translate3d(${dx}px, ${dy - 16}px, 60px) rotate(${tilt}deg)`, offset: 0.2 },
        { transform: `translate3d(0, -22px, 60px) rotate(${-tilt / 2}deg)`, offset: 0.82 },
        { transform: 'translate3d(0, 0, 0)' },
      ], { duration: 950, delay: Math.min(i++ * 14, 420), easing: 'cubic-bezier(.45,0,.2,1)', fill: 'backwards' })
        .finished.then(() => { el.style.zIndex = ''; }, () => {});
    }
  }

  const { target } = draw();

  bar.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) reshelf(b.dataset.mode); });

  let saved = null;
  try { saved = sessionStorage.getItem('sl.libScroll'); } catch { /* ignore */ }
  requestAnimationFrame(() => {
    if (saved != null) scrollTo(0, +saved);
    else if (target) {
      const el = root.querySelector('#grp-' + slugify(target.key));
      if (el && el !== root.querySelector('.month')) el.scrollIntoView({ block: 'start' });
    }
  });
  let scrollT;
  const onScroll = () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(() => { try { sessionStorage.setItem('sl.libScroll', String(scrollY)); } catch { /* ignore */ } }, 150);
  };
  addEventListener('scroll', onScroll, { passive: true });
  let rz, lastW = innerWidth;
  const onResize = () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rz); rz = setTimeout(draw, 200); };
  addEventListener('resize', onResize);

  root.addEventListener('click', e => {
    const nav = e.target.closest('.month-nav a');
    if (nav) {
      e.preventDefault();
      root.querySelector(nav.getAttribute('href')).scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    const t = e.target.closest('[data-tag]');
    if (t) {
      tag = t.dataset.tag || null;
      root.querySelectorAll('[data-tag]').forEach(x => x.setAttribute('aria-pressed', String((x.dataset.tag || null) === tag)));
      applyTag();
      return;
    }
    const el = e.target.closest('.book');
    if (!el || el.dataset.status !== 'ready') return;
    pullOut(el, books.get(el.dataset.slug), go);
  });

  return () => {
    spy?.disconnect();
    bar.innerHTML = '';
    removeEventListener('scroll', onScroll);
    if (scrollT) { clearTimeout(scrollT); try { sessionStorage.setItem('sl.libScroll', String(scrollY)); } catch { /* ignore */ } }
    removeEventListener('resize', onResize);
    dropFlight();
  };
}

// Put an open book away at once (the view that pulled it out is going).
export function dropFlight() { if (flight && !flight.opening) closeFlight(true); }

function timeline(groups, mode) {
  if (mode !== 'month') {
    return `<nav class="month-nav" aria-label="Shelves">${groups.map(g =>
      `<a href="#grp-${slugify(g.key)}" data-group="${esc(g.key)}">${esc(g.nav)}</a>`).join('')}</nav>`;
  }
  const years = new Map();
  for (const g of groups) { const y = g.key.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(g); }
  return `<nav class="month-nav timeline" aria-label="Shelves by month">${[...years].map(([y, gs]) => `
    <div class="tl-year" data-year="${y}">
      <a class="tl-y" href="#grp-${slugify(gs[0].key)}" data-group="${esc(gs[0].key)}-y">${y}</a>
      <div class="tl-months">${gs.map(g => `<a href="#grp-${slugify(g.key)}" data-group="${esc(g.key)}" title="${esc(g.big)} ${y}">${esc(g.big.slice(0, 3))}</a>`).join('')}</div>
    </div>`).join('')}</nav>`;
}

const slugify = k => String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const yearText = y => (y < 0 ? `c. ${-y} BC` : y < 1000 ? `c. ${y}` : String(y));

function bookHTML(b, shelfH, groupLabel, scale = isNarrow() ? 1.1 : 1.35) {
  const h = Math.round(shelfH * 0.88 * (b.spine?.height || 0.9));
  const t = Math.round((b.spine?.thickness || 22) * scale);
  const w = Math.round(h * 0.68);
  const fs = Math.max(8, Math.min(t * 0.4, 15, (h - 50) / (b.title.length * 0.56))).toFixed(1);
  const p = getProgress(b.slug);
  const ready = b.status === 'ready';
  const label = `${b.title}${b.vol ? `, volume ${b.vol} of ${b.vols},` : ''} by ${b.author}${ready ? '' : `, ${groupLabel}, coming soon`}`;
  return `
  <button class="book" type="button" data-slug="${b.slug}" data-status="${b.status}"
    style="--h:${h}px;--t:${t}px;--w:${w}px;--fs:${fs}px;--c:${b.spine?.color};--a:${b.cover?.accent}"
    aria-label="${esc(label)}" ${ready ? '' : 'aria-disabled="true"'}>
    <span class="book-3d">
      ${ready ? `<span class="face back"></span>
      <span class="face top"></span>
      <span class="face cover">${coverHTML(b)}</span>` : ''}
      <span class="face spine">${spineHTML(b)}</span>
      ${p && !p.done ? '<span class="face ribbon"></span>' : ''}
      ${p && p.done ? '<span class="face done-mark"></span>' : ''}
    </span>
  </button>`;
}

function spineHTML(b) {
  const vol = b.vol ? `<span class="spine-vol">${roman(b.vol)}</span>` : '';
  return `<span class="spine-title">${esc(b.title)}</span>${vol}<span class="spine-author">${esc(initials(b.author))}</span>`;
}

/* ---------------- pull-out ---------------- */

// el: the element the book flies out of (a shelf spine, or a stand-in at a graph node) carrying --h/--t/--w.
// extra: HTML placed above the actions (the graph lists the books this one talks to); a [data-pick] button in it
// puts the book back, then calls onPick with its value.
export function pullOut(el, book, go, extra = '', onPick = null) {
  if (flight) return;
  const layer = document.getElementById('flight-layer');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const h = parseFloat(cs.getPropertyValue('--h')), t = parseFloat(cs.getPropertyValue('--t')), w = parseFloat(cs.getPropertyValue('--w'));
  const vw = innerWidth, vh = innerHeight;
  const narrow = vw < 760;
  const Hf = narrow ? Math.min(vh * 0.46, 340) : Math.min(vh * 0.62, 470);
  const k = Hf / h;
  const tf = t * k, wf = w * k;

  let cx, cy, infoStyle;
  if (narrow) {
    cx = vw / 2; cy = Math.max(24, vh * 0.06) + Hf / 2 + 8;
    infoStyle = `left:16px; right:16px; width:auto; top:${cy + Hf / 2 + 28}px`;
  } else {
    const groupW = wf + 56 + 340;
    const x0 = Math.max(24, (vw - groupW) / 2);
    cx = x0 + wf / 2; cy = vh / 2;
    infoStyle = `left:${x0 + wf + 56}px; top:${cy}px; transform: translateY(-50%)`;
  }

  const p = getProgress(book.slug);
  const started = p && p.para > 1 && !p.done;
  layer.innerHTML = `
    <div class="flight-backdrop"></div>
    <div class="frig"><div class="fbook" style="--fs:${Math.min(tf * 0.4, (Hf - 60) / (book.title.length * 0.56))}px;--h:${Hf}px;--t:${tf}px;--w:${wf}px;--c:${book.spine.color};--a:${book.cover.accent};left:${cx - tf / 2}px;top:${cy - Hf / 2}px">
      <span class="book-3d">
        <span class="face back"></span>
        <span class="face top"></span>
        <span class="face cover">
          <span class="title-page"><span class="tt">${esc(book.title)}</span>${book.vol ? `<span class="tv">${volOf(book)}</span>` : ''}<hr><span class="ta">${esc(book.author)}</span></span>
          <span class="cover-board">${coverHTML(book)}<span class="endpaper"></span></span>
        </span>
        <span class="face spine">${spineHTML(book)}</span>
      </span>
    </div></div>
    <section class="flight-info" style="${infoStyle}" role="dialog" aria-modal="true" aria-labelledby="fi-title">
      <h2 id="fi-title">${esc(book.title)}</h2>
      ${book.vol ? `<p class="vol">${volOf(book)}</p>` : ''}
      <p class="by">${esc(book.author)}, ${yearText(book.year)}</p>
      <dl>
        <dt>Genre</dt><dd>${esc(book.genre)}</dd>
        <dt>Level</dt><dd>${book.level} of 5</dd>
        <dt>Length</dt><dd>${book.words.toLocaleString('en-US')} words, about ${book.minutes} min</dd>
        ${p ? `<dt>Progress</dt><dd>${p.done ? 'Finished' : `${p.pct}%`}<div class="meter"><i style="width:${p.done ? 100 : p.pct}%"></i></div></dd>` : ''}
      </dl>
      ${extra}
      <div class="actions">
        <button class="btn primary" data-act="read">${started ? 'Continue reading' : 'Read'}</button>
        ${started || (p && p.done) ? '<button class="btn ghost" data-act="restart">From the beginning</button>' : ''}
      </div>
    </section>
    <button class="flight-close" data-act="close" aria-label="Put the book back">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>`;

  const fb = layer.querySelector('.fbook');
  const s = 1 / k;
  const dx = (r.left + r.width / 2) - cx, dy = (r.top + r.height / 2) - cy;
  const zc = (wf / 2) * (1 - s);
  const from = `translate3d(${dx}px,${dy}px,${zc}px) scale3d(${s},${s},${s}) rotateY(0deg)`;
  const lift = `translate3d(${dx}px,${dy - 8}px,${zc + 70}px) scale3d(${s},${s},${s}) rotateY(-6deg)`;
  const to = `translate3d(0px,0px,${wf / 2}px) scale3d(1,1,1) rotateY(-90deg)`;

  flight = { el, layer, fb, from, lift, to, book, go, prevFocus: document.activeElement };
  el.classList.add('is-out');
  layer.classList.add('active');
  document.body.style.overflow = 'hidden';

  const done = () => {
    fb.style.transform = to;
    layer.classList.add('show-info');
    layer.querySelector('[data-act="read"]').focus({ preventScroll: true });
  };
  if (reduceMotion()) { done(); }
  else {
    fb.style.transform = from;
    fb.animate([{ transform: from }, { transform: lift, offset: 0.28 }, { transform: to }],
      { duration: 950, easing: 'cubic-bezier(.3,.6,.2,1)', fill: 'forwards' }).finished.then(done, () => {});
  }

  layer.onclick = e => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { closeFlight().then(() => onPick?.(pick.dataset.pick)); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'read') openBook(false);
    else if (act === 'restart') openBook(true);
    else if (act === 'close' || e.target.classList.contains('flight-backdrop')) closeFlight();
  };
  layer.onkeydown = e => {
    if (e.key === 'Escape') closeFlight();
    if (e.key === 'Tab') { // keep focus inside
      const f = [...layer.querySelectorAll('button')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
}

// Read: the cover swings open, then the reader is drawn under the layer and the open book flies to it, its title page
// landing on the reader's first page as that page shows through.
function openBook(restart) {
  const { layer, fb, book, go } = flight;
  flight.opening = true;
  layer.classList.remove('show-info');
  const board = fb.querySelector('.cover-board');
  const enter = () => {
    sessionStorage.setItem('sl.openFrom', location.hash.startsWith('#/graph') ? 'graph' : 'shelf');
    go(`#/read/${book.slug}${restart ? '/1' : ''}`);
  };
  const fadeAway = (ms = 380) => layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduceMotion() ? 1 : ms, easing: 'ease-out', fill: 'forwards' })
    .finished.then(() => clear(false), () => clear(false));
  if (reduceMotion()) { enter(); fadeAway(); return; }

  const swing = { duration: 720, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' };
  board.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-168deg)' }], swing);
  fb.animate([{ transform: flight.to }, { transform: flight.to.replace('scale3d(1,1,1)', 'scale3d(1.04,1.04,1.04)') }], swing)
    .finished.then(async () => {
      enter();
      const sheet = await firstSheet();
      if (!sheet || !flight) { fadeAway(); return; }
      land(sheet);
    }, () => {});
}

// The reader's first page once it has its place (the reader lays its sheets out after its first frame).
function firstSheet(timeout = 2500) {
  const t0 = performance.now();
  return new Promise(res => {
    const look = () => {
      const s = document.querySelector('#view .ereader .sheet.s1');
      const r = s?.getBoundingClientRect();
      if (r && r.width > 40 && r.height > 40) requestAnimationFrame(() => requestAnimationFrame(() => res(s)));
      else if (performance.now() - t0 > timeout) res(null);
      else requestAnimationFrame(look);
    };
    look();
  });
}

function land(sheet) {
  const { layer, fb } = flight;
  const rig = layer.querySelector('.frig');
  const tpEl = fb.querySelector('.title-page');
  const tp = tpEl.getBoundingClientRect(), to = sheet.getBoundingClientRect();
  const kx = to.width / tp.width, ky = to.height / tp.height;
  const tx = to.left - kx * tp.left, ty = to.top - ky * tp.top;
  const ease = 'cubic-bezier(.55,0,.15,1)', D = 680;
  layer.querySelector('.flight-backdrop').animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * .8, easing: 'ease-in', fill: 'forwards' });
  // the boards, spine and endpapers fall away; the title page whitens into the reader's paper
  fb.querySelectorAll('.cover-board, .face:not(.cover)').forEach(el =>
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * .55, easing: 'ease-out', fill: 'forwards' }));
  [...tpEl.children].forEach(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * .5, easing: 'ease-out', fill: 'forwards' }));
  const wash = document.createElement('span');
  wash.className = 'tp-wash';
  tpEl.append(wash);
  wash.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D * .7, easing: 'ease-in-out', fill: 'forwards' });
  rig.animate([{ transform: 'none' }, { transform: `translate(${tx}px, ${ty}px) scale(${kx}, ${ky})` }], { duration: D, easing: ease, fill: 'forwards' })
    .finished.then(() => layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }).finished)
    .then(() => clear(false), () => clear(false));
}

function closeFlight(immediate = false) {
  if (!flight) return Promise.resolve();
  const { layer, fb, from, to, lift } = flight;
  layer.classList.remove('show-info');
  layer.querySelector('.flight-backdrop').style.opacity = '0';
  if (immediate || reduceMotion()) { clear(true); return Promise.resolve(); }
  return fb.animate([{ transform: to }, { transform: lift, offset: 0.72 }, { transform: from }],
    { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.then(() => clear(true), () => {});
}

function clear(restoreFocus) {
  if (!flight) return;
  const { layer, el, prevFocus } = flight;
  el.classList.remove('is-out');
  layer.classList.remove('active', 'show-info');
  layer.innerHTML = '';
  layer.getAnimations?.().forEach(a => a.cancel());
  layer.style.opacity = '';
  layer.onclick = layer.onkeydown = null;
  document.body.style.overflow = '';
  flight = null;
  if (restoreFocus && prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
}
