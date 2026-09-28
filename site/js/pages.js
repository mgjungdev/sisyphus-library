import { esc } from './art.js';
import { savedList, removeWord, subscribe, getState, syncConfig, setSyncConfig, syncAll, exportJSON, prefs } from './store.js';
import { speak, canSpeak } from './speech.js';

const STATUS = {
  local: 'On this device only', pending: 'Changes waiting to sync', syncing: 'Syncing…',
  synced: 'Synced with GitHub', offline: 'Offline — will sync later', error: 'Sync error',
};

function statusPill() {
  const s = getState();
  return `<span class="sync-pill" data-s="${s.status}"><i></i>${esc(STATUS[s.status] || s.status)}${s.status === 'error' && s.error ? ` (${esc(s.error)})` : ''}</span>`;
}

/* ---------------- Saved words ---------------- */
export function renderWords(root) {
  let sort = prefs.get('wordsSort', 'recent');
  const draw = () => {
    const list = savedList();
    let groups;
    if (sort === 'recent') groups = [['', list.sort((a, b) => (b.saved || '').localeCompare(a.saved || ''))]];
    else if (sort === 'az') groups = [['', list.sort((a, b) => a.headword.localeCompare(b.headword))]];
    else {
      const m = new Map();
      list.sort((a, b) => (a.para || 0) - (b.para || 0)).forEach(w => { const k = w.title || w.book; m.set(k, [...(m.get(k) || []), w]); });
      groups = [...m.entries()];
    }
    const mark = (sentence, word) => {
      const i = sentence.toLowerCase().indexOf(word.toLowerCase());
      if (i < 0) return esc(sentence);
      return esc(sentence.slice(0, i)) + `<mark>${esc(sentence.slice(i, i + word.length))}</mark>` + esc(sentence.slice(i + word.length));
    };
    root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <h1>Saved words</h1>
        <p class="sub">${list.length} ${list.length === 1 ? 'word' : 'words'} ${statusPill()}</p>
        <div class="seg" role="group" aria-label="Sort">
          ${[['recent', 'Recent'], ['book', 'By story'], ['az', 'A–Z']].map(([k, l]) => `<button class="chip" data-sort="${k}" aria-pressed="${sort === k}">${l}</button>`).join('')}
        </div>
      </header>
      ${list.length ? groups.map(([g, ws]) => `
        ${g ? `<h2 class="group-h">${esc(g)}</h2>` : ''}
        <ul class="word-list">
          ${ws.map(w => `
          <li class="word-item">
            <div class="wi-head">
              <b>${esc(w.headword)}</b>
              ${canSpeak() ? `<button class="icon-btn sm" data-speak="${esc(w.headword)}" aria-label="Pronounce ${esc(w.headword)}"><svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>` : ''}
              <button class="icon-btn sm remove" data-remove="${esc(w.key)}" aria-label="Remove ${esc(w.headword)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            ${w.sense ? `<p class="wi-sense" lang="${/[가-힣]/.test(w.sense) ? 'ko' : 'en'}">${esc(w.sense)}</p>` : ''}
            ${w.sentence ? `<a class="wi-quote" href="#/read/${esc(w.book)}/${w.para}">${mark(w.sentence.replace(/^[“"‘']+|[”"’']+$/g, ''), w.word || w.headword)} <span>— ${esc(w.title || w.book)}</span></a>` : ''}
          </li>`).join('')}
        </ul>`).join('') : `<div class="empty"><p>No saved words yet.</p><a class="btn" href="#/">Go to the shelves</a></div>`}
    </section>`;
  };
  draw();
  root.addEventListener('click', e => {
    const s = e.target.closest('[data-sort]');
    if (s) { sort = s.dataset.sort; prefs.set('wordsSort', sort); draw(); return; }
    const r = e.target.closest('[data-remove]');
    if (r) { removeWord(r.dataset.remove); return; }
    const sp = e.target.closest('[data-speak]');
    if (sp) speak(sp.dataset.speak);
  });
  const unsub = subscribe(draw);
  return () => unsub();
}

/* ---------------- Settings ---------------- */
export function renderSettings(root) {
  const draw = () => {
    const cfg = syncConfig();
    const theme = prefs.get('theme', 'auto');
    root.innerHTML = `
    <section class="page narrow">
      <header class="page-head"><h1>Settings</h1></header>

      <section class="panel">
        <h2>Reading</h2>
        <div class="field-row"><span class="label">Theme</span>
          <div class="seg">${['auto', 'light', 'sepia', 'dark'].map(t => `<button class="chip" data-theme-set="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
        </div>
        <div class="field-row"><span class="label">Glossary marks</span>
          <button class="chip" data-underline aria-pressed="${prefs.get('underline', true)}">${prefs.get('underline', true) ? 'On' : 'Off'}</button>
        </div>
      </section>

      <section class="panel">
        <h2>Sync</h2>
        <p class="sub">${statusPill()}</p>
        ${cfg ? `
          <dl class="kv"><dt>Repository</dt><dd>${esc(cfg.owner)}/${esc(cfg.repo)}</dd></dl>
          <div class="btn-row">
            <button class="btn" data-act="sync">Sync now</button>
            <button class="btn ghost" data-act="disconnect">Disconnect this device</button>
          </div>` : `
          <form class="sync-form" autocomplete="off">
            <label>Owner<input name="owner" required placeholder="github-username" spellcheck="false" autocapitalize="off"></label>
            <label>Repository<input name="repo" required value="sisyphus-library-data" spellcheck="false" autocapitalize="off"></label>
            <label>Token<input name="token" required type="password" placeholder="github_pat_…" spellcheck="false" autocapitalize="off"></label>
            <button class="btn primary" type="submit">Connect</button>
          </form>`}
      </section>

      <section class="panel">
        <h2>Data</h2>
        <div class="btn-row"><button class="btn" data-act="export">Download my words (JSON)</button></div>
      </section>
    </section>`;
  };
  draw();
  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.themeSet) {
      const t = b.dataset.themeSet; prefs.set('theme', t);
      try { localStorage.setItem('sl.theme', t); } catch { /* ignore */ }
      if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
      draw();
    }
    if (b.hasAttribute('data-underline')) { prefs.set('underline', !prefs.get('underline', true)); draw(); }
    if (b.dataset.act === 'sync') syncAll();
    if (b.dataset.act === 'disconnect') setSyncConfig(null);
    if (b.dataset.act === 'export') {
      const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `sisyphus-words-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    setSyncConfig({ owner: f.get('owner').trim(), repo: f.get('repo').trim(), token: f.get('token').trim() });
  });
  const unsub = subscribe(draw);
  return () => unsub();
}
