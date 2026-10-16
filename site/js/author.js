import { esc, genreInk } from './art.js';
import { readingType } from './reader.js';
import { bookHTML, wireBooks, dropFlight } from './library.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const life = a => (a.born || a.died ? `${a.born || '?'}–${a.died || ''}` : '');
const surnameKey = a => (a.heading || a.name).split(',')[0].normalize('NFD').replace(/[̀-ͯ]/g, '');
const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10]);
const yearOf = a => parseInt(String(a.born || '').replace(/\D.*$/, ''), 10) || null;

// An author's books on the shelves, one per work (a novel in volumes is its first volume), oldest first.
function worksOf(a, libBy) {
  const seen = new Set(), out = [];
  a.books.map(s => libBy.get(s)).filter(Boolean).sort((x, y) => (+x.year || 0) - (+y.year || 0)).forEach(b => {
    const k = b.series || b.slug;
    if (!seen.has(k)) { seen.add(k); out.push(b); }
  });
  return out;
}

// An author's card: a small shelf of their books (cream, or black for essential reading, each with its genre band),
// the name, the dates, a line about them, and how many books.
function cardHTML(a, libBy, { big = false, link = true } = {}) {
  const works = worksOf(a, libBy), must = works.filter(b => b.essential).length;
  const minis = works.slice(0, big ? 24 : 14).map(b => `<i class="ms${b.essential ? ' must' : ''}" style="--g:${genreInk(b.genre)};--mw:${Math.round(Math.max(7, Math.min(16, (b.spine?.thickness || 22) * 0.36)))}px" title="${esc(b.title)}"></i>`).join('');
  const meta = `${works.length} ${works.length === 1 ? 'book' : 'books'}${must ? ` · ${must} essential` : ''}`;
  const inner = `<span class="ac-shelf" aria-hidden="true">${minis}</span>
    <span class="ac-name">${esc(a.name)}</span>${life(a) ? `<span class="ac-life">${esc(life(a))}</span>` : ''}
    ${a.lede ? `<span class="ac-lede">${esc(a.lede)}</span>` : ''}<span class="ac-meta">${meta}</span>`;
  return link ? `<a class="acard${big ? ' big' : ''}" href="#/author/${esc(a.slug)}" data-slug="${esc(a.slug)}">${inner}</a>`
    : `<div class="acard${big ? ' big' : ''}">${inner}</div>`;
}

// Each section's header pins under the bars while its cards pass and the next one pushes it off; pinned, its title
// settles smaller (as on the shelves).
function pinHeads(root, ctl) {
  const top = Math.round((document.querySelector('.topbar')?.getBoundingClientRect().height || 56) + (root.querySelector('.authors-bar')?.getBoundingClientRect().height || 0));
  root.querySelector('.library').style.setProperty('--stick', `${top}px`);
  const io = new IntersectionObserver(es => es.forEach(e => {
    e.target.nextElementSibling.classList.toggle('pinned', !e.isIntersecting && e.boundingClientRect.top < top - 2);
  }), { rootMargin: `-${top - 2}px 0px 0px 0px` });
  root.querySelectorAll('.pin-mark').forEach(m => {
    io.observe(m);
    const h = m.nextElementSibling;
    h.style.setProperty('--shrink', `${Math.round(h.querySelector('h2').offsetWidth * 0.38)}px`);
  });
  ctl.signal.addEventListener('abort', () => io.disconnect());
}

/* ---------------- #/authors: every author, as cards ---------------- */
export function renderAuthors(root, index, lib) {
  const libBy = new Map(lib.books.map(b => [b.slug, b]));
  const authors = index.filter(a => a.books.length);
  let order = 'name', query = '';
  const ctl = new AbortController(), on = { signal: ctl.signal };
  const groups = () => {
    const m = new Map();
    const list = authors.filter(a => !query || fold(a.name).includes(query) || fold(a.lede).includes(query)
      || worksOf(a, libBy).some(b => fold(b.title).includes(query)));
    if (order === 'name') {
      list.sort((x, y) => surnameKey(x).localeCompare(surnameKey(y)));
      list.forEach(a => { const k = surnameKey(a)[0].toUpperCase(); if (!m.has(k)) m.set(k, { k, t: k, list: [] }); m.get(k).list.push(a); });
    } else {
      list.sort((x, y) => (yearOf(x) ?? -1e4) - (yearOf(y) ?? -1e4) || x.name.localeCompare(y.name));
      list.forEach(a => {
        const y = yearOf(a), c = y == null ? 'Antiquity' : y < 1700 ? 'Before 1700' : `Born in the ${ordinal(Math.floor(y / 100) + 1)} century`;
        const k = y == null ? '0' : y < 1700 ? '1' : String(Math.floor(y / 100));
        if (!m.has(k)) m.set(k, { k, t: c, list: [] }); m.get(k).list.push(a);
      });
    }
    return [...m.values()];
  };
  function draw() {
    const gs = groups(), n = gs.reduce((t, g) => t + g.list.length, 0);
    root.querySelector('.authors-sections').innerHTML = gs.length ? gs.map(g => `
      <section class="month">
        <i class="pin-mark" aria-hidden="true"></i>
        <header class="month-head"><h2>${esc(g.t)}</h2><span class="m"><p>${g.list.length} ${g.list.length === 1 ? 'author' : 'authors'}</p></span></header>
        <div class="acards">${g.list.map(a => cardHTML(a, libBy)).join('')}</div>
      </section>`).join('') : '<p class="authors-none">No author matches.</p>';
    root.querySelector('.authors-count').textContent = `${n} ${n === 1 ? 'author' : 'authors'}`;
    pinHeads(root, ctl);
  }
  root.innerHTML = `
  <div class="library authors-page">
    <header class="authors-top">
      <h1>Authors</h1>
      <p class="authors-count"></p>
    </header>
    <div class="authors-bar tagbar">
      <label class="shelf-search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4 4" stroke-linecap="round"/></svg>
        <input type="search" placeholder="Find an author or a book" autocomplete="off" aria-label="Find an author or a book"><span class="n"></span></label>
      <div class="arrange seg" role="group" aria-label="Order authors by">
        <button class="chip" data-order="name" aria-pressed="true">A–Z</button><button class="chip" data-order="era" aria-pressed="false">By era</button>
      </div>
    </div>
    <div class="authors-sections"></div>
  </div>`;
  draw();
  let typing = 0;
  root.addEventListener('input', e => {
    if (!e.target.matches('.authors-bar input')) return;
    clearTimeout(typing); typing = setTimeout(() => { query = fold(e.target.value.trim()); draw(); }, 140);
  }, on);
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-order]');
    if (!b || b.dataset.order === order) return;
    order = b.dataset.order;
    root.querySelectorAll('[data-order]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    draw(); scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, on);
  scrollTo(0, 0);
  return () => { clearTimeout(typing); ctl.abort(); };
}

