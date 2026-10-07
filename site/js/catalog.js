// The relations catalog (site/data/graph.json): indexes and links shared by the graph and the reader.
// ?drafts=1 (kept for the session) loads graph.drafts.json, which also holds proposed records; it exists only in local builds.

let drafts = false;
try {
  if (new URLSearchParams(location.search).has('drafts')) sessionStorage.setItem('sl.drafts', '1');
  drafts = sessionStorage.getItem('sl.drafts') === '1';
} catch { /* storage blocked */ }

let pending = null;
export const isDrafts = () => drafts;

export function loadGraph() {
  return (pending ||= fetch(`data/${drafts ? 'graph.drafts.json' : 'graph.json'}`)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(index));
}

function index(d) {
  const G = {
    nodes: new Map(), notes: [], readings: new Map(), glosses: new Map(), glossesBySlug: new Map(),
    out: new Map(), in: new Map(), edges: [], dossiers: new Map(), contexts: {}, slugs: {}, sources: new Map(),
    collate: {}, vocab: {}, textsOf: new Map(), books: [], authors: [], authorLinks: [],
  };
  if (!d) return G;
  Object.assign(G, { contexts: d.contexts, slugs: d.slugs, collate: d.collate || {}, vocab: d.vocab || {}, edges: d.edges, notes: d.notes });
  d.nodes.forEach(n => G.nodes.set(n.id, n));
  // Book nodes: every readable book is a work with slugs, spine, accent, genre, year, degree (its relation count).
  G.books = d.nodes.filter(n => n.kind === 'work' && n.slugs?.length);
  // Author nodes: one person per author of the readable books, with byline, slug, works (oldest first), born and died
  // when registered, and about (the first paragraph of content/authors/<slug>.md) once there is such a page.
  G.authors = d.nodes.filter(n => n.kind === 'person' && n.works?.length);
  G.authorLinks = d.author_links || []; // book -> its author
  d.nodes.filter(n => n.kind === 'text').forEach(t => push(G.textsOf, t.work, t));
  d.sources.forEach(s => G.sources.set(s.id, s));
  d.dossiers.forEach(x => G.dossiers.set(x.work, x));
  d.glosses.forEach(g => { G.glosses.set(g.id, g); push(G.glossesBySlug, g.loc.source, g); });
  d.notes.forEach(n => { push(G.out, n.from, n); push(G.in, n.to, n); });
  d.readings.forEach(r => push(G.readings, r.note.join('|'), r));
  return G;
}

function push(map, key, v) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(v);
}

export const readingsOf = (G, n) => G.readings.get([n.from, n.to, n.rel].join('|')) || [];

// A passage link: a library slug or a context text (ctx:<id>), at its paragraph when it was found.
export function locHref(G, loc) {
  const slug = loc.source.startsWith('ctx:') ? `ctx-${loc.source.slice(4)}` : loc.source;
  return `#/read/${slug}${loc.para ? `/${loc.para}` : ''}`;
}

// The first library slug that reads a work (its first volume).
export function readSlug(G, workId) {
  if (G.contexts[workId]) return G.contexts[workId];
  return G.nodes.get(workId)?.slugs?.[0] || Object.keys(G.slugs).find(s => G.slugs[s] === workId) || null;
}

export function displayName(name = '') {
  const n = name.replace(/\s*\(.*?\)/g, '');
  const i = n.indexOf(', ');
  return i > 0 ? `${n.slice(i + 2)} ${n.slice(0, i)}` : n;
}

// A registered work names its author by person id; a book's light node carries the name (byline) from books.json.
export const authorOf = (G, work) => work?.byline || displayName(G.nodes.get(work?.author)?.name || work?.author);
export const yearOf = work => work?.year ?? work?.first_pub?.year ?? '';

/* ---------- what each relation says: the one place the site's wording for them lives ---------- */
// A note runs from the newer work to the older one it answers: verb reads from -> to ('X answers Y'), by reads to -> from
// ('Y is answered by X'). modes: one word that narrows the kind, with what it means.
export const RELATION_KINDS = {
  refers: { name: 'Refers to', verb: 'refers to', by: 'referred to by',
    def: 'Names, quotes or alludes to the other book in its own text.',
    modes: { quotes: 'quotes its words', alludes: 'alludes to it', 'diegetic-reading': 'a character reads it' } },
  read: { name: 'Read', verb: 'draws on a reading of', by: 'read by the author of',
    def: 'A letter, journal or library record shows the author read the other book before writing.' },
  rewrites: { name: 'Rewrites', verb: 'rewrites', by: 'rewritten by',
    def: "Takes over another book's plot, characters or scenes and changes them.",
    modes: { continuation: 'carries the story on', parody: 'mocks it', inversion: 'turns it the other way round', transposition: 'moves it to another time or place' } },
  answers: { name: 'Answers', verb: 'answers', by: 'answered by',
    def: 'A different story asking the same question and giving a different answer.' },
  'shares-form': { name: 'Shares form', verb: 'takes its form from', by: 'lends its form to',
    def: 'Inherits a way of telling (a frame, letters, a found manuscript), not the story itself.',
    modes: { frame: 'a story inside a story', epistolary: 'told in letters', 'found-manuscript': 'a found manuscript' } },
};
// Line style: how sure it is that the newer book's author knew the older one.
export const CONTACT_KINDS = {
  documented: { line: 'solid', name: 'Documented contact', def: 'the author is known to have read it' },
  probable: { line: 'dashed', name: 'Probable contact', def: 'a secondary source says the author knew it' },
  none: { line: 'dotted', name: 'No known contact', def: 'the likeness is in the texts alone' },
};
// Line weight: how strong the case for the reading is.
export const CASE_KINDS = {
  strong: { name: 'Strong', def: 'close matches, backed by scholars' },
  moderate: { name: 'Moderate', def: 'clear matches, a fair reading' },
  speculative: { name: 'Speculative', def: 'a likeness, open to doubt' },
};
// Relation colours: light / dark, muted like cloth and ink.
const REL_COLOURS = {
  refers: ['#8e3443', '#e48b98'],
  read: ['#3d6488', '#93b8da'],
  rewrites: ['#9c6a1f', '#e2b467'],
  answers: ['#26705f', '#6cc6ae'],
  'shares-form': ['#6a4c86', '#bba0d8'],
};
export const relColour = (rel, dark) => (REL_COLOURS[rel] || ['#57605c', '#aeb2ad'])[dark ? 1 : 0];
// Whether the page is drawn in a dark theme (night, gray, or auto on a dark system).
export const darkTheme = () => getComputedStyle(document.documentElement).colorScheme === 'dark';
export const relKind = rel => RELATION_KINDS[rel] || { name: rel, verb: rel, by: rel, def: '' };
// The one word that narrows a note's kind (inversion, quotes, …), when there is one.
export const modeOf = note => note?.mode || (note?.modes?.length === 1 ? note.modes[0] : '');
// A title as a sentence names it: "Frankenstein; or, The Modern Prometheus" -> "Frankenstein".
export const plainTitle = (t = '') => t.split(/;|:\s/)[0].trim() || t;
// The sentence parts for a note: { from, verb, to } (titles), with the kind's name, mode and definition.
export function relationSentence(G, note) {
  const k = relKind(note.rel), title = id => plainTitle(G.nodes.get(id)?.title || id);
  return { from: title(note.from), verb: k.verb, to: title(note.to), name: k.name, mode: modeOf(note), def: k.def };
}
