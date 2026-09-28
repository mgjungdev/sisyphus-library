import { esc } from './art.js';
import { openCard, closeCard } from './card.js';
import { getProgress, setProgress, savedAt, prefs, subscribe } from './store.js';

const SIZES = [17, 19, 21, 23];

export function renderReader(root, book, startPara) {
  const total = book.paragraphs.length;
  const size = prefs.get('size', 1);
  const underline = prefs.get('underline', true);

  const tok = (x, pi) => {
    if (typeof x === 'string') return esc(x);
    const [s, l, id] = x;
    const sv = savedAt(l, book.slug, pi) ? ' saved' : '';
    if (id) return `<span class="g${sv}" data-id="${id}" data-h="${esc(l)}" tabindex="0" role="button">${esc(s)}</span>`;
    return `<span class="w${sv}" data-l="${esc(l)}">${esc(s)}</span>`;
  };

  root.innerHTML = `
  <article class="reader${underline ? '' : ' no-underline'}" style="--fs:${SIZES[size]}px">
    <header class="title-block">
      <p class="eyebrow">${esc(book.author)} · ${book.year}</p>
      <h1>${esc(book.title)}</h1>
      <div class="fleuron" aria-hidden="true">❦</div>
    </header>
    <div class="text">
      ${book.paragraphs.map((p, i) => `<p id="p${i + 1}" data-p="${i + 1}">${p.map(x => tok(x, i + 1)).join('')}</p>`).join('\n')}
      <div class="the-end" aria-hidden="true">✦</div>
    </div>
    <section class="story-words" aria-labelledby="sw-h">
      <h2 id="sw-h">Words in this story</h2>
      <ol>
        ${book.order.map(id => {
          const c = book.cards[id];
          return `<li><button class="sw-item" data-goto="${id}">
            <span class="sw-hw">${esc(c.headword)}</span>
            <span class="sw-ko" lang="ko">${esc(c.sense_ko)}</span>
            <span class="sw-syn">${c.synonyms.map(s => esc(s.word)).join(' · ')}</span>
          </button></li>`;
        }).join('')}
      </ol>
    </section>
    <nav class="reader-end">
      <a class="btn" href="#/">Back to the shelves</a>
      <a class="btn ghost" href="#/words">Saved words</a>
    </nav>
  </article>
  <div class="progress" aria-hidden="true"><i></i></div>
  <div class="reader-tools">
    <button class="tool-btn" aria-expanded="false" aria-controls="aa-panel" aria-label="Text settings">Aa</button>
    <div class="aa-panel" id="aa-panel" hidden>
      <div class="row"><span>Size</span>
        <button class="chip" data-size="-1" aria-label="Smaller text">A−</button>
        <button class="chip" data-size="1" aria-label="Larger text">A+</button></div>
      <div class="row"><span>Theme</span>
        ${['auto', 'light', 'sepia', 'dark'].map(t => `<button class="chip" data-theme-set="${t}" aria-pressed="${(prefs.get('theme', 'auto')) === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <div class="row"><span>Glossary marks</span>
        <button class="chip" data-underline aria-pressed="${underline}">${underline ? 'On' : 'Off'}</button></div>
    </div>
  </div>`;

  const article = root.querySelector('.reader');
  const bar = root.querySelector('.progress i');

  // ---- word taps ----
  const openFor = span => {
    const para = +span.closest('p[data-p]').dataset.p;
    openCard({
      anchor: span, book, para,
      surface: span.textContent,
      lemma: span.dataset.l || span.dataset.h,
      id: span.dataset.id || null,
      onNavigate: ref => gotoEntry(ref),
    });
  };
  const gotoEntry = id => {
    const span = article.querySelector(`.g[data-id="${id}"]`);
    if (!span) return;
    closeCard(true);
    span.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => openFor(span), 420);
  };
  article.addEventListener('click', e => {
    const goto = e.target.closest('[data-goto]');
    if (goto) return gotoEntry(goto.dataset.goto);
    const span = e.target.closest('.g, .w');
    if (!span) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 1) return;
    openFor(span);
  });
  article.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('g')) { e.preventDefault(); openFor(e.target); }
  });

  // ---- saved-word highlight stays in sync ----
  const unsub = subscribe(() => {
    article.querySelectorAll('.g, .w').forEach(s => s.classList.toggle('saved', savedAt(s.dataset.h || s.dataset.l, book.slug, +s.parentElement.dataset.p)));
  });

  // ---- progress ----
  const paras = [...article.querySelectorAll('.text p[data-p]')];
  let lastPara = 0;
  const onScroll = () => {
    const h = document.documentElement;
    const textEnd = article.querySelector('.the-end').getBoundingClientRect().top + scrollY - innerHeight;
    const frac = Math.min(1, Math.max(0, scrollY / Math.max(1, textEnd)));
    bar.style.transform = `scaleX(${frac})`;
    // first paragraph whose bottom is below the top bar
    let lo = 0, hi = paras.length - 1, ans = paras.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (paras[mid].getBoundingClientRect().bottom > 80) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
    const cur = frac >= 0.995 ? total : ans + 1;
    if (cur !== lastPara) { lastPara = cur; setProgress(book.slug, cur, (cur / total) * 100, total); }
    void h;
  };
  addEventListener('scroll', onScroll, { passive: true });

  // ---- text settings ----
  const toolsBtn = root.querySelector('.tool-btn'), panel = root.querySelector('.aa-panel');
  toolsBtn.addEventListener('click', () => {
    const open = panel.hidden; panel.hidden = !open; toolsBtn.setAttribute('aria-expanded', String(open));
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.size) {
      const anchorP = paras[Math.max(0, lastPara - 1)];
      const n = Math.min(SIZES.length - 1, Math.max(0, prefs.get('size', 1) + +b.dataset.size));
      prefs.set('size', n); article.style.setProperty('--fs', SIZES[n] + 'px');
      anchorP?.scrollIntoView({ block: 'start' }); scrollBy(0, -80);
    }
    if (b.dataset.themeSet) {
      const t = b.dataset.themeSet; prefs.set('theme', t);
      try { localStorage.setItem('sl.theme', t); } catch { /* ignore */ }
      if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
      panel.querySelectorAll('[data-theme-set]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    }
    if (b.hasAttribute('data-underline')) {
      const on = !prefs.get('underline', true); prefs.set('underline', on);
      article.classList.toggle('no-underline', !on);
      b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'On' : 'Off';
    }
  });
  const outside = e => { if (!panel.hidden && !e.target.closest('.reader-tools')) { panel.hidden = true; toolsBtn.setAttribute('aria-expanded', 'false'); } };
  document.addEventListener('pointerdown', outside);

  // ---- initial position ----
  const saved = getProgress(book.slug);
  const target = startPara || (saved && !saved.done ? saved.para : 1);
  requestAnimationFrame(() => {
    if (target > 1) {
      const p = article.querySelector('#p' + target);
      if (p) { p.scrollIntoView({ block: 'start' }); scrollBy(0, -84); p.classList.add('resume'); setTimeout(() => p.classList.remove('resume'), 2200); }
    } else scrollTo(0, 0);
    onScroll();
  });

  return () => {
    closeCard(true);
    unsub();
    removeEventListener('scroll', onScroll);
    document.removeEventListener('pointerdown', outside);
  };
}
