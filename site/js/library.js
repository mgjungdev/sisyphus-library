import { coverHTML, initials, esc } from './art.js';
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
  function draw() {
    const shelfH = isNarrow() ? 214 : 262;
    const scale = isNarrow() ? 1.1 : 1.35;
    const pad = Math.min(48, Math.max(16, innerWidth * 0.04));
    const rowW = innerWidth > 860
      ? Math.min(innerWidth, 1180) - 2 * pad - Math.min(380, Math.max(240, innerWidth * 0.26)) - Math.min(96, Math.max(32, innerWidth * 0.06)) - 36
      : innerWidth - 2 * pad - 16;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const groups = groupBooks(lib, mode);
    const target = mode === 'month' ? (groups.find(g => g.key >= thisMonth) || groups[groups.length - 1]) : null;

    const ledges = g => {
      const rows = [[]];
      let w = 0;
      for (const b of g.books) {
        const t = b.spine.thickness * scale + 4;
        if (w + t > rowW && rows[rows.length - 1].length) { rows.push([]); w = 0; }
        rows[rows.length - 1].push(b); w += t;
      }
      return rows.map(r => `<div class="ledge-wrap"><div class="shelf-row">${r.map(b => bookHTML(b, shelfH, g.big)).join('')}</div><div class="ledge"></div></div>`).join('');
    };
    const indexItem = b => {
      const cls = tag && !b.tags.includes(tag) ? ' class="off"' : '';
      if (b.status !== 'ready') return `<li${cls} data-slug="${b.slug}"><div class="planned"><span class="t">${esc(b.title)}</span><span class="a">${esc(b.author)}, ${yearText(b.year)}</span></div></li>`;
      const p = getProgress(b.slug);
      const right = p?.done ? 'Finished' : p ? `${p.pct}%` : `${b.minutes} min`;
      return `<li${cls} data-slug="${b.slug}"><button type="button" data-open="${b.slug}">
        <span class="t">${esc(b.title)}</span><span class="a">${esc(b.author)}, ${yearText(b.year)}</span><span class="r">${right}</span>
        ${p && !p.done ? `<span class="bar"><i style="width:${p.pct}%"></i></span>` : ''}
      </button></li>`;
    };

    root.innerHTML = `
    <div class="library" data-mode="${mode}">
      <div class="tagbar" role="group" aria-label="Show stories tagged">
        <button class="chip" data-tag="" aria-pressed="${!tag}">All stories</button>
        ${tags.map(t => `<button class="chip" data-tag="${esc(t)}" aria-pressed="${tag === t}">${esc(t)}</button>`).join('')}
      </div>
      ${groups.map(g => `
      <section class="month${g === target ? ' is-current' : ''}${g.long ? ' long' : ''}" id="grp-${slugify(g.key)}" data-group="${esc(g.key)}" aria-label="${esc(g.big)}">
        <header class="month-head">
          <h2><span class="m">${esc(g.big)}</span>${g.small ? `<span class="y">${esc(g.small)}</span>` : ''}</h2>
          <p>${summary(g)}</p>
        </header>
        <div class="month-body">
          ${ledges(g)}
          <ul class="book-index">${g.books.map(indexItem).join('')}</ul>
        </div>
      </section>`).join('')}
    </div>
    <nav class="month-nav" aria-label="Shelves">
      ${groups.map(g => `<a href="#grp-${slugify(g.key)}" data-group="${esc(g.key)}">${esc(g.nav)}</a>`).join('')}
    </nav>`;

    applyTag();
    const shelves = [...root.querySelectorAll('.month')];
    const navLinks = [...root.querySelectorAll('.month-nav a')];
    spy?.disconnect();
    spy = new IntersectionObserver(es => {
      const vis = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) navLinks.forEach(a => a.setAttribute('aria-current', String(a.dataset.group === vis.target.dataset.group)));
    }, { rootMargin: '-45% 0px -45% 0px' });
    shelves.forEach(s => spy.observe(s));
    return { target };
  }

  function applyTag() {
    root.querySelectorAll('.book').forEach(el => el.classList.toggle('dim', !!tag && !books.get(el.dataset.slug).tags.includes(tag)));
    root.querySelectorAll('.book-index li').forEach(li => li.classList.toggle('off', !!tag && !books.get(li.dataset.slug).tags.includes(tag)));
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
    root.querySelectorAll('.month-head, .book-index').forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 380, fill: 'backwards' }));
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
    const idx = e.target.closest('[data-open]');
    const el = idx ? root.querySelector(`.book[data-slug="${idx.dataset.open}"]`) : e.target.closest('.book');
    if (!el || el.dataset.status !== 'ready') return;
    pullOut(el, books.get(el.dataset.slug), go);
  });

  return () => {
    spy?.disconnect();
    bar.innerHTML = '';
    removeEventListener('scroll', onScroll);
    if (scrollT) { clearTimeout(scrollT); try { sessionStorage.setItem('sl.libScroll', String(scrollY)); } catch { /* ignore */ } }
    removeEventListener('resize', onResize);
    if (flight && !flight.opening) closeFlight(true);
  };
}

