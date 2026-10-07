// The flat map (graph.js chooses it when there is no WebGL or the reader picks 2D): force-graph (site/vendor) draws
// each book on a canvas as a small cloth spine in its shelf colours. Relation lines: style = contact, weight = case
// of the lead reading, colour = kind, particles and an arrowhead from the older work to the newer. An author is a small gilt medal with
// its name, tied to its books by hairlines that pull them together; genre and shelf heading only pull books together.
// Genre names lie under the books like regions on a map.
import { isDrafts } from './catalog.js';
import { GENRES, CASE_W, PER_YEAR, shortTitle, authorForces, drawMedal } from './graph.js';

const DASH = { documented: null, probable: [6, 4], none: [1.4, 3.2] };

export function make2D(env) {
  const { stage, nodes, links, relLinks, lit, litLinks, on } = env;
  const C = () => env.C;
  const focusing = () => lit.size > 0;

  /* ---------- forces: genre regions, shelf headings, collision ---------- */
  let anchors = new Map();
  function placeAnchors() {
    const r = stage.getBoundingClientRect();
    const aspect = Math.min(2.2, Math.max(0.45, (r.width || 1280) / (r.height || 800)));
    const R = 230, rx = R * Math.sqrt(aspect), ry = R / Math.sqrt(aspect);
    anchors = new Map(GENRES.map((g, i) => {
      // Start just off vertical so the lower-left corner, where the key sits, falls between two regions.
      const t = (-85 / 180) * Math.PI + (i / GENRES.length) * Math.PI * 2;
      return [g, { x: Math.cos(t) * rx, y: Math.sin(t) * ry }];
    }));
  }
  placeAnchors();
  function clusterForce() {
    let ns = [];
    const f = alpha => {
      const heads = new Map();
      ns.forEach(n => n.heads.forEach(h => {
        const c = heads.get(h) || { x: 0, y: 0, k: 0 };
        c.x += n.x; c.y += n.y; c.k++; heads.set(h, c);
      }));
      ns.forEach(n => {
        const a = anchors.get(n.isA ? n.home : n.genre) || { x: 0, y: 0 };
        const k = (n.deg ? 0.03 : n.isA ? 0.05 : 0.06) * alpha; // a book leans on its author more than on its genre
        n.vx += (a.x - n.x) * k; n.vy += (a.y - n.y) * k;
        n.heads.forEach(h => {
          const c = heads.get(h);
          if (c.k > 1) { n.vx += (c.x / c.k - n.x) * 0.05 * alpha; n.vy += (c.y / c.k - n.y) * 0.05 * alpha; }
        });
      });
    };
    f.initialize = x => { ns = x; };
    return f;
  }
  function collideForce() {
    let ns = [];
    const f = () => {
      if (ns[0]?.fx != null) return; // the books are held (the timeline, or on the way to or from it): nothing to push
      for (let i = 0; i < ns.length; i++) {
        const a = ns[i];
        for (let j = i + 1; j < ns.length; j++) {
          const b = ns[j];
          const dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy;
          const want = a.r + b.r, d2 = dx * dx + dy * dy;
          if (d2 >= want * want) continue;
          const d = Math.sqrt(d2) || 0.01, push = (want - d) / d * 0.5;
          a.vx -= dx * push * 0.5; a.vy -= dy * push * 0.5; b.vx += dx * push * 0.5; b.vy += dy * push * 0.5;
        }
      }
    };
    f.initialize = x => { ns = x; };
    return f;
  }

  /* ---------- drawing ---------- */
  const ease = (cur, to, k = 0.18) => cur + (to - cur) * k;
  // An author: a gilt medal with its initials, its name always beside it. The medal is drawn once into a small bitmap
  // (a gradient per medal per frame slows the map), with and without initials for when it is too small to read them.
  const medalPx = 64;
  function medalImage(n, ini) {
    const key = ini ? 'medalI' : 'medal';
    if (!n[key]) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = medalPx;
      drawMedal(cv.getContext('2d'), medalPx / 2, medalPx / 2, medalPx / 2 - 1, ini ? n.ini : '', C().font);
      n[key] = cv;
    }
    return n[key];
  }
  let inFlight = false; // books are flying in from the shelves: authors wait until they have landed
  function drawAuthor(n, ctx, scale) {
    if (inFlight) { n.a = 0; return; }
    const focus = focusing(), c = C(), on = lit.has(n);
    n.a = ease(n.a, focus ? (on ? 1 : 0.1) : env.restAlpha(n));
    n.s = ease(n.s, env.marked(n) ? 1.18 : 1);
    const r = (n.h * n.s) / 2;
    ctx.save();
    ctx.globalAlpha = n.a;
    if (r * scale >= 5) { ctx.shadowColor = c.dark ? 'rgba(0,0,0,.55)' : 'rgba(28,34,32,.3)'; ctx.shadowBlur = 5 * n.s; ctx.shadowOffsetY = 1.5; }
    ctx.drawImage(medalImage(n, r * scale >= 6), n.x - r, n.y - r, r * 2, r * 2);
    ctx.restore();
    // On the timeline the books' years come first: an author's name shows as the reader zooms in, or when lit.
    const mix = env.timeline()?.mix || 0, named = on || env.marked(n) ? 1 : 1 - mix * (1 - Math.max(0, Math.min(1, (scale - 1.2) / 0.6)));
    if (named < 0.02) return;
    const px = 11.5, th = px / scale;
    ctx.save();
    ctx.globalAlpha = Math.min(1, n.a + 0.1) * named;
    ctx.font = `italic ${th}px ${c.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = c.bg;
    const tw = measure(ctx, n.name), gap = 3 / scale + 1;
    const box = (lx, y0) => ({ lx, x0: lx - tw / 2, x1: lx + tw / 2, y0, y1: y0 + th });
    const side = r + gap + tw / 2;
    const tries = [box(n.x, n.y + r + gap), box(n.x, n.y - r - gap - th), box(n.x + side, n.y - th / 2), box(n.x - side, n.y - th / 2)];
    const clash = b => labels.reduce((a, o) => a + Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0)), 0);
    const b = tries.find(t => !clash(t)) || tries.reduce((m, t) => (clash(t) < clash(m) ? t : m));
    labels.push(b);
    put(ctx, true, n.name, b.lx, b.y0);
    ctx.fillStyle = on || !focus ? c.ink : c.ink2;
    put(ctx, false, n.name, b.lx, b.y0);
    ctx.restore();
  }
  function drawBook(n, ctx, scale) {
    if (!Number.isFinite(n.x) || env.outHidden(n)) return;
    if (n.isA) { drawAuthor(n, ctx, scale); return; }
    if (n.away) { n.a = env.restAlpha(n); return; } // its spines are in the air (transit.js)
    const focus = focusing();
    const on = !focus || lit.has(n);
    const dim = !focus && env.filters.rels.size && !n.relOn;
    const c = C(), marked = env.marked(n);
    n.a = ease(n.a, focus ? (on ? 1 : 0.1) : env.restAlpha(n));
    n.s = ease(n.s, marked ? 1.18 : 1);
    const h = n.h * n.s, w = n.w * n.s, x = n.x - w / 2, y = n.y - h / 2, rad = Math.min(w * 0.18, 2);
    ctx.save();
    ctx.globalAlpha = n.a;
    if (n.deg || n === env.hoverNode()) {
      ctx.shadowColor = c.dark ? 'rgba(0,0,0,.55)' : 'rgba(28,34,32,.32)';
      ctx.shadowBlur = 6 * n.s; ctx.shadowOffsetY = 2;
    }
    ctx.beginPath(); ctx.roundRect(x, y, w, h, rad);
    ctx.fillStyle = n.b.spine?.color || '#57605c';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    const speck = h * scale < 9; // so small on screen that its cloth and gilt would not show
    if (!speck) {
      // Rounded cloth: light across the middle, darker at the joints.
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(0,0,0,.28)'); g.addColorStop(0.32, 'rgba(255,255,255,.16)');
      g.addColorStop(0.6, 'rgba(255,255,255,.02)'); g.addColorStop(1, 'rgba(0,0,0,.32)');
      ctx.fillStyle = g; ctx.fill();
      if (c.dark) { ctx.lineWidth = 0.6 / scale + 0.3; ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.stroke(); }
      // Gilt bands, as on the shelf.
      ctx.fillStyle = n.b.accent || '#c9a24a';
      const band = Math.max(h * 0.035, 0.5);
      ctx.fillRect(x + w * 0.08, y + h * 0.1, w * 0.84, band);
      ctx.fillRect(x + w * 0.08, y + h * 0.1 + band * 2, w * 0.84, band * 0.6);
      ctx.fillRect(x + w * 0.08, y + h * 0.8, w * 0.84, band);
      if (n.b.status === 'proposed' && isDrafts()) { // a draft record: a small gold seal at the head
        ctx.beginPath(); ctx.arc(x + w + 2.2, y + 1.5, 1.6, 0, Math.PI * 2); ctx.fillStyle = '#d4a72c'; ctx.fill();
      }
    }
    ctx.restore();

    // Titles: always for related books and the lit neighbourhood, for the rest once the reader zooms in.
    const show = lit.has(n) || (!focus && !dim && (n.deg > 0 || scale > 2.6));
    if (!show) return;
    const px = n.deg || lit.has(n) ? 12.5 : 10.5;
    ctx.save();
    ctx.globalAlpha = Math.min(1, n.a * (n.deg || lit.has(n) ? 1 : Math.min(1, (scale - 2.6) * 2)));
    ctx.font = `${marked ? 'italic ' : ''}${px / scale}px ${c.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = c.bg;
    // Below the spine if that space is free, else above it; an unrelated book's title gives way.
    const label = shortTitle(n.b.title), tw = measure(ctx, label), th = px / scale;
    const below = n.y + h / 2 + 4 / scale + 2, above = n.y - h / 2 - 4 / scale - 2 - th;
    const box = (lx, y0) => ({ lx, x0: lx - tw / 2, x1: lx + tw / 2, y0, y1: y0 + th });
    const clash = b => labels.reduce((a, o) => a + (o.n === n ? 0
      : Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0))), 0);
    const free = b => !clash(b);
    // A related book's title may also sit beside its spine when both ends are taken (crowded narrow screens).
    const side = w / 2 + 5 / scale + tw / 2;
    const tries = [box(n.x, below), box(n.x, above)];
    if (n.deg) tries.push(box(n.x + side, n.y - th / 2), box(n.x - side, n.y - th / 2));
    let b = tries.find(free);
    if (!b) {
      if (!n.deg && !lit.has(n)) { ctx.restore(); return; }
      b = tries.reduce((m, t) => (clash(t) < clash(m) ? t : m)); // the least crowded place
    }
    labels.push(b);
    put(ctx, true, label, b.lx, b.y0);
    ctx.fillStyle = n.deg || lit.has(n) ? c.ink : c.ink2;
    put(ctx, false, label, b.lx, b.y0);
    ctx.restore();
  }
  function hitBook(n, color, ctx) {
    const pad = 3;
    ctx.fillStyle = color;
    if (n.isA) { ctx.beginPath(); ctx.arc(n.x, n.y, n.h / 2 + pad, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.fillRect(n.x - n.w / 2 - pad, n.y - n.h / 2 - pad, n.w + pad * 2, n.h + pad * 2);
  }

  // Genre names lie under the books like regions on a map, fading as the reader zooms in.
  let labels = []; // title boxes drawn this frame
  // Text widths, measured once per font at 100px and scaled: the font size follows the zoom, so keyed by size every
  // frame of a zoom would measure every title again.
  const widths = new Map();
  const measure = (ctx, t) => {
    const f = ctx.font, m = /(\d*\.?\d+)px/.exec(f), px = m ? +m[1] : 100, at = m ? f.replace(m[0], '100px') : f, k = `${at}|${t}`;
    let w = widths.get(k);
    if (w == null) { ctx.font = at; widths.set(k, w = ctx.measureText(t).width); ctx.font = f; }
    return (w * px) / 100;
  };
  // The timeline's axis under the books: a faint band on every other genre lane with its name at the lane's left
  // end, a hairline each decade (darker every fifty years) and the years along the bottom, kept on screen.
  function drawAxis(ctx, scale) {
    const t = env.timeline();
    if (!t) return;
    const { axis: A, mix } = t, c = C();
    const tl = fg.screen2GraphCoords(0, 0), fr = env.freeRect(), floor = fg.screen2GraphCoords(0, fr.bottom).y;
    ctx.save();
    ctx.fillStyle = c.ink;
    ctx.globalAlpha = mix * (c.dark ? 0.06 : 0.035);
    A.lanes.forEach((L, i) => { if (i % 2) ctx.fillRect(A.x0, L.y0, A.x1 - A.x0, L.y1 - L.y0); });
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1 / scale;
    A.ticks.forEach(k => {
      ctx.globalAlpha = mix * (k.early ? 0.16 : k.major ? 0.34 : 0.14);
      ctx.beginPath(); ctx.moveTo(k.x, A.top); ctx.lineTo(k.x, A.bottom); ctx.stroke();
    });
    ctx.globalAlpha = mix * 0.5;
    ctx.beginPath(); ctx.moveTo(A.x0, A.bottom); ctx.lineTo(A.x1, A.bottom); ctx.stroke();
    if (A.brk != null) { // the axis breaks between the older years and 1700: two short slants
      const d = 4 / scale;
      ctx.lineWidth = 1.4 / scale; ctx.globalAlpha = mix * 0.7;
      [-2.5, 2.5].forEach(o => { ctx.beginPath(); ctx.moveTo(A.brk + o / scale - d, A.bottom + 2 * d); ctx.lineTo(A.brk + o / scale + d, A.bottom - 2 * d); ctx.stroke(); });
    }
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = c.bg;
    // Years: every decade when there is room on screen, else every fifty years.
    const px = 11.5 / scale, gap = 10 * PER_YEAR * scale;
    const ly = Math.max(A.top, Math.min(A.bottom + 5 / scale, floor - px - 3 / scale));
    ctx.font = `${px}px ${c.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    A.ticks.forEach(k => {
      if (!k.major && !k.early && gap < 40) return;
      ctx.globalAlpha = mix * (k.major ? 0.95 : 0.75);
      ctx.fillStyle = k.major ? c.ink2 : c.ink3;
      put(ctx, true, k.label, k.x, ly); put(ctx, false, k.label, k.x, ly);
      const w = measure(ctx, k.label);
      labels.push({ x0: k.x - w / 2, x1: k.x + w / 2, y0: ly, y1: ly + px });
    });
    // Lane names at the top left of their lanes, or of the screen when the lanes begin off it.
    const nx = Math.max(A.x0 + 6 / scale, tl.x + 10 / scale);
    ctx.font = `italic ${12 / scale}px ${c.font}`; ctx.textAlign = 'left';
    ctx.globalAlpha = mix * 0.9; ctx.fillStyle = c.ink3;
    A.lanes.forEach(L => { put(ctx, true, L.name, nx, L.y0 + 4 / scale); put(ctx, false, L.name, nx, L.y0 + 4 / scale); });
    ctx.restore();
  }

  // Text goes on in screen pixels at a steady size. Set at px / scale under the zoom, every frame of a zoom would give
  // the canvas text of a new size, which it then draws letter by letter afresh (a third of the frame rate).
  let M = null; // this frame's zoom transform, read once before anything is drawn
  function put(ctx, stroke, t, x, y) {
    const f = ctx.font, m = /(\d*\.?\d+)px/.exec(f), k = M.a;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = f.replace(m[0], `${Math.round(+m[1] * k * 4) / 4}px`);
    const X = M.a * x + M.e, Y = M.d * y + M.f;
    if (stroke) { const lw = ctx.lineWidth; ctx.lineWidth = lw * k; ctx.strokeText(t, X, Y); ctx.lineWidth = lw; }
    else ctx.fillText(t, X, Y);
    ctx.font = f; ctx.setTransform(M);
  }

  let entered = false;
  function drawRegions(ctx, scale) {
    M = ctx.getTransform();
    // Titles keep off the spines of related books, as well as off each other.
    inFlight = nodes.some(n => n.away);
    if (!entered && nodes.every(n => Number.isFinite(n.x))) { entered = true; on.placed(); setTimeout(on.firstFrame); }
    labels = nodes.filter(n => n.deg && n.vis && Number.isFinite(n.x))
      .map(n => ({ n, x0: n.x - n.w / 2, x1: n.x + n.w / 2, y0: n.y - n.h / 2, y1: n.y + n.h / 2 }));
    drawAxis(ctx, scale);
    // On the timeline the lanes name the genres instead.
    const fade = Math.max(0, Math.min(1, (3.2 - scale) / 1.4)) * (1 - (env.timeline()?.mix || 0));
    if (!fade) return;
    const c = C();
    // Placed by the books that stay home (no relations pull them away): above the mean by their spread.
    const sums = new Map();
    nodes.forEach(n => {
      if (!n.genre || n.deg || !n.vis || !Number.isFinite(n.x)) return;
      const s = sums.get(n.genre) || { x: 0, y: 0, yy: 0, k: 0 };
      s.x += n.x; s.y += n.y; s.yy += n.y * n.y; s.k++; sums.set(n.genre, s);
    });
    const fs = Math.max(15, 17 / Math.sqrt(scale));
    // On the outer side of each region, away from the middle where related books gather.
    sums.forEach(s => {
      const my = s.y / s.k, sd = Math.sqrt(Math.max(0, s.yy / s.k - my * my));
      s.base = my < 0 ? my - 1.7 * sd - 12 : my + 1.7 * sd + 12 + fs * 0.75;
    });
    ctx.save();
    // Related books gather in the middle and keep their titles: a region name steps outward, then sideways, off
    // any such book and the room for its title above and below.
    ctx.font = `${12.5 / scale}px ${c.font}`;
    const th = 12.5 / scale + 6 / scale + 2;
    const taken = nodes.filter(n => n.deg && n.vis && Number.isFinite(n.x)).map(n => {
      const tw = Math.max(measure(ctx, shortTitle(n.b.title)), n.w) / 2 + 4 / scale;
      return { x0: n.x - tw, x1: n.x + tw, y0: n.y - n.h / 2 - th, y1: n.y + n.h / 2 + th };
    });
    const tl = fg.screen2GraphCoords(0, 0), br = fg.screen2GraphCoords(stage.clientWidth, stage.clientHeight), edge = 8 / scale;
    const inView = b => b.x0 >= tl.x + edge && b.x1 <= br.x - edge;
    const crowd = b => taken.reduce((a, o) => a
      + Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0)), 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `italic ${fs}px ${c.font}`;
    ctx.fillStyle = c.ink3;
    ctx.globalAlpha = fade * (focusing() ? 0.35 : 0.85);
    sums.forEach((s, g) => {
      const w = measure(ctx, g), out = s.base < 0 ? -1 : 1, cx = s.x / s.k;
      const at = (dx, k) => {
        const x = cx + dx * w, y = s.base + out * k * fs * 1.1;
        return { x, y, x0: x - w / 2, x1: x + w / 2, y0: y - fs * 0.8, y1: y + fs * 0.2 };
      };
      const onScreen = c => { // slide a name that runs off the edge back in
        const d = Math.max(0, tl.x + edge - c.x0) - Math.max(0, c.x1 - (br.x - edge));
        return { ...c, x: c.x + d, x0: c.x0 + d, x1: c.x1 + d };
      };
      const cands = [];
      for (const k of [0, 1, 2, 3]) for (const dx of [0, -0.45, 0.45]) { const c = at(dx, k); if (inView(c)) cands.push(c); }
      for (const k of [0, 1, 2, 3]) cands.push(onScreen(at(0, k)));
      const b = cands.find(c => !crowd(c)) || cands.reduce((m, c) => (crowd(c) < crowd(m) ? c : m));
      put(ctx, false, g, b.x, b.y);
      labels.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });
    });
    ctx.restore();
  }

  const linkAlpha = l => (focusing() ? (litLinks.has(l) ? 1 : 0.06) : 1);
  const withAlpha = (hex, a) => {
    if (!hex.startsWith('#')) return hex;
    const h = hex.length === 4 ? hex.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : hex;
    return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
  };

  /* ---------- the engine ---------- */
  const fg = ForceGraph()(stage)
    .backgroundColor('rgba(0,0,0,0)')
    .graphData({ nodes, links })
    .nodeId('id')
    .nodeLabel(() => '')
    .nodeCanvasObject(drawBook)
    .nodePointerAreaPaint(hitBook)
    .nodeVisibility(n => n.vis)
    .linkVisibility(l => l.source.vis && l.target.vis && (l.kind !== 'rel' ? !inFlight : l.on))
    .linkCurvature(l => (l.kind === 'rel' ? 0.18 : 0))
    .linkColor(l => (l.kind === 'author'
      ? withAlpha(C().ink3, (focusing() ? (litLinks.has(l) ? 0.75 : 0.03) : (C().dark ? 0.2 : 0.16)))
      : withAlpha(C().rel(l.rel), 0.88 * linkAlpha(l))))
    .linkWidth(l => (l.kind === 'author' ? (litLinks.has(l) ? 1 : 0.5) : (CASE_W[l.case] || 1.8) * (litLinks.has(l) && env.hoverLink() === l ? 1.4 : 1)))
    .linkLineDash(l => (l.kind === 'rel' ? DASH[l.contact] : null))
    .linkHoverPrecision(6)
    // An arrowhead by the newer book, pointing the way the particles go: just short of its spine.
    .linkDirectionalArrowLength(l => (l.kind === 'rel' ? ((CASE_W[l.case] || 1.8) + 1.6) * 1.7 : 0))
    .linkDirectionalArrowRelPos(l => {
      const d = Math.hypot(l.target.x - l.source.x, l.target.y - l.source.y) || 1;
      return Math.max(0.55, Math.min(0.97, 1 - (l.target.h * 0.5 + 2) / d));
    })
    .linkDirectionalArrowColor(l => withAlpha(C().rel(l.rel), 0.95 * linkAlpha(l)))
    .linkDirectionalParticles(l => (l.kind === 'rel' ? (l.case === 'strong' ? 4 : 3) : 0))
    .linkDirectionalParticleSpeed(l => (l.case === 'speculative' ? 0.0035 : 0.005))
    .linkDirectionalParticleWidth(l => (CASE_W[l.case] || 1.8) + 1.6)
    .linkDirectionalParticleColor(l => withAlpha(C().rel(l.rel), linkAlpha(l)))
    .onRenderFramePre(drawRegions)
    .autoPauseRedraw(false)
    .minZoom(0.35).maxZoom(9)
    .d3VelocityDecay(0.32)
    .d3AlphaDecay(0.018)
    .warmupTicks(140)
    .cooldownTime(9000)
    .onNodeHover(n => on.hoverNode(n))
    // Where relation lines cross, the engine gives the one drawn last, and its picture of what is under the pointer is
    // redrawn only every 800 ms: the line under the pointer is the nearest one (also checked as the pointer moves).
    .onLinkHover(l => overLink(nearLine(l)))
    .onNodeClick((n, ev) => on.clickNode(n, ev))
    .onLinkClick((l, ev) => on.clickLink(nearLine(l, ev)))
    // The engine finds what is under the pointer on a picture it redraws only every 800 ms, so a tap soon after a
    // pinch or pan can miss the book under the finger: graph.js looks for it before treating it as the background.
    .onBackgroundClick(up => on.clickBackground(up))
    .onRenderFramePost(() => on.frame())
    .onNodeDragEnd(n => { n.fx = undefined; n.fy = undefined; });
  authorForces(fg);
  fg.d3Force('center', null);
  fg.d3Force('cluster', clusterForce());
  fg.d3Force('collide', collideForce());
  fg.onEngineStop(() => on.engineStop());

  const size = () => { const r = stage.getBoundingClientRect(); fg.width(r.width).height(r.height); };
  size();

  // Bring a set of books into the free part of the stage, no closer than kMax.
  function frame(ns, ms, kMax = 3) {
    const { W, H, left, right, top, bottom } = env.freeRect();
    const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
    const x0 = Math.min(...xs) - 50, x1 = Math.max(...xs) + 50, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
    const k = Math.max(0.35, Math.min((right - left) / (x1 - x0), (bottom - top) / (y1 - y0), kMax));
    const cx = (x0 + x1) / 2 - ((left + right) / 2 - W / 2) / k, cy = (y0 + y1) / 2 - ((top + bottom) / 2 - H / 2) / k;
    fg.zoom(k, ms); fg.centerAt(cx, cy, ms);
    return { k };
  }

  // d3-zoom stops dead when the pointer lets go; carry the pan on and let it slow down.
  let trail = [], glide = 0, gliding = false, flying = 0, resting = 0;
  fg.onZoom(() => {
    if (gliding || !env.touched() || flying) return; // a camera flight is not a fling
    const c = fg.centerAt();
    trail.push({ t: performance.now(), x: c.x, y: c.y, k: fg.zoom() });
    if (trail.length > 12) trail.shift();
  });
  fg.onZoomEnd(() => {
    const b = trail[trail.length - 1], recent = trail.filter(p => b && p.t >= b.t - 120);
    trail = [];
    if (gliding || recent.length < 2) return;
    const a = recent[0], dt = b.t - a.t;
    if (dt <= 0 || a.k !== b.k || performance.now() - b.t > 80) return;
    let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, last = performance.now();
    if (Math.hypot(vx, vy) * b.k < 0.15) return;
    const step = now => {
      const d = now - last; last = now;
      vx *= Math.pow(0.9945, d); vy *= Math.pow(0.9945, d);
      if (Math.hypot(vx, vy) * fg.zoom() < 0.01) { gliding = false; return; }
      const c = fg.centerAt();
      gliding = true; fg.centerAt(c.x + vx * d, c.y + vy * d); gliding = false;
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  });

  // The middle of the drawn line: on the curve when force-graph bent it (quadratic, control point kept on the link).
  function midOf(l) {
    const s = l.source, t = l.target, cp = l.__controlPoints;
    return cp ? { x: 0.25 * s.x + 0.5 * cp[0] + 0.25 * t.x, y: 0.25 * s.y + 0.5 * cp[1] + 0.25 * t.y }
      : { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  }
  const local = e => { const r = stage.getBoundingClientRect(); return fg.screen2GraphCoords(e.clientX - r.left, e.clientY - r.top); };
  // The visible relation line nearest the pointer, within a few pixels, if any.
  function lineAt(e) {
    const p = local(e);
    let best = null, bd = 6 / fg.zoom();
    for (const l of relLinks) {
      if (!l.on || !l.source.vis || !l.target.vis) continue;
      const s = l.source, t = l.target, cp = l.__controlPoints || [(s.x + t.x) / 2, (s.y + t.y) / 2];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        const d = Math.hypot(a * s.x + b * cp[0] + c * t.x - p.x, a * s.y + b * cp[1] + c * t.y - p.y);
        if (d < bd) { bd = d; best = l; }
      }
    }
    return best;
  }
  const nearLine = (l, e = env.pointer()) => ((!l || l.kind === 'rel') && e && lineAt(e)) || l;
  let overLine = null;
  const overLink = l => { if (l !== overLine) { overLine = l; on.hoverLink(l); } };
  stage.addEventListener('pointermove', e => {
    if (e.buttons) return;
    const l = lineAt(e);
    if (l || overLine?.kind === 'rel') overLink(l);
  });

  return {
    fg,
    mode: '2d',
    has: n => Number.isFinite(n.x),
    screen: n => fg.graph2ScreenCoords(n.x, n.y),
    size: (n, scaled) => { const k = fg.zoom() * (scaled ? n.s : 1); return { w: n.w * k, h: n.h * k }; },
    mid: l => { const m = midOf(l); return fg.graph2ScreenCoords(m.x, m.y); },
    lineAt,
    bookAt(e) {
      const p = local(e), pad = (e.pointerType === 'mouse' ? 3 : 8) / fg.zoom();
      let best = null, bd = Infinity;
      for (const n of nodes) {
        if (!n.vis || !Number.isFinite(n.x)) continue;
        const dx = Math.abs(p.x - n.x), dy = Math.abs(p.y - n.y);
        if (dx > n.w / 2 + pad || dy > n.h / 2 + pad) continue;
        if (dx + dy < bd) { best = n; bd = dx + dy; }
      }
      return best;
    },
    frame,
    // Fit both books of a line into a box of the stage ([x0, y0, x1, y1] in px).
    showPair(l, [x0, y0, x1, y1], ms) {
      const Wd = stage.clientWidth, H = stage.clientHeight;
      const m = midOf(l), dx = Math.abs(l.source.x - l.target.x) + 60, dy = Math.abs(l.source.y - l.target.y) + 60;
      const k = Math.max(0.6, Math.min((x1 - x0) / dx, (y1 - y0) / dy, 3.2));
      fg.zoom(k, ms);
      fg.centerAt(m.x - ((x0 + x1) / 2 - Wd / 2) / k, m.y - ((y0 + y1) / 2 - H / 2) / k, ms);
    },
    // Fly the camera to a node; resolves when it has arrived.
    flyTo(n, ms = 750) {
      cancelAnimationFrame(glide);
      const k = Math.max(fg.zoom(), stage.clientWidth < 640 ? 2.2 : 2.6);
      fg.centerAt(n.x, n.y, ms); fg.zoom(k, ms);
      return new Promise(res => { clearTimeout(flying); flying = setTimeout(() => { flying = 0; res(); }, ms + 30); });
    },
    // One entrance: the map settles into view from a little closer in. Books flying in from the shelves
    // (transit.js) want a camera that is nearly still: a gentler approach, none under reduced motion.
    enter({ pin, arrive, reduced, fit, focusOn }) {
      const { k } = fit(0);
      if (reduced) { if (pin) focusOn(pin, 0); return; }
      fg.zoom(k * (arrive ? 1.1 : 1.6), 0);
      if (pin) focusOn(pin, arrive ? 1000 : 1400);
      else fg.zoom(k, arrive ? 1000 : 1400);
    },
    refresh() {},
    restyle() {},
    // On the timeline books keep to their years: they are not dragged about.
    layout(name) { fg.enableNodeDrag(name !== 'timeline'); },
    // soft: the forces cool to almost nothing over the switch (all books are held), so none is kicked when let go.
    reheat(soft) { fg.d3AlphaDecay(soft ? 0.05 : 0.018).d3ReheatSimulation(); },
    prepare() {},
    rest() { fg.d3AlphaDecay(0.3); clearTimeout(resting); resting = setTimeout(() => fg.d3AlphaDecay(0.018), 800); },
    resize() { size(); placeAnchors(); fg.d3ReheatSimulation(); },
    cam() { const c = fg.centerAt(); return { x: c.x, y: c.y, k: fg.zoom(), az: 0 }; },
    still() { cancelAnimationFrame(glide); trail = []; },
    freeze() { requestAnimationFrame(() => requestAnimationFrame(() => fg.pauseAnimation())); },
    destroy() { cancelAnimationFrame(glide); clearTimeout(flying); clearTimeout(resting); fg.pauseAnimation(); fg._destructor?.(); },
  };
}
