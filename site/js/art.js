// Inline SVG art: cover motifs (drawn in the cover's gilt colour) and shelf decor.

const S = (vb, body) => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;
const G = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

export const MOTIFS = {
  crown: S('0 0 120 100', `<g ${G}>
    <path d="M20 74l-6-44 26 22 20-32 20 32 26-22-6 44z"/><path d="M22 86h76"/>
    <circle cx="14" cy="28" r="4"/><circle cx="60" cy="16" r="4"/><circle cx="106" cy="28" r="4"/><circle cx="60" cy="60" r="5"/></g>`),
  compass: S('0 0 120 110', `<g ${G}>
    <circle cx="60" cy="55" r="38"/><circle cx="60" cy="55" r="30" opacity=".5"/>
    <path d="M60 25l8 30-8 30-8-30z"/><path d="M30 55l30-8 30 8-30 8z" opacity=".7"/><path d="M60 11v6M60 93v6M16 55h6M98 55h6"/></g>`),
  key: S('0 0 120 100', `<g ${G}>
    <circle cx="34" cy="50" r="16"/><circle cx="34" cy="50" r="6"/><path d="M50 50h54M86 50v14M98 50v10M72 50v8"/></g>`),
  raven: S('0 0 120 100', `<g ${G}>
    <path d="M18 70c12-2 22-8 30-18 6-16 20-26 36-24l12-6-4 10c4 10 0 24-12 32l6 16-12-10c-14 4-34 4-56 0z"/>
    <path d="M58 76l-4 14M70 76l2 14"/><circle cx="84" cy="34" r="1.8" fill="currentColor"/><path d="M96 22l12 2-10 6"/></g>`),
  planet: S('0 0 120 100', `<g ${G}>
    <circle cx="60" cy="50" r="24"/><ellipse cx="60" cy="52" rx="48" ry="12" transform="rotate(-14 60 52)"/>
    <circle cx="18" cy="16" r="2" fill="currentColor"/><circle cx="102" cy="84" r="2" fill="currentColor"/><circle cx="100" cy="18" r="1.4" fill="currentColor"/></g>`),
  mask: S('0 0 120 100', `<g ${G}>
    <path d="M18 26c26 8 58 8 84 0 2 30-8 52-42 56-34-4-44-26-42-56z"/>
    <path d="M36 44c4-4 12-4 16 0M68 44c4-4 12-4 16 0"/><path d="M42 62c10 10 26 10 36 0"/></g>`),
  quill: S('0 0 120 110', `<g ${G}>
    <path d="M96 10C60 18 38 44 30 88c16-20 42-30 52-52 4-10 8-18 14-26z"/><path d="M30 88l-8 14M44 60c10-2 18-8 24-16"/>
    <path d="M18 102h40" opacity=".6"/></g>`),
  swallow: S('0 0 120 90', `<g ${G}>
    <path d="M10 44c18-6 34-4 46 4 8-12 22-20 40-22-8 6-13 12-15 18 10-2 20 0 29 5-12 1-22 5-30 12l-8 18-7-16c-14 2-30-2-55-19z"/>
    <path d="M74 56c6 8 16 14 30 17M78 50c8 4 18 6 30 6"/>
    <circle cx="70" cy="40" r="1.6" fill="currentColor"/></g>`),
  comb: S('0 0 120 90', `<g ${G}>
    <path d="M18 30c0-8 6-12 14-12h56c8 0 14 4 14 12v6H18z"/>
    ${Array.from({ length: 14 }, (_, i) => `<path d="M${24 + i * 5.4} 36v${i % 2 ? 30 : 34}"/>`).join('')}
    <circle cx="44" cy="26" r="3"/><circle cx="60" cy="25" r="3.4"/><circle cx="76" cy="26" r="3"/></g>`),
  tree: S('0 0 120 100', `<g ${G}>
    <path d="M60 92V52M60 64l-14-12M60 58l16-14M60 74l12-8"/>
    <path d="M60 52c-26 2-40-12-32-28 4-8 14-10 18-8 2-10 18-14 26-6 10-4 24 2 24 14 10 4 10 22-6 26-8 4-20 4-30 2z"/>
    <path d="M36 92h48"/></g>`),
  leaf: S('0 0 120 100', `<g ${G}>
    <path d="M60 90c0-30-2-54 0-78 22 12 34 34 26 54-4 12-14 20-26 24zM60 90c-12-4-22-12-26-24-8-20 4-42 26-54"/>
    <path d="M60 30l-12 10M60 44l14-10M60 58l-16 12M60 70l14-10"/></g>`),
  rose: S('0 0 120 110', `<g ${G}>
    <path d="M60 56c-12 0-18-8-16-18 2-8 10-12 16-10 6-2 14 2 16 10 2 10-4 18-16 18z"/>
    <path d="M52 36c4 6 12 6 16 0M50 44c6 6 14 6 20 0"/>
    <path d="M60 56v46M60 76c-8-8-20-8-26-2 8 6 18 6 26 2zM60 88c8-8 20-8 26-2-8 6-18 6-26 2z"/>
    <path d="M60 64l-6 4M60 94l6 4"/></g>`),
  lamp: S('0 0 120 110', `<g ${G}>
    <path d="M60 104V46M50 104h20"/>
    <path d="M44 22h32l-6 24H50z"/><path d="M60 14v8M54 14h12"/>
    <path d="M60 46c-4 4-4 8 0 10"/>
    <path d="M34 34l-8-2M86 34l8-2M40 50l-8 6M80 50l8 6" opacity=".6"/></g>`),
  heart: S('0 0 120 100', `<g ${G}>
    <path d="M60 86C30 66 18 48 22 32c4-14 22-18 38-2 16-16 34-12 38 2 4 16-8 34-38 54z"/>
    <path d="M42 46h10l4-8 6 16 4-8h12"/></g>`),
};