const slugify = k => String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const yearText = y => (y < 0 ? `c. ${-y} BC` : y < 1000 ? `c. ${y}` : String(y));

function bookHTML(b, shelfH, groupLabel) {
  const h = Math.round(shelfH * 0.88 * (b.spine?.height || 0.9));
  const t = Math.round((b.spine?.thickness || 22) * (isNarrow() ? 1.1 : 1.35));
  const w = Math.round(h * 0.68);
  const fs = Math.max(8, Math.min(t * 0.4, 15, (h - 50) / (b.title.length * 0.56))).toFixed(1);
  const p = getProgress(b.slug);
  const ready = b.status === 'ready';
  const label = `${b.title} by ${b.author}${ready ? '' : `, ${groupLabel}, coming soon`}`;
  return `
  <button class="book" type="button" data-slug="${b.slug}" data-status="${b.status}"
    style="--h:${h}px;--t:${t}px;--w:${w}px;--fs:${fs}px;--c:${b.spine?.color};--a:${b.cover?.accent}"
    aria-label="${esc(label)}" ${ready ? '' : 'aria-disabled="true"'}>
    <span class="book-3d">
      ${ready ? `<span class="face back"></span>
      <span class="face top"></span>
      <span class="face cover">${coverHTML(b)}</span>` : ''}
      <span class="face spine"><span class="spine-title">${esc(b.title)}</span><span class="spine-author">${esc(initials(b.author))}</span></span>
      ${p && !p.done ? '<span class="face ribbon"></span>' : ''}
      ${p && p.done ? '<span class="face done-mark"></span>' : ''}
    </span>
  </button>`;
}

/* ---------------- pull-out ---------------- */

function pullOut(el, book, go) {
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
    <div class="fbook" style="--fs:${Math.min(tf * 0.4, (Hf - 60) / (book.title.length * 0.56))}px;--h:${Hf}px;--t:${tf}px;--w:${wf}px;--c:${book.spine.color};--a:${book.cover.accent};left:${cx - tf / 2}px;top:${cy - Hf / 2}px">
      <span class="book-3d">
        <span class="face back"></span>
        <span class="face top"></span>
        <span class="face cover">
          <span class="title-page"><span class="tt">${esc(book.title)}</span><hr><span class="ta">${esc(book.author)}</span></span>
          <span class="cover-board">${coverHTML(book)}<span class="endpaper"></span></span>
        </span>
        <span class="face spine"><span class="spine-title">${esc(book.title)}</span><span class="spine-author">${esc(initials(book.author))}</span></span>
      </span>
    </div>
    <section class="flight-info" style="${infoStyle}" role="dialog" aria-modal="true" aria-labelledby="fi-title">
      <h2 id="fi-title">${esc(book.title)}</h2>
      <p class="by">${esc(book.author)}, ${yearText(book.year)}</p>
      <dl>
        <dt>Genre</dt><dd>${esc(book.genre)}</dd>
        <dt>Level</dt><dd>${book.level} of 5</dd>
        <dt>Length</dt><dd>${book.words.toLocaleString('en-US')} words, about ${book.minutes} min</dd>
        <dt>Glossary</dt><dd>${book.entries} words and phrases</dd>
        ${p ? `<dt>Progress</dt><dd>${p.done ? 'Finished' : `${p.pct}%`}<div class="meter"><i style="width:${p.done ? 100 : p.pct}%"></i></div></dd>` : ''}
      </dl>
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

function openBook(restart) {
  const { layer, fb, book, go } = flight;
  flight.opening = true;
  layer.classList.remove('show-info');
  const board = fb.querySelector('.cover-board');
  const finish = () => {
    sessionStorage.setItem('sl.openFrom', 'shelf');
    go(`#/read/${book.slug}${restart ? '/1' : ''}`);
    const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduceMotion() ? 1 : 380, easing: 'ease-out', fill: 'forwards' });
    fade.finished.then(() => clear(false), () => clear(false));
  };
  if (reduceMotion()) return finish();
  board.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-168deg)' }], { duration: 800, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
  fb.animate([{ transform: flight.to }, { transform: flight.to.replace('scale3d(1,1,1)', 'scale3d(1.08,1.08,1.08)') }],
    { duration: 800, easing: 'ease-in-out', fill: 'forwards' }).finished.then(finish, () => {});
}

function closeFlight(immediate = false) {
  if (!flight) return;
  const { layer, fb, from, to, lift } = flight;
  layer.classList.remove('show-info');
  layer.querySelector('.flight-backdrop').style.opacity = '0';
  if (immediate || reduceMotion()) return clear(true);
  fb.animate([{ transform: to }, { transform: lift, offset: 0.72 }, { transform: from }],
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
