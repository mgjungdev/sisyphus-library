// Live dictionary lookups for words without a curated card.
// Datamuse (definitions, IPA, synonyms) -> Wiktionary REST fallback. Cached per device.

const mem = new Map();
const CACHE_KEY = 'sl.lookup.v1';
let disk = {};
try { disk = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { disk = {}; }
function remember(k, v) {
  mem.set(k, v);
  disk[k] = v;
  const keys = Object.keys(disk);
  if (keys.length > 600) keys.slice(0, keys.length - 600).forEach(x => delete disk[x]);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(disk)); } catch { /* quota */ }
}

const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: '' };

async function getJSON(url, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function stripHTML(s) {
  const d = document.createElement('div');
  d.innerHTML = s;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

// Datamuse puts stress marks right before the vowel (kˈɑləm); move them to the syllable onset (ˈkɑləm).
const ONSETS = new Set(['pl', 'pr', 'bl', 'br', 'tr', 'dr', 'kl', 'kr', 'gl', 'gr', 'fl', 'fr', 'θr', 'ʃr', 'sp', 'st', 'sk', 'sm', 'sn', 'sl', 'sw', 'tw', 'kw', 'dw', 'spr', 'str', 'skr', 'spl', 'skw']);
const VOW = /[aeiouæɑɒɔəɛɜɪʊʌɚɝyː]/;
function fixStress(ipa) {
  const out = [];
  for (const ch of ipa) {
    if (ch !== 'ˈ' && ch !== 'ˌ') { out.push(ch); continue; }
    let j = out.length;
    while (j > 0 && !VOW.test(out[j - 1]) && !'ˈˌ '.includes(out[j - 1])) j--;
    const cluster = out.slice(j).join('');
    let n = cluster ? 1 : 0;
    for (const len of [3, 2]) {
      const tail = cluster.slice(-len);
      if (cluster.length >= len && (ONSETS.has(tail) || /^(tʃ|dʒ)$/.test(tail))) { n = len; break; }
    }
    out.splice(out.length - n, 0, ch);
  }
  return out.join('');
}

async function datamuse(word) {
  const [meta] = await getJSON(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dpr&ipa=1&max=1`);
  if (!meta || meta.word.toLowerCase() !== word.toLowerCase() || !meta.defs?.length) return null;
  const ipa = (meta.tags || []).find(t => t.startsWith('ipa_pron:'))?.slice(9);
  const defs = meta.defs.slice(0, 4).map(d => {
    const [p, text] = d.split('\t');
    return { pos: POS[p] ?? p, text: text.replace(/^\([^)]*\)\s*/, m => m).trim() };
  });
  return { word: meta.word, ipa: ipa ? `/${fixStress(ipa)}/` : null, defs, source: 'Datamuse' };
}

async function wiktionary(word) {
  const j = await getJSON(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  const en = j.en || [];
  const defs = [];
  for (const block of en) {
    for (const d of block.definitions || []) {
      const text = stripHTML(d.definition);
      if (text) defs.push({ pos: block.partOfSpeech?.toLowerCase() || '', text });
      if (defs.length >= 4) break;
    }
    if (defs.length >= 4) break;
  }
  return defs.length ? { word, ipa: null, defs, source: 'Wiktionary' } : null;
}

export async function define(word) {
  const k = 'd:' + word.toLowerCase();
  if (mem.has(k)) return mem.get(k);
  if (disk[k]) { mem.set(k, disk[k]); return disk[k]; }
  let res = null;
  try { res = await datamuse(word); } catch { /* fall through */ }
  if (!res) { try { res = await wiktionary(word); } catch { /* offline or not found */ } }
  if (res) remember(k, res);
  return res;
}

export async function synonyms(word, exclude = []) {
  const k = 's:' + word.toLowerCase();
  if (mem.has(k)) return mem.get(k);
  if (disk[k]) { mem.set(k, disk[k]); return disk[k]; }
  try {
    const ex = new Set(exclude.map(x => x.toLowerCase()).concat(word.toLowerCase()));
    const list = await getJSON(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=16`);
    let words = list.map(x => x.word).filter(w => !ex.has(w.toLowerCase()) && !w.includes(' '));
    if (words.length < 4) {
      const ml = await getJSON(`https://api.datamuse.com/words?ml=${encodeURIComponent(word)}&max=16`);
      words = [...new Set(words.concat(ml.map(x => x.word).filter(w => !ex.has(w.toLowerCase()) && !w.includes(' '))))];
    }
    words = words.slice(0, 10);
    remember(k, words);
    return words;
  } catch { return null; }
}

export function dictLinks(word) {
  const q = encodeURIComponent(word.toLowerCase());
  const dash = encodeURIComponent(word.toLowerCase().replace(/\s+/g, '-'));
  return [
    { name: 'Cambridge', url: `https://dictionary.cambridge.org/dictionary/english/${dash}` },
    { name: 'Merriam-Webster', url: `https://www.merriam-webster.com/dictionary/${q}` },
    { name: '네이버', url: `https://en.dict.naver.com/#/search?query=${q}` },
    { name: 'Thesaurus', url: `https://www.thesaurus.com/browse/${q}` },
  ];
}