export function coverHTML(book) {
  const motif = MOTIFS[book.cover?.motif] || MOTIFS.leaf;
  return `<span class="cover-art"><span class="ct">${esc(book.title)}</span>${motif}<span class="ca">${esc(book.author)}</span></span>`;
}

export function initials(name) {
  return name.split(/\s+/).map(p => p[0]).filter(c => /[A-Z]/.test(c)).join('.') + '.';
}

export const DECOR = {
  plant: S('0 0 80 120', `
    <path d="M22 84h36l-5 32H27z" fill="#9c5a3c"/><path d="M20 80h40v7H20z" fill="#b56d4b"/>
    <g fill="#5d7a4a"><path d="M40 82c-2-18-14-30-30-34 6 16 16 28 30 34z"/><path d="M40 82c2-22 12-38 30-46-4 20-14 36-30 46z" fill="#6e8f58"/>
    <path d="M40 82c-6-26-2-50 6-70 8 22 6 48-6 70z" fill="#4f6b3e"/><path d="M40 82c-10-10-26-12-36-6 12 8 24 10 36 6z" fill="#6e8f58"/></g>`),
  stack: S('0 0 150 42', `
    <rect x="6" y="28" width="132" height="13" rx="2" fill="#4b5d6e"/><rect x="6" y="31" width="132" height="2" fill="#c9b27a" opacity=".7"/>
    <rect x="14" y="15" width="118" height="13" rx="2" fill="#7a4b3a"/><rect x="14" y="18" width="118" height="2" fill="#d8b877" opacity=".7"/>
    <rect x="10" y="2" width="124" height="13" rx="2" fill="#566b4a"/><rect x="10" y="5" width="124" height="2" fill="#d3bb85" opacity=".7"/>
    <rect x="134" y="4" width="2" height="9" fill="#efe6d2"/><rect x="132" y="17" width="2" height="9" fill="#efe6d2"/>`),
  globe: S('0 0 90 120', `
    <path d="M30 112h30M45 112V96" stroke="#7a5a36" stroke-width="5" stroke-linecap="round"/>
    <circle cx="45" cy="52" r="34" fill="#35566d"/>
    <path d="M26 36c8-4 14 2 20-2 6-4 10 4 16 2M20 58c10 2 14-6 22-2s8 10 18 8c6-2 10 2 12 6M34 76c6-4 10 0 16-2" fill="none" stroke="#c7b37a" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M9 52a36 36 0 0 0 72 0" fill="none" stroke="#b38f4a" stroke-width="4"/>`),
  bookend: S('0 0 40 70', `<path d="M4 68V8c0-4 4-6 8-4l24 14v50z" fill="#6b5a4a"/><path d="M4 68h34v-6H4z" fill="#4a3d31"/>`),
  candle: S('0 0 50 120', `
    <path d="M10 112h30l-4-8H14z" fill="#b08a4a"/><rect x="18" y="52" width="14" height="52" rx="2" fill="#efe3c8"/>
    <path d="M25 52v-6" stroke="#3a2a1a" stroke-width="1.6"/><path d="M25 46c-5-6-2-14 0-20 3 6 6 14 0 20z" fill="#f2b24a"/><path d="M25 44c-2-3-1-7 0-10 1 3 2 7 0 10z" fill="#fff1c2"/>`),
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
