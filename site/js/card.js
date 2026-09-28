import { esc } from './art.js';
import { define, synonyms, dictLinks } from './lookup.js';
import { speak, canSpeak } from './speech.js';
import { isSaved, toggleWord } from './store.js';

const layer = () => document.getElementById('card-layer');
const sheetMode = () => innerWidth < 900 || matchMedia('(pointer: coarse)').matches;
let current = null;

const ICON = {
  speak: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function sentenceAround(text, surface) {
  const parts = text.match(/[^.!?]+[.!?]+[’”"']*\s*|[^.!?]+$/g) || [text];
  const re = new RegExp(`(^|[^\\w’'])${surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w’'])`, 'i');
  return (parts.find(p => re.test(p)) || text).trim();
}

export function openCard({ anchor, book, surface, lemma, id, para, onNavigate }) {
  closeCard(true);
  const card = id ? book.cards[id] : null;
  const headword = card ? card.headword : lemma;
  const paraText = book.paragraphs[para - 1].map(x => (typeof x === 'string' ? x : x[0])).join('');
  const sentence = sentenceAround(paraText, surface);
  const rec = () => ({ headword, word: surface, book: book.slug, title: book.title, para, sentence,
    sense: card ? card.sense_ko || card.sense_en : '' });

  const el = document.createElement('div');
  el.className = 'card' + (sheetMode() ? ' sheet' : ' pop');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', headword);
  el.innerHTML = `
    ${sheetMode() ? '<div class="sheet-handle" aria-hidden="true"></div>' : ''}
    <header class="card-head">
      <div class="hw">
        <h2>${esc(headword)}</h2>
        <p class="meta">${card ? [card.pos, card.ipa].filter(Boolean).map(esc).join(' · ') : `${surface.toLowerCase() !== headword ? `<span class="from">${esc(surface)} →</span> ` : ''}<span class="live-meta"></span>`}</p>
      </div>
      <div class="card-tools">
        ${canSpeak() ? `<button class="icon-btn" data-act="speak" aria-label="Pronounce ${esc(headword)}">${ICON.speak}</button>` : ''}
        <button class="icon-btn star" data-act="save" aria-pressed="${isSaved(headword)}" aria-label="Save ${esc(headword)}">${ICON.star}</button>
        <button class="icon-btn" data-act="close" aria-label="Close">${ICON.close}</button>
      </div>
    </header>
    <div class="card-body">${card ? curated(card, book) : generic()}</div>
    <footer class="card-links">${dictLinks(headword).map(l => `<a href="${l.url}" target="_blank" rel="noopener">${esc(l.name)}${ICON.ext}</a>`).join('')}</footer>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'card-backdrop' + (sheetMode() ? ' dim' : '');
  layer().append(backdrop, el);
  current = { el, backdrop, anchor };
  anchor?.classList.add('is-active');

  if (sheetMode()) requestAnimationFrame(() => { el.classList.add('open'); backdrop.classList.add('open'); });
  else position(el, anchor);

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') closeCard();
    if (act === 'speak') speak(headword);
    if (act === 'save') {
      const on = toggleWord(rec());
      b.setAttribute('aria-pressed', String(on));

    }
    if (act === 'ref') { onNavigate?.(b.dataset.ref); }
    if (act === 'syn-word') speak(b.textContent);
  });
  el.querySelector('details.more')?.addEventListener('toggle', e => {
    if (e.target.open && !e.target.dataset.loaded) loadMore(e.target, headword, card);
  }, { once: false });
  backdrop.addEventListener('click', () => closeCard());
  el.addEventListener('keydown', e => { if (e.key === 'Escape') closeCard(); });
  if (sheetMode()) dragToClose(el);
  el.querySelector('[data-act="close"]').focus({ preventScroll: true });

  if (!card) fillGeneric(el, headword);
}

function curated(c, book) {
  return `
    <section class="sense">
      <p class="en">${esc(c.sense_en)}</p>
      <p class="ko" lang="ko">${esc(c.sense_ko)}</p>
    </section>
    ${c.modern ? `<p class="modern"><span>Today</span>${esc(c.modern)}</p>` : ''}
    ${c.tip_ko ? `<p class="tip" lang="ko">${esc(c.tip_ko)}</p>` : ''}
    <section class="syns">
      <h3>Similar words</h3>
      <ul>${c.synonyms.map(s => `
        <li>
          <div class="syn-head">${s.ref ? `<button class="syn-link" data-act="ref" data-ref="${s.ref}">${esc(s.word)}</button>` : `<b>${esc(s.word)}</b>`}</div>
          <p>${esc(s.nuance)}</p>
          <p class="ex">${esc(s.example)}</p>
        </li>`).join('')}
      </ul>
      <details class="more"><summary>More synonyms</summary><div class="more-list" aria-live="polite"></div></details>
    </section>`;
}

function generic() {
  return `
    <section class="defs" aria-live="polite"><div class="skeleton"></div><div class="skeleton short"></div></section>
    <section class="syns lite"><h3>Similar words</h3><div class="more-list"><div class="skeleton short"></div></div></section>`;
}

async function fillGeneric(el, word) {
  const [d, syn] = await Promise.all([define(word), synonyms(word)]);
  if (!el.isConnected) return;
  const defs = el.querySelector('.defs');
  if (d) {
    if (d.ipa) el.querySelector('.live-meta').textContent = d.ipa;
    defs.innerHTML = `<ol>${d.defs.map(x => `<li>${x.pos ? `<i>${esc(x.pos)}</i> ` : ''}${esc(x.text)}</li>`).join('')}</ol>`;
  } else {
    defs.innerHTML = `<p class="muted">${navigator.onLine ? 'No short definition found.' : 'Offline.'}</p>`;
  }
  const box = el.querySelector('.syns.lite .more-list');
  if (syn?.length) box.innerHTML = chips(syn);
  else el.querySelector('.syns.lite').remove();
  if (!sheetMode()) position(el, current?.anchor);
}

async function loadMore(det, word, card) {
  det.dataset.loaded = '1';
  const box = det.querySelector('.more-list');
  box.innerHTML = '<div class="skeleton short"></div>';
  const list = await synonyms(word.split(' ').length > 1 ? word.split(' ').sort((a, b) => b.length - a.length)[0] : word,
    card.synonyms.map(s => s.word));
  box.innerHTML = list?.length ? chips(list) : `<p class="muted">${navigator.onLine ? 'Nothing more.' : 'Offline.'}</p>`;
}

const chips = list => `<div class="chips">${list.map(w => `<button class="syn-chip" data-act="syn-word">${esc(w)}</button>`).join('')}</div>`;

function position(el, anchor) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const W = Math.min(380, innerWidth - 32);
  el.style.width = W + 'px';
  el.style.maxHeight = '';
  const h = el.offsetHeight;
  const left = Math.min(Math.max(16, r.left + r.width / 2 - W / 2), innerWidth - W - 16);
  const below = innerHeight - r.bottom - 22, above = r.top - 56 - 22;
  let top, maxH;
  if (below >= h || below >= above) { maxH = Math.min(h, below); top = r.bottom + 10; el.dataset.side = 'below'; }
  else { maxH = Math.min(h, above); top = r.top - 10 - maxH; el.dataset.side = 'above'; }
  if (maxH < 240) { maxH = Math.min(h, innerHeight - 80); top = Math.max(64, (innerHeight - maxH) / 2); } // not enough room on either side
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.maxHeight = maxH + 'px';
}

function dragToClose(el) {
  let y0 = null, dy = 0;
  const head = el.querySelector('.sheet-handle');
  const start = e => { if (el.querySelector('.card-body').scrollTop > 0 && !e.target.closest('.sheet-handle, .card-head')) return; y0 = e.clientY; dy = 0; el.style.transition = 'none'; };
  const move = e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); el.style.transform = `translateY(${dy}px)`; };
  const end = () => {
    if (y0 == null) return;
    el.style.transition = ''; y0 = null;
    if (dy > 90) closeCard(); else el.style.transform = '';
  };
  [head, el.querySelector('.card-head')].forEach(h => h?.addEventListener('pointerdown', start));
  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  el._cleanupDrag = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); };
}

export function closeCard(immediate = false) {
  if (!current) return;
  const { el, backdrop, anchor } = current;
  current = null;
  el._cleanupDrag?.();
  anchor?.classList.remove('is-active');
  const remove = () => { el.remove(); backdrop.remove(); };
  if (immediate || !el.classList.contains('sheet')) { remove(); }
  else { el.classList.remove('open'); backdrop.classList.remove('open'); el.style.transform = ''; setTimeout(remove, 260); }
  if (!immediate && anchor?.isConnected) anchor.focus({ preventScroll: true });
}

export const cardOpen = () => !!current;