/* ---------------- #/author/<slug>: the card, the author's shelf, the essay ---------------- */
// The essay (site/data/authors/<slug>.json, built from content/authors/<slug>.md) is set in the reader's type at the
// reader's measure, scrolled rather than paged. Its HTML fields come escaped from the build.
export function renderAuthor(root, doc, { entry = null, lib = null, go } = {}) {
  const t = readingType();
  const libBy = new Map((lib?.books || []).map(b => [b.slug, b]));
  const a = entry || { slug: doc.slug, name: doc.name, born: doc.born, died: doc.died, lede: '', books: [] };
  const shelf = lib ? a.books.map(s => libBy.get(s)).filter(Boolean).sort((x, y) => (+x.year || 0) - (+y.year || 0) || (x.vol || 0) - (y.vol || 0)) : [];
  const sid = title => `a-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const parts = [...doc.sections.map(s => s.title), doc.books.length && 'In this library', doc.sources.length && 'Sources'].filter(Boolean);
  root.innerHTML = `
  <div class="apage">
    <aside class="apage-side">
      ${cardHTML(a, libBy, { big: true, link: false })}
      <nav class="apage-links"><a href="#/authors">All authors</a><a href="${esc(doc.graph)}">In the graph</a></nav>
    </aside>
    <div class="apage-main">
      ${shelf.length ? `<section class="apage-shelf" aria-label="On the shelf">
        <h2 class="apage-h">On the shelf</h2>
        <div class="library apage-lib"><div class="shelf-rows">${shelf.map(b => bookHTML(b)).join('')}</div></div>
      </section>` : ''}
      <article class="adoc" style="--fs:${t.fs}px;--lh:${t.lh};--align:${t.align};--m:${t.margin}px">
        <header class="adoc-head">
          <h1>${esc(doc.name)}</h1>
          ${life(doc) ? `<p class="adoc-dates">${esc(life(doc))}</p>` : ''}
          <nav class="adoc-toc" aria-label="Sections">${parts.map(p => `<a href="#${sid(p)}" data-jump="${sid(p)}">${esc(p)}</a>`).join('')}</nav>
        </header>
        <div class="adoc-lead">${doc.intro.map(p => `<p>${p}</p>`).join('')}</div>
        ${doc.sections.map(s => `<section id="${sid(s.title)}"><h2>${esc(s.title)}</h2>${s.paras.map(p => `<p>${p}</p>`).join('')}</section>`).join('')}
        ${doc.books.length ? `<section id="${sid('In this library')}"><h2>In this library</h2><ul class="adoc-books">${doc.books.map(b => `
          <li>
            <p class="adoc-book"><a href="${esc(b.read)}"><i>${esc(b.title)}</i></a>${b.year ? `<span>${esc(String(b.year))}</span>` : ''}</p>
            <p>${b.html}</p>
            <p class="adoc-go"><a href="${esc(b.read)}">Read</a><a href="${esc(b.graph)}">In the graph</a></p>
          </li>`).join('')}</ul></section>` : ''}
        ${doc.sources.length ? `<section id="${sid('Sources')}" class="adoc-sources"><h2>Sources</h2><ol>${doc.sources.map(s => `<li>${s}</li>`).join('')}</ol></section>` : ''}
      </article>
    </div>
  </div>`;
  scrollTo(0, 0);
  const ctl = new AbortController();
  // Section links scroll within the page; the hash stays the route.
  root.addEventListener('click', e => {
    const j = e.target.closest('[data-jump]');
    if (!j) return;
    e.preventDefault();
    root.querySelector(`#${j.dataset.jump}`)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, { signal: ctl.signal });
  // The books on the author's shelf rise when pointed at and come out when clicked, as on the shelves.
  const wired = shelf.length && go ? wireBooks(root, libBy, go) : null;
  return () => { ctl.abort(); wired?.off(); dropFlight(); };
}
