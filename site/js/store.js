// Local-first store for saved words, reading progress and settings.
// Words + progress sync to a private GitHub repo when a token is set.

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const FILES = { words: 'wordbank.json', progress: 'progress.json' };
const listeners = new Set();
const state = {
  words: LS.get('sl.words', {}),        // key -> {word, headword, book, para, sentence, sense, saved, updated, removed}
  progress: LS.get('sl.progress', {}),  // slug -> {para, pct, done, updated}
  sync: LS.get('sl.sync', null),        // {owner, repo, token}
  shas: LS.get('sl.shas', {}),
  wordsRev: 0,                          // bumped whenever the word bank changes
  status: 'local',                      // local | synced | pending | syncing | offline | error
  error: '',
};

function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return state; }

function now() { return new Date().toISOString(); }
export const keyOf = w => w.toLowerCase().replace(/’/g, "'").trim();

/* ---------- words ---------- */
export function isSaved(word) {
  const r = state.words[keyOf(word)];
  return !!r && !r.removed;
}
export function savedAt(word, slug, para) {
  const r = state.words[keyOf(word)];
  return !!r && !r.removed && r.book === slug && r.para === para;
}
export function savedList() {
  return Object.entries(state.words).filter(([, r]) => !r.removed).map(([k, r]) => ({ key: k, ...r }));
}
export function toggleWord(rec) {
  const k = keyOf(rec.headword);
  const cur = state.words[k];
  if (cur && !cur.removed) {
    state.words[k] = { ...cur, removed: true, updated: now() };
  } else {
    state.words[k] = { ...rec, saved: now(), updated: now(), removed: false };
  }
  state.wordsRev++;
  LS.set('sl.words', state.words);
  schedule('words');
  emit();
  return !(cur && !cur.removed);
}
export function removeWord(key) {
  const cur = state.words[key];
  if (!cur) return;
  state.words[key] = { ...cur, removed: true, updated: now() };
  state.wordsRev++;
  LS.set('sl.words', state.words);
  schedule('words');
  emit();
}

/* ---------- progress ---------- */
export function getProgress(slug) { return state.progress[slug] || null; }
let progressTimer = null, progressWrite = null;
const flushProgress = () => {
  if (!progressWrite) return;
  clearTimeout(progressWrite); progressWrite = null;
  LS.set('sl.progress', state.progress);
};
addEventListener('pagehide', flushProgress);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushProgress(); });
export function setProgress(slug, para, pct, total) {
  const prev = state.progress[slug] || {};
  const done = prev.done || para >= total;
  if (prev.para === para && prev.done === done) return;
  state.progress[slug] = { para, pct: Math.max(prev.done ? 100 : 0, Math.round(pct)), done, updated: now() };
  clearTimeout(progressWrite);
  progressWrite = setTimeout(flushProgress, 1000);
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => schedule('progress'), 4000);
}

/* ---------- settings (per device) ---------- */
export const prefs = {
  get: (k, d) => LS.get('sl.pref.' + k, d),
  set: (k, v) => LS.set('sl.pref.' + k, v),
};

/* ---------- GitHub sync ---------- */
export function syncConfig() { return state.sync; }
export function setSyncConfig(cfg) {
  state.sync = cfg;
  if (cfg) LS.set('sl.sync', cfg); else { LS.del('sl.sync'); state.status = 'local'; }
  state.shas = {}; LS.set('sl.shas', {});
  emit();
  if (cfg) return syncAll();
}

const API = 'https://api.github.com';
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
async function gh(path, opts = {}) {
  const { owner, repo, token } = state.sync;
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${path}`, {
    ...opts,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
  return res;
}
async function pull(kind) {
  const res = await gh(FILES[kind]);
  if (res.status === 404) return { data: {}, sha: null };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const j = await res.json();
  return { data: JSON.parse(b64decode(j.content) || '{}'), sha: j.sha };
}
function merge(a, b) { // per-key last-writer-wins on `updated`
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (!out[k] || (v.updated || '') > (out[k].updated || '')) out[k] = v;
  }
  return out;
}
async function syncOne(kind) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await pull(kind);
    const merged = merge(remote.data, state[kind]);
    state[kind] = merge(state[kind], merged);
    if (kind === 'words') state.wordsRev++;
    LS.set('sl.' + kind, state[kind]);
    const body = JSON.stringify(merged, null, 1);
    if (remote.sha && body === JSON.stringify(remote.data, null, 1)) { state.shas[kind] = remote.sha; return; }
    const res = await gh(FILES[kind], {
      method: 'PUT',
      body: JSON.stringify({ message: `Update ${FILES[kind]}`, content: b64encode(body), ...(remote.sha ? { sha: remote.sha } : {}) }),
    });
    if (res.ok) { state.shas[kind] = (await res.json()).content.sha; LS.set('sl.shas', state.shas); return; }
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub ${res.status}`);
  }
  throw new Error('Sync conflict');
}
let timers = {};
let running = null;
function schedule(kind) {
  if (!state.sync) return;
  state.status = 'pending'; emit();
  clearTimeout(timers[kind]);
  timers[kind] = setTimeout(() => runSync([kind]), 2500);
}
async function runSync(kinds) {
  if (!state.sync) return;
  if (!navigator.onLine) { state.status = 'offline'; emit(); return; }
  if (running) { await running.catch(() => {}); }
  state.status = 'syncing'; emit();
  running = (async () => { for (const k of kinds) await syncOne(k); })();
  try {
    await running;
    state.status = 'synced'; state.error = '';
  } catch (e) {
    state.status = 'error'; state.error = e.message || String(e);
  } finally {
    running = null; emit();
  }
}
export function syncAll() { return runSync(['words', 'progress']); }

if (state.sync) {
  state.status = 'pending';
  addEventListener('online', syncAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncAll(); });
  setTimeout(syncAll, 300);
}

export function exportJSON() {
  return JSON.stringify({ exported: now(), words: state.words, progress: state.progress }, null, 1);
}
