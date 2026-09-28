import { coverHTML, initials, esc } from './art.js';
import { getProgress } from './store.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => innerWidth < 640;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let flight = null; // active pull-out state

const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

export function renderLibrary(root, lib, { go }) {
  const shelfH = isNarrow() ? 214 : 262;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const target = lib.shelves.find(s => s.month >= thisMonth) || lib.shelves[lib.shelves.length - 1];

  const summary = s => {
    const ready = s.books.filter(b => b.status === 'ready');
    if (!ready.length) return `${NUM[s.books.length] || s.books.length} ${s.books.length === 1 ? 'story' : 'stories'} planned.`;
    const mins = ready.reduce((n, b) => n + b.minutes, 0);
    return `${NUM[ready.length] || ready.length} ${ready.length === 1 ? 'story' : 'stories'}, about ${mins} minutes of reading.`;
  };
  const indexItem = b => {
    if (b.status !== 'ready') {
      return `<li><div class="planned"><span class="t">${esc(b.title)}</span><span class="a">${esc(b.author)}, ${b.year}</span></div></li>`;
    }
    const p = getProgress(b.slug);
    const right = p?.done ? 'Finished' : p ? `${p.pct}%` : `${b.minutes} min`;
    return `<li><button type="button" data-open="${b.slug}">
      <span class="t">${esc(b.title)}</span><span class="a">${esc(b.author)}, ${b.year}</span><span class="r">${right}</span>
      ${p && !p.done ? `<span class="bar"><i style="width:${p.pct}%"></i></span>` : ''}
    </button></li>`;
  };

  root.innerHTML = `
  <div class="library">
    ${lib.shelves.map(s => {
      const [y, m] = s.month.split('-');
      return `
    <section class="month${s === target ? ' is-current' : ''}" id="shelf-${s.month}" data-month="${s.month}" aria-label="${esc(s.label)}">
      <header class="month-head">
        <h2><span class="m">${MONTHS[+m - 1]}</span><span class="y">${y}</span></h2>
        <p>${summary(s)}</p>
      </header>
      <div class="month-body">
        <div class="ledge-wrap">
          <div class="shelf-row">${s.books.map(b => bookHTML(b, shelfH, s.label)).join('')}</div>
          <div class="ledge"></div>
        </div>
        <ul class="book-index">${s.books.map(indexItem).join('')}</ul>
      </div>
    </section>`;
    }).join('')}
  </div>
  <nav class="month-nav" aria-label="Months">
    ${lib.shelves.map(s => {
      const [y, m] = s.month.split('-');
      return `<a href="#shelf-${s.month}" data-month="${s.month}">${MONTHS[+m - 1].slice(0, 3)} ${y.slice(2)}</a>`;
    }).join('')}
  </nav>`;

  const shelves = [...root.querySelectorAll('.month')];
  const navLinks = [...root.querySelectorAll('.month-nav a')];

  const spy = new IntersectionObserver(es => {
    const vis = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (vis) navLinks.forEach(a => a.setAttribute('aria-current', String(a.dataset.month === vis.target.dataset.month)));
  }, { rootMargin: '-45% 0px -45% 0px' });
  shelves.forEach(s => spy.observe(s));
  navLinks.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    root.querySelector('#shelf-' + a.dataset.month).scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }));

  let saved = null;
  try { saved = sessionStorage.getItem('sl.libScroll'); } catch { /* ignore */ }
  requestAnimationFrame(() => {
    if (saved != null) scrollTo(0, +saved);
    else if (target && shelves.indexOf(root.querySelector('#shelf-' + target.month)) > 0) {
      root.querySelector('#shelf-' + target.month).scrollIntoView({ block: 'start' });
    }
  });
  const onScroll = () => { try { sessionStorage.setItem('sl.libScroll', String(scrollY)); } catch { /* ignore */ } };
  addEventListener('scroll', onScroll, { passive: true });

  const books = new Map(lib.shelves.flatMap(s => s.books).map(b => [b.slug, b]));
  root.addEventListener('click', e => {
    const idx = e.target.closest('[data-open]');
    const el = idx ? root.querySelector(`.book[data-slug="${idx.dataset.open}"]`) : e.target.closest('.book');
    if (!el || el.dataset.status !== 'ready') return;
    pullOut(el, books.get(el.dataset.slug), go);
  });

  return () => {
    spy.disconnect();
    removeEventListener('scroll', onScroll);
    if (flight && !flight.opening) closeFlight(true);
  };
}

function bookHTML(b, shelfH, monthLabel) {
  const h = Math.round(shelfH * 0.88 * (b.spine?.height || 0.9));
  const t = Math.round((b.spine?.thickness || 26) * (isNarrow() ? 1.1 : 1.35));
  const w = Math.round(h * 0.68);
  const fs = Math.max(8.5, Math.min(t * 0.4, 15, (h - 50) / (b.title.length * 0.56))).toFixed(1);
  const p = getProgress(b.slug);
  const ready = b.status === 'ready';
  const label = `${b.title} by ${b.author}${ready ? '' : `, ${monthLabel}`}`;
  return `
  <button class="book" type="button" data-slug="${b.slug}" data-status="${b.status}"
    style="--h:${h}px;--t:${t}px;--w:${w}px;--fs:${fs}px;--c:${b.spine?.color};--a:${b.cover?.accent}"
    aria-label="${esc(label)}" ${ready ? '' : 'aria-disabled="true"'}>
    <span class="book-3d">
      <span class="face back"></span>
      <span class="face top"></span>
      <span class="face cover">${coverHTML(b)}</span>
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
      <p class="by">${esc(book.author)}, ${book.year}</p>
      <dl>
        <dt>Length</dt><dd>${book.words.toLocaleString('en-US')} words · about ${book.minutes} min</dd>
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
