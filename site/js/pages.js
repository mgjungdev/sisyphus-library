import { esc } from './art.js';
import { subscribe, getState, syncConfig, setSyncConfig, syncAll, exportJSON } from './store.js';
import { applyTheme, currentTheme } from './reader.js';

const STATUS = {
  local: 'On this device only', pending: 'Changes waiting to sync', syncing: 'Syncing…',
  synced: 'Synced with GitHub', offline: 'Offline — will sync later', error: 'Sync error',
};

function statusPill() {
  const s = getState();
  return `<span class="sync-pill" data-s="${s.status}"><i></i>${esc(STATUS[s.status] || s.status)}${s.status === 'error' && s.error ? ` (${esc(s.error)})` : ''}</span>`;
}

/* ---------------- Settings ---------------- */
export function renderSettings(root) {
  const draw = () => {
    const cfg = syncConfig();
    const theme = currentTheme();
    root.innerHTML = `
    <section class="page narrow">
      <header class="page-head"><h1>Settings</h1></header>

      <section class="panel">
        <h2>Reading</h2>
        <div class="field-row"><span class="label">Theme</span>
          <div class="seg">${['auto', 'white', 'paper', 'gray', 'night'].map(t => `<button class="chip" data-theme-set="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
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
        <div class="btn-row"><button class="btn" data-act="export">Download my progress (JSON)</button></div>
      </section>
    </section>`;
  };
  draw();
  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.themeSet) {
      applyTheme(b.dataset.themeSet);
      draw();
    }
    if (b.dataset.act === 'sync') syncAll();
    if (b.dataset.act === 'disconnect') setSyncConfig(null);
    if (b.dataset.act === 'export') {
      const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `sisyphus-progress-${new Date().toISOString().slice(0, 10)}.json` });
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
