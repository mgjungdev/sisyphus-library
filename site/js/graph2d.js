// The map (graph.js): force-graph (site/vendor) on a canvas, in three layouts. The web: each book a plain dot in its
// cloth colour, sized by its relations, the genres pulled into regions named at their rims; relation lines thin and
// faint until lit (style = contact, weight = case, colour = kind when lit), a small chevron halfway pointing from the
// older work to the newer. The circle: books round a ring by genre, the lines crossing inside it. The timeline: books
// on one line by year, the lines as arcs above it, older to newer. An author is a small ring with its name, tied to
// its books by hairlines (the web only). In a book's cascade each book shows its cover with its symbol.
import { GENRES, CASE_W, REST_LINE, TITLES_AT, NAMES_AT, zoomIn, PER_YEAR, shortTitle, authorForces } from './graph.js';
import { coverCanvas, hexMix } from './art.js';

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
    const R = 420, rx = R * Math.sqrt(aspect), ry = R / Math.sqrt(aspect);
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
        const k = (n.deg ? 0.07 : n.isA ? 0.08 : 0.12) * alpha; // a book leans on its author more than on its genre
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
  // 0 in the web, 1 on the circle or the timeline (the regions, authors and their hairlines belong to the web).
  const held = () => Math.max(env.timeline()?.mix || 0, env.ring()?.mix || 0);
  const dotOf = n => (n.dot ||= hexMix(n.b.spine?.color || '#57605c', C().bg, C().dark ? 0.12 : 0.18));
  const coverOf = n => coverCanvas(n.lb || n.b, n.b.spine?.color || '#57605c', C().bg, C().coverMix, C().coverInk);
  let inFlight = false; // books are flying in from the shelves: authors wait until they have landed
  function drawAuthor(n, ctx, scale) {
    if (inFlight) { n.a = 0; return; }
    const focus = focusing(), c = C(), on = lit.has(n), away = 1 - held();
    n.a = ease(n.a, (focus ? (on ? 1 : 0.08) : env.restAlpha(n) * 0.6) * away);
    if (n.a < 0.02) return;
    const r = (n.h * (env.marked(n) ? 1.25 : 1)) / 2;
    ctx.save();
    ctx.globalAlpha = n.a;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = c.bg; ctx.fill();
    ctx.lineWidth = 1 / scale; ctx.strokeStyle = on ? c.ink : c.ink3; ctx.stroke();
    ctx.restore();
    // Its name, in small capitals, as the reader zooms in, or when lit.
    const named = on || env.marked(n) || n === env.hoverNode() ? 1 : zoomIn(scale, NAMES_AT);
    if (named * n.a < 0.02) return;
    const px = 9, th = px / scale, label = n.name.toUpperCase();
    ctx.save();
    ctx.globalAlpha = Math.min(1, n.a + 0.1) * named;
    ctx.font = `600 ${th}px ${c.ui}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.2px';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = c.bg;
    const tw = measure(ctx, label) * 1.12, gap = 3 / scale + 1;
    const box = (lx, y0) => ({ lx, x0: lx - tw / 2, x1: lx + tw / 2, y0, y1: y0 + th });
    const side = r + gap + tw / 2;
    const tries = [box(n.x, n.y + r + gap), box(n.x, n.y - r - gap - th), box(n.x + side, n.y - th / 2), box(n.x - side, n.y - th / 2)];
    const clash = b => labels.reduce((a, o) => a + Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0)), 0);
    const b = tries.find(t => !clash(t)) || tries.reduce((m, t) => (clash(t) < clash(m) ? t : m));
    labels.push(b);
    put(ctx, true, label, b.lx, b.y0);
    ctx.fillStyle = on || !focusing() ? c.ink2 : c.ink3;
    put(ctx, false, label, b.lx, b.y0);
    ctx.restore();
  }
  function drawBook(n, ctx, scale) {
    if (!Number.isFinite(n.x) || env.outHidden(n)) return;
    if (n.isA) { drawAuthor(n, ctx, scale); return; }
    if (n.away) { n.a = env.restAlpha(n); return; } // its cover is in the air (transit.js)
    const focus = focusing();
    const on = !focus || lit.has(n);
    const dim = !focus && env.filters.rels.size && !n.relOn;
    const c = C(), marked = env.marked(n), casc = env.cascade(), hov = n === env.hoverNode();
    n.a = ease(n.a, focus ? (on ? 1 : 0.08) : env.restAlpha(n));
    n.s = ease(n.s, marked ? 1.25 : 1);
    ctx.save();
    ctx.globalAlpha = n.a;
    let half;
    if (casc) { // a cascade has room: each book shows its cover
      const H = (env.cascadeRoot() === n ? 84 : 58) * n.s, W = H * 0.68;
      ctx.drawImage(coverOf(n), n.x - W / 2, n.y - H / 2, W, H);
      half = H / 2; n.hitR = H / 2;
    } else {
      const r = (n.h / 2) * n.s;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dotOf(n); ctx.fill();
      if (marked) { ctx.lineWidth = 1.2 / scale; ctx.strokeStyle = c.ink; ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5 / scale, 0, Math.PI * 2); ctx.stroke(); }
      half = r; n.hitR = n.h / 2;
    }
    ctx.restore();

    // Titles: always for hubs and the lit neighbourhood, for other related books as the reader zooms in, for the rest
    // closer still. On the circle and the timeline only what is lit or pointed at.
    const away = held() > 0.5;
    const show = lit.has(n) || hov || (!focus && !dim && !away && (n.hub || (n.deg > 0 && scale > TITLES_AT) || scale > 2.6));
    if (!show) return;
    const strong = n.hub || lit.has(n) || hov;
    const px = strong ? 14 : 12.5;
    ctx.save();
    ctx.globalAlpha = Math.min(1, n.a * (strong ? 1 : n.deg ? zoomIn(scale, TITLES_AT) : Math.min(1, (scale - 2.6) * 2)));
    ctx.font = `${marked ? 'italic ' : ''}500 ${px / scale}px ${c.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = c.bg;
    // Below the book if that space is free, else above it; an unrelated book's title gives way.
    const more = env.more(n), label = shortTitle(n.b.title) + (more ? `  +${more}` : ''), tw = measure(ctx, label), th = px / scale;
    const below = n.y + half + 3 / scale, above = n.y - half - 3 / scale - th;
    const box = (lx, y0) => ({ lx, x0: lx - tw / 2, x1: lx + tw / 2, y0, y1: y0 + th });
    const clash = b => labels.reduce((a, o) => a + (o.n === n ? 0
      : Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0))), 0);
    const free = b => !clash(b);
    const side = half + 5 / scale + tw / 2;
    const tries = [box(n.x, below), box(n.x, above)];
    if (n.deg) tries.push(box(n.x + side, n.y - th / 2), box(n.x - side, n.y - th / 2));
    let b = tries.find(free);
    if (!b) {
      if (!strong) { ctx.restore(); return; }
      b = tries.reduce((m, t) => (clash(t) < clash(m) ? t : m)); // the least crowded place
    }
    labels.push(b);
    put(ctx, true, label, b.lx, b.y0);
    ctx.fillStyle = strong ? c.ink : c.ink2;
    put(ctx, false, label, b.lx, b.y0);
    ctx.restore();
  }
  function hitBook(n, color, ctx) {
    if (n.isA && held() > 0.5) return;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(n.x, n.y, (n.hitR || n.h / 2) + 3, 0, Math.PI * 2); ctx.fill();
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
    ctx.globalAlpha = mix * 0.8; ctx.strokeStyle = c.ink2;
    ctx.beginPath(); ctx.moveTo(A.x0, A.base); ctx.lineTo(A.x1, A.base); ctx.stroke();
    ctx.strokeStyle = c.ink3;
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

  // Each genre is an island: a soft pool of tone under its books, so the regions read before the lines do; its name in
  // small capitals at the island's outer rim, away from the middle where the lines between genres cross.
  let isles = new Map();
  function measureIslands() {
    const sums = new Map();
    nodes.forEach(n => {
      if (!n.genre || n.isA || !n.vis || !Number.isFinite(n.x)) return;
      const s = sums.get(n.genre) || { x: 0, y: 0, rr: 0, k: 0 };
      s.x += n.x; s.y += n.y; s.rr += n.x * n.x + n.y * n.y; s.k++; sums.set(n.genre, s);
    });
    isles = new Map();
    sums.forEach((s, g) => {
      if (s.k < 2) return;
      const x = s.x / s.k, y = s.y / s.k, sd = Math.sqrt(Math.max(0, s.rr / s.k - x * x - y * y));
      isles.set(g, { x, y, r: sd * 1.3 + 26 });
    });
  }
  function drawIsleNames(ctx, scale) {
    const fade = Math.max(0, Math.min(1, (3.2 - scale) / 1.4)) * (1 - held()) * (env.cascade() ? 0 : 1);
    if (!fade) return;
    const c = C(), px = 10.5 / scale;
    ctx.save();
    ctx.font = `600 ${px}px ${c.ui}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3 / scale; ctx.strokeStyle = c.bg;
    ctx.fillStyle = c.ink3;
    ctx.globalAlpha = fade * (focusing() ? 0.4 : 0.9);
    isles.forEach(({ x, y, r }, g) => {
      const d = Math.hypot(x, y) || 1, ux = x / d, uy = y / d, t = g.toUpperCase(), w = measure(ctx, t) * 1.12;
      // Out past the rim, far enough that the name's own width clears the pool.
      const reach = r + 10 / scale + Math.abs(ux) * w / 2 + Math.abs(uy) * px;
      // A name that would run off the side of the screen slides back in along it.
      const tl = fg.screen2GraphCoords(0, 0), br = fg.screen2GraphCoords(stage.clientWidth, 0), edge = 8 / scale;
      const ly = y + uy * reach, lx = Math.max(tl.x + edge + w / 2, Math.min(br.x - edge - w / 2, x + ux * reach));
      put(ctx, true, t, lx, ly); put(ctx, false, t, lx, ly);
      labels.push({ x0: lx - w / 2, x1: lx + w / 2, y0: ly - px / 2, y1: ly + px / 2 });
    });
    ctx.restore();
  }

  // The circle's genres: a short arc outside each genre's books, its name in small capitals beyond it.
  function drawRing(ctx, scale) {
    const R = env.ring();
    if (!R) return;
    const c = C(), { R: r, groups } = R.ring;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineWidth = 2 / scale; ctx.strokeStyle = c.ink3;
    ctx.globalAlpha = R.mix * 0.7;
    groups.forEach(g => { ctx.beginPath(); ctx.arc(0, 0, r + 14, g.a0 - 0.01, g.a1 + 0.01); ctx.stroke(); });
    ctx.font = `600 ${10 / scale}px ${c.ui}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.textBaseline = 'middle'; ctx.fillStyle = c.ink3; ctx.globalAlpha = R.mix * (focusing() ? 0.4 : 0.9);
    groups.forEach(g => {
      const a = (g.a0 + g.a1) / 2, x = Math.cos(a) * (r + 30), y = Math.sin(a) * (r + 30);
      ctx.textAlign = Math.abs(Math.cos(a)) < 0.25 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right';
      put(ctx, false, g.name.toUpperCase(), x, y);
    });
    ctx.restore();
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
    drawRing(ctx, scale);
    drawLinks(ctx, scale);
    measureIslands();
    drawIsleNames(ctx, scale);
  }

  // In a cascade each line says what it is, along its arrow ('answered by'), in its colour, at its middle.
  function drawVerbs(ctx, scale) {
    if (!env.cascade()) return;
    const c = C();
    M = ctx.getTransform();
    ctx.save();
    ctx.font = `italic ${11 / scale}px ${c.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4 / scale; ctx.strokeStyle = c.bg;
    relLinks.forEach(l => {
      if (!l.on || !l.source.vis || !l.target.vis || !Number.isFinite(l.source.x)) return;
      const u = env.verbAt(l), t = env.verbOf(l);
      const m = { x: l.source.x + (l.target.x - l.source.x) * u, y: l.source.y + (l.target.y - l.source.y) * u };
      // Words that would fall on a title, or on other words, are left out (the tooltip names the line).
      const w = measure(ctx, t) / 2, hh = 7 / scale, b = { x0: m.x - w, x1: m.x + w, y0: m.y - hh, y1: m.y + hh };
      if (labels.some(o => Math.min(b.x1, o.x1) > Math.max(b.x0, o.x0) && Math.min(b.y1, o.y1) > Math.max(b.y0, o.y0))) return;
      labels.push(b);
      ctx.globalAlpha = linkAlpha(l);
      put(ctx, true, t, m.x, m.y);
      ctx.fillStyle = C().rel(l.rel);
      put(ctx, false, t, m.x, m.y);
    });
    ctx.restore();
  }

  // The points of a relation line as drawn now: straight in the web, bowed toward the middle on the circle, an arc
  // above the line on the timeline (both ends sliding onto it). Kept on the link for hover and the popover.
  function pathOf(l) {
    const a = l.source, b = l.target, T = env.timeline(), R = env.ring();
    const tm = T?.mix || 0, rm = R?.mix || 0, pts = [];
    if (tm > 0.001) {
      const base = T.axis.base, ay = a.y + (base - a.y) * tm, by = b.y + (base - b.y) * tm;
      const h = (Math.abs(b.x - a.x) / 2) * T.axis.arcK * tm * 1.333;
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, v = 1 - u;
        pts.push({ x: v * v * v * a.x + 3 * v * v * u * a.x + 3 * v * u * u * b.x + u * u * u * b.x,
          y: v * v * v * ay + 3 * v * v * u * (ay - h) + 3 * v * u * u * (by - h) + u * u * u * by });
      }
    } else if (rm > 0.001) {
      const k = 1 - 0.85 * rm, cx = ((a.x + b.x) / 2) * k, cy = ((a.y + b.y) / 2) * k;
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, v = 1 - u;
        pts.push({ x: v * v * a.x + 2 * v * u * cx + u * u * b.x, y: v * v * a.y + 2 * v * u * cy + u * u * b.y });
      }
    } else pts.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    return (l.pts = pts);
  }
  const at = (pts, u) => { // a point u of the way along, and the direction there
    if (pts.length === 2) {
      const [p, q] = pts;
      return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, ang: Math.atan2(q.y - p.y, q.x - p.x), len: Math.hypot(q.x - p.x, q.y - p.y) };
    }
    const L = []; let tot = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); L.push(d); tot += d; }
    let want = tot * u;
    for (let i = 0; i < L.length; i++) {
      if (want <= L[i] || i === L.length - 1) {
        const f = L[i] ? Math.min(1, want / L[i]) : 0, p = pts[i], q = pts[i + 1];
        return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, ang: Math.atan2(q.y - p.y, q.x - p.x), len: tot };
      }
      want -= L[i];
    }
    return { x: pts[0].x, y: pts[0].y, ang: 0, len: 0 };
  };
  // A chevron (or, on the timeline, an arrowhead where the arc comes down) added to a path.
  function arrowTo(path, pts, tl, size) {
    const m = at(pts, tl ? 1 : 0.55);
    if (m.len < 24 * size / 3) return;
    const co = Math.cos(m.ang), si = Math.sin(m.ang), pt = (dx, dy) => [m.x + dx * co - dy * si, m.y + dx * si + dy * co];
    const [a, b, c] = tl ? [pt(-size * 1.6, -size * 0.8), pt(0, 0), pt(-size * 1.6, size * 0.8)] : [pt(-size * 0.6, -size), pt(size * 0.4, 0), pt(-size * 0.6, size)];
    path.moveTo(...a); path.lineTo(...b); path.lineTo(...c);
  }
  const polyline = (path, pts, i0 = 0, i1 = pts.length - 1) => { path.moveTo(pts[i0].x, pts[i0].y); for (let i = i0 + 1; i <= i1; i++) path.lineTo(pts[i].x, pts[i].y); };
  // Every relation line, under the books. Lines at rest share one colour: they go out in a few strokes, one per
  // width (a stroke per line slows the switch between layouts). Lines that are lit, filtered for or in a cascade
  // say what they are and are drawn one by one.
  function drawLinks(ctx, scale) {
    const c = C(), groups = new Map(), one = [];
    const tl = (env.timeline()?.mix || 0) > 0.5, ring = (env.ring()?.mix || 0) > 0.5;
    for (const l of relLinks) {
      if (!l.on || !l.source.vis || !l.target.vis || !Number.isFinite(l.source.x) || !Number.isFinite(l.target.x)) continue;
      const a = linkAlpha(l);
      if (a < 0.01) continue;
      const pts = pathOf(l), lit = focusing() && litLinks.has(l);
      if (lit || env.filters.rels.size || env.cascade()) { one.push([l, pts, lit, a]); continue; }
      const w = linkW(l) / scale, key = w.toFixed(5);
      let g = groups.get(key);
      if (!g) groups.set(key, g = { w, a, path: new Path2D(), faint: new Path2D() });
      // On the circle a resting line comes in faint from the older book, so the ring is not ringed with ink.
      if (ring && pts.length > 2) { const h = pts.length >> 1; polyline(g.faint, pts, 0, h); polyline(g.path, pts, h); }
      else polyline(g.path, pts);
      arrowTo(g.path, pts, tl, 3 / scale);
    }
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = c.ink;
    const k = c.dark ? 0.32 : 0.55; // light ink on a dark page carries further
    groups.forEach(g => {
      ctx.lineWidth = g.w;
      ctx.globalAlpha = g.a * k * 0.4; ctx.stroke(g.faint);
      ctx.globalAlpha = g.a * k; ctx.stroke(g.path);
    });
    ctx.restore();
    one.forEach(([l, pts, lit, a]) => {
      const col = c.rel(l.rel);
      ctx.save();
      ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = linkW(l) / scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const dash = lit && DASH[l.contact]; // contact shows when lit; at rest every line is a plain hairline
      if (dash) ctx.setLineDash(dash.map(d => d / scale));
      const path = new Path2D();
      polyline(path, pts);
      ctx.stroke(path);
      ctx.setLineDash([]);
      const head = new Path2D();
      arrowTo(head, pts, tl, (lit ? 4.5 : 3.2) / scale);
      ctx.lineWidth = (lit ? 1.6 : 1.1) / scale; ctx.stroke(head);
      ctx.restore();
    });
  }
  function hitRel(l, color, ctx, scale) {
    const pts = l.pts || pathOf(l);
    ctx.strokeStyle = color; ctx.lineWidth = 8 / scale;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  const linkAlpha = l => (focusing() ? (litLinks.has(l) ? 1 : 0.05) : env.filters.rels.size ? REST_LINE.filtered : REST_LINE.alpha);
  const linkW = l => (CASE_W[l.case] || 1.8) * (focusing() && litLinks.has(l) ? (env.hoverLink() === l ? 0.85 : 0.6) : REST_LINE.width * 0.9);
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
    .linkVisibility(l => l.source.vis && l.target.vis && (l.kind !== 'rel' ? !inFlight && held() < 0.99 : l.on))
    .linkColor(l => withAlpha(C().ink3, (1 - held()) * (focusing() ? (litLinks.has(l) ? 0.75 : 0.03) : (C().dark ? 0.2 : 0.14))))
    .linkWidth(l => (litLinks.has(l) ? 1 : 0.5))
    .linkCanvasObjectMode(l => (l.kind === 'rel' ? 'replace' : undefined))
    .linkCanvasObject(() => {}) // drawn under the books, all at once (drawLinks)
    .linkPointerAreaPaint(hitRel)
    .linkHoverPrecision(6)
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
    .onRenderFramePost((ctx, scale) => { drawVerbs(ctx, scale); on.frame(); })
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
    const m = at(l.pts || pathOf(l), 0.5);
    return { x: m.x, y: m.y };
  }
  const local = e => { const r = stage.getBoundingClientRect(); return fg.screen2GraphCoords(e.clientX - r.left, e.clientY - r.top); };
  // The visible relation line nearest the pointer, within a few pixels, if any.
  function lineAt(e) {
    const p = local(e);
    let best = null, bd = 6 / fg.zoom();
    for (const l of relLinks) {
      if (!l.on || !l.source.vis || !l.target.vis) continue;
      const pts = l.pts || pathOf(l);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
        const d = Math.hypot(a.x + u * dx - p.x, a.y + u * dy - p.y);
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
    size: (n, scaled) => { const k = fg.zoom() * (scaled ? n.s : 1), d = (n.hitR || n.h / 2) * 2; return { w: d * k, h: d * k }; },
    mid: l => { const m = midOf(l); return fg.graph2ScreenCoords(m.x, m.y); },
    lineAt,
    bookAt(e) {
      const p = local(e), pad = (e.pointerType === 'mouse' ? 3 : 8) / fg.zoom();
      let best = null, bd = Infinity;
      for (const n of nodes) {
        if (!n.vis || !Number.isFinite(n.x) || (n.isA && held() > 0.5)) continue; // authors belong to the web
        const d = Math.hypot(p.x - n.x, p.y - n.y);
        if (d > (n.hitR || n.h / 2) + pad) continue;
        if (d < bd) { best = n; bd = d; }
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
    restyle() { nodes.forEach(n => { delete n.dot; }); },
    // On the circle and the timeline books keep their places: they are not dragged about.
    layout(name) { fg.enableNodeDrag(name === 'web'); },
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
