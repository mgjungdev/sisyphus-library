// The map in space (graph.js's default when the browser has WebGL): 3d-force-graph with three.js (site/vendor). Each
// book is a standing box: the spine (facing the camera at first) in its shelf cloth with the accent gilt bands, the
// front cover in the cover cloth with a gilt frame, page edges on top, bottom and fore-edge. Its height grows with its
// relations; a book with none is small and faint. Titles are sprites that face the camera: always for related books,
// for the rest while hovered or lit. Relation lines keep the 2D rules (contact = solid / dashed / dotted, case = width,
// kind = colour, particles and an arrowhead from the older work to the newer); genres pull their books together and their names float
// in space as large faint letters. An author is a small gilt medal facing the camera, its name always shown, tied to its
// books by hairlines that pull them together. The map turns slowly until the reader takes hold of it (not under reduced
// motion).
import { isDrafts } from './catalog.js';
import { GENRES, CASE_W, PER_YEAR, shortTitle, authorForces, drawMedal } from './graph.js';

const DASH = { documented: null, probable: [7, 5], none: [1.6, 4] };
const SPIN = 0.45; // OrbitControls.autoRotateSpeed: one turn in a little over two minutes
const UP = [0, 0.26, 1]; // the first view: from the front, a little above
const FRONT = [0, 0, 1]; // the timeline, straight on
// One book's faces in its tile of the sheet: u ranges of each region.
const AT = { spine: [0, 0.3125], cover: [0.3125, 0.8125], pages: [0.8125, 0.9375], back: [0.9375, 1] };
const PAGE = '#efe7d4';

export function make3D(env) {
  const T = window.THREE;
  const { stage, nodes, links, relLinks, lit, litLinks, on } = env;
  const C = () => env.C;
  const focusing = () => lit.size > 0;
  const ease = (cur, to, k = 0.18) => cur + (to - cur) * k;

  /* ---------- forces: genre regions in a ring with depth, shelf headings, collision ---------- */
  let anchors = new Map();
  function placeAnchors() {
    const r = stage.getBoundingClientRect();
    const aspect = Math.min(2.2, Math.max(0.45, (r.width || 1280) / (r.height || 800)));
    const R = 230, rx = R * Math.sqrt(aspect), ry = R / Math.sqrt(aspect);
    anchors = new Map(GENRES.map((g, i) => {
      const t = (-85 / 180) * Math.PI + (i / GENRES.length) * Math.PI * 2;
      // y is up in three.js: the 2D map's top (Gothic) stays at the top. Neighbours step forward and back.
      return [g, { x: Math.cos(t) * rx, y: -Math.sin(t) * ry, z: (i % 2 ? 1 : -1) * 70 }];
    }));
  }
  placeAnchors();
  function clusterForce() {
    let ns = [];
    const f = alpha => {
      const heads = new Map();
      ns.forEach(n => n.heads.forEach(h => {
        const c = heads.get(h) || { x: 0, y: 0, z: 0, k: 0 };
        c.x += n.x; c.y += n.y; c.z += n.z; c.k++; heads.set(h, c);
      }));
      ns.forEach(n => {
        const a = anchors.get(n.isA ? n.home : n.genre) || { x: 0, y: 0, z: 0 };
        const k = (n.deg ? 0.03 : n.isA ? 0.05 : 0.06) * alpha; // a book leans on its author more than on its genre
        n.vx += (a.x - n.x) * k; n.vy += (a.y - n.y) * k;
        // Related books keep near the middle plane, so the web of relations faces the reader and its books do not
        // hide one another; the genre regions around it keep their depth. An author follows its books (link force).
        if (!n.isA) n.vz += ((n.deg ? 0 : a.z) - n.z) * (n.deg ? 0.08 * alpha : k);
        n.heads.forEach(h => {
          const c = heads.get(h);
          if (c.k > 1) { const s = 0.05 * alpha; n.vx += (c.x / c.k - n.x) * s; n.vy += (c.y / c.k - n.y) * s; n.vz += (c.z / c.k - n.z) * s; }
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
          const dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy, dz = b.z + b.vz - a.z - a.vz;
          const want = a.r + b.r, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= want * want) continue;
          const d = Math.sqrt(d2) || 0.01, push = (want - d) / d * 0.25;
          a.vx -= dx * push; a.vy -= dy * push; a.vz -= dz * push; b.vx += dx * push; b.vy += dy * push; b.vz += dz * push;
        }
      }
    };
    f.initialize = x => { ns = x; };
    return f;
  }

  /* ---------- books: one box geometry for all, each with its own face atlas ---------- */
  const box = new T.BoxGeometry(0.31, 1, 0.68);
  {
    // Faces in BoxGeometry order: +x front cover, -x back cover, +y top, -y bottom, +z spine, -z fore-edge.
    const regions = [AT.cover, AT.back, AT.pages, AT.pages, AT.spine, AT.pages];
    const uv = box.getAttribute('uv');
    for (let f = 0; f < 6; f++) {
      const [u0, u1] = regions[f];
      for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setX(i, u0 + uv.getX(i) * (u1 - u0)); }
    }
    uv.needsUpdate = true;
  }
  const shade = (hex, k) => { const c = new T.Color(hex); return `#${c.offsetHSL(0, 0, k).getHexString()}`; };
  // Every book's faces on one sheet, a tile each: one texture to upload, not one per book (that stalls the first
  // frame). Each book's material reads its own tile through a clone that shares the sheet's source.
  const TILE = 128, PAD = 2, COLS = 16, S = TILE - PAD * 2;
  const sheet = document.createElement('canvas');
  sheet.width = COLS * TILE;
  sheet.height = 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(nodes.length / COLS)) * TILE));
  const ink = sheet.getContext('2d');
  const sheetTex = new T.CanvasTexture(sheet);
  sheetTex.colorSpace = T.SRGBColorSpace;
  sheetTex.anisotropy = 4;
  let tiles = 0;
  function atlas(b) {
    const i = tiles++, ox = (i % COLS) * TILE + PAD, oy = Math.floor(i / COLS) * TILE + PAD;
    const x = ink, cloth = b.spine?.color || '#57605c', gilt = b.accent || '#c9a24a';
    x.save();
    x.translate(ox, oy);
    x.beginPath(); x.rect(-PAD, -PAD, TILE, TILE); x.clip();
    const col = r => [r[0] * S, (r[1] - r[0]) * S];
    // Spine: rounded cloth, light across the middle; gilt bands as on the shelf.
    let [x0, w] = col(AT.spine);
    x.fillStyle = cloth; x.fillRect(x0 - PAD, -PAD, w + PAD, TILE);
    const g = x.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,.28)'); g.addColorStop(0.32, 'rgba(255,255,255,.16)');
    g.addColorStop(0.6, 'rgba(255,255,255,.02)'); g.addColorStop(1, 'rgba(0,0,0,.32)');
    x.fillStyle = g; x.fillRect(x0, -PAD, w, TILE);
    x.fillStyle = gilt;
    const band = S * 0.035;
    x.fillRect(x0 + w * 0.08, S * 0.1, w * 0.84, band);
    x.fillRect(x0 + w * 0.08, S * 0.1 + band * 2, w * 0.84, band * 0.6);
    x.fillRect(x0 + w * 0.08, S * 0.8, w * 0.84, band);
    // Front cover: the cover cloth a shade lighter, a gilt frame and a small gilt lozenge.
    [x0, w] = col(AT.cover);
    x.fillStyle = shade(cloth, 0.035); x.fillRect(x0, -PAD, w, TILE);
    const cg = x.createLinearGradient(x0, 0, x0 + w, 0);
    cg.addColorStop(0, 'rgba(0,0,0,.22)'); cg.addColorStop(0.08, 'rgba(0,0,0,0)'); cg.addColorStop(1, 'rgba(255,255,255,.05)');
    x.fillStyle = cg; x.fillRect(x0, -PAD, w, TILE);
    x.strokeStyle = gilt; x.lineWidth = 2;
    x.strokeRect(x0 + w * 0.14, S * 0.07, w * 0.74, S * 0.86);
    x.lineWidth = 1;
    x.strokeRect(x0 + w * 0.2, S * 0.1, w * 0.62, S * 0.8);
    x.fillStyle = gilt;
    x.beginPath();
    const cx = x0 + w * 0.51, cy = S * 0.42;
    x.moveTo(cx, cy - 7); x.lineTo(cx + 4.5, cy); x.lineTo(cx, cy + 7); x.lineTo(cx - 4.5, cy); x.closePath(); x.fill();
    // Page edges: cream with faint leaves.
    [x0, w] = col(AT.pages);
    x.fillStyle = PAGE; x.fillRect(x0, -PAD, w, TILE);
    x.fillStyle = 'rgba(120,100,70,.14)';
    for (let k = 2; k < w; k += 3) x.fillRect(x0 + k, -PAD, 1, TILE);
    // Back cover: plain cloth.
    [x0, w] = col(AT.back);
    x.fillStyle = shade(cloth, -0.02); x.fillRect(x0, -PAD, w + PAD, TILE);
    x.restore();
    const t = sheetTex.clone();
    t.repeat.set(S / sheet.width, S / sheet.height);
    t.offset.set(ox / sheet.width, 1 - (oy + S) / sheet.height);
    t.needsUpdate = true; // the sheet itself is uploaded once, by whichever book is drawn first
    return t;
  }

  /* ---------- labels: text on a canvas, on a sprite that faces the camera ---------- */
  const LABEL_PX = 48;
  function textSprite(text, { italic = false, size = LABEL_PX, fill, stroke } = {}) {
    const cv = document.createElement('canvas'), x = cv.getContext('2d');
    const font = `${italic ? 'italic ' : ''}${size}px ${C().font}`;
    x.font = font;
    const pad = Math.ceil(size * 0.3), w = Math.ceil(x.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.32);
    cv.width = w; cv.height = h;
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    if (stroke) { x.lineWidth = size * 0.22; x.strokeStyle = stroke; x.strokeText(text, w / 2, h / 2); }
    x.fillStyle = fill; x.fillText(text, w / 2, h / 2);
    const t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.generateMipmaps = false; t.minFilter = T.LinearFilter;
    const m = new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 });
    const s = new T.Sprite(m);
    s.raycast = () => {}; // titles never take the pointer from books and lines
    s.aspect = w / h; s.renderOrder = 20;
    s.center.set(0.5, 0.5);
    return s;
  }
  const relabel = n => {
    if (!n.label) return;
    n.obj3.remove(n.label); n.label.material.map.dispose(); n.label.material.dispose(); n.label = null;
  };
  // Author names show from the first frame: all on one sheet (one texture to upload, not one per name, which stalls
  // the flight in from the shelves), drawn again when the theme changes.
  let names = null;
  function nameSheet() {
    if (names) return names;
    const c = C(), cv = document.createElement('canvas'), x = cv.getContext('2d');
    const px = LABEL_PX * 0.85, font = `italic ${px}px ${c.font}`, pad = Math.ceil(px * 0.3), h = Math.ceil(px * 1.32), W = 2048;
    x.font = font;
    const at = new Map();
    let cx = 0, cy = 0;
    nodes.filter(n => n.isA).forEach(n => {
      const w = Math.min(W, Math.ceil(x.measureText(n.name).width) + pad * 2);
      if (cx + w > W) { cx = 0; cy += h; }
      at.set(n, { x: cx, y: cy, w, h });
      cx += w;
    });
    cv.width = W; cv.height = 2 ** Math.ceil(Math.log2(cy + h));
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    at.forEach((r, n) => {
      x.lineWidth = px * 0.22; x.strokeStyle = c.bg; x.strokeText(n.name, r.x + r.w / 2, r.y + r.h / 2);
      x.fillStyle = c.ink; x.fillText(n.name, r.x + r.w / 2, r.y + r.h / 2);
    });
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.generateMipmaps = false; tex.minFilter = T.LinearFilter;
    return (names = { tex, at, W: cv.width, H: cv.height });
  }
  function nameSprite(n) {
    const { tex, at, W, H } = nameSheet(), r = at.get(n), t = tex.clone();
    t.repeat.set(r.w / W, r.h / H);
    t.offset.set(r.x / W, 1 - (r.y + r.h) / H);
    t.needsUpdate = true;
    const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 }));
    s.raycast = () => {};
    s.aspect = r.w / r.h; s.renderOrder = 20;
    return s;
  }
  function labelOf(n) {
    if (!n.label) {
      const c = C(), strong = n.deg > 0;
      n.label = n.isA ? nameSprite(n) : textSprite(shortTitle(n.b.title), { fill: strong ? c.ink : c.ink2, stroke: c.bg });
      n.obj3.add(n.label);
    }
    return n.label;
  }

  // Authors: gilt medals on one sheet of their own, a tile each, on sprites that face the camera.
  const MT = 64, MCOLS = 16;
  const medals = document.createElement('canvas');
  const authorCount = nodes.filter(n => n.isA).length;
  medals.width = MCOLS * MT;
  medals.height = 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(authorCount / MCOLS)) * MT));
  const medalTex = new T.CanvasTexture(medals);
  medalTex.colorSpace = T.SRGBColorSpace;
  let medalNo = 0;
  function medalObject(n) {
    const i = medalNo++, ox = (i % MCOLS) * MT, oy = Math.floor(i / MCOLS) * MT;
    const x = medals.getContext('2d');
    x.save(); x.translate(ox + MT / 2, oy + MT / 2);
    drawMedal(x, 0, 0, MT / 2 - 3, n.ini, C().font);
    x.restore();
    const t = medalTex.clone();
    t.repeat.set(MT / medals.width, MT / medals.height);
    t.offset.set(ox / medals.width, 1 - (oy + MT) / medals.height);
    t.needsUpdate = true;
    const g = new T.Group();
    // Drawn over the books and first under the pointer: a medal is small, and a book in front must not hide it.
    const sp = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
    sp.raycast = function (rc, out) {
      if (!n.vis || !g.visible) return;
      const hits = [];
      T.Sprite.prototype.raycast.call(this, rc, hits);
      hits.forEach(h => { h.distance -= 1e5; out.push(h); });
    };
    sp.scale.setScalar(n.h);
    sp.renderOrder = 10;
    g.add(sp);
    n.obj3 = g; n.mesh = sp;
    return g;
  }

  function bookObject(n) {
    if (n.obj3) return n.obj3;
    if (n.isA) return medalObject(n);
    const g = new T.Group();
    const mat = new T.MeshLambertMaterial({ map: atlas(n.b), transparent: true });
    const mesh = new T.Mesh(box, mat);
    // Hidden books (filters, or their spines in the air) are not under the pointer.
    mesh.raycast = function (rc, out) { if (n.vis && !n.away && g.visible) T.Mesh.prototype.raycast.call(this, rc, out); };
    mesh.scale.setScalar(n.h);
    g.add(mesh);
    if (n.b.status === 'proposed' && isDrafts()) { // a draft record: a small gold seal at the head
      const seal = new T.Mesh(new T.SphereGeometry(1, 10, 8), new T.MeshBasicMaterial({ color: '#d4a72c', transparent: true }));
      seal.raycast = () => {};
      g.add(seal); n.seal = seal;
    }
    n.obj3 = g; n.mesh = mesh;
    return g;
  }

  /* ---------- lines ---------- */
  const lineMats = [];
  function linkObject(l) {
    if (l.obj3) return l.obj3;
    if (l.kind === 'rel') {
      const dash = DASH[l.contact];
      const mat = new T.LineMaterial({ color: C().rel(l.rel), linewidth: CASE_W[l.case] || 1.8, transparent: true, depthWrite: false,
        dashed: !!dash, dashSize: dash?.[0] || 1, gapSize: dash?.[1] || 0, worldUnits: false });
      const r = stage.getBoundingClientRect();
      mat.resolution.set(r.width || 1, r.height || 1);
      lineMats.push(mat);
      const geo = new T.LineGeometry();
      geo.setPositions([0, 0, 0, 1, 1, 1]);
      l.obj3 = new T.Line2(geo, mat);
      // Particles: one material per line, so a line dims with its own.
      l.pmesh = new T.Mesh(new T.SphereGeometry(((CASE_W[l.case] || 1.8) + 1.6) * 0.42, 10, 8),
        new T.MeshBasicMaterial({ color: C().rel(l.rel), transparent: true, depthWrite: false }));
      // An arrowhead by the newer book, the way the particles go; it shares their material, so it dims with them.
      const ar = ((CASE_W[l.case] || 1.8) + 1.6) * 0.85;
      const cone = new T.ConeGeometry(ar, ar * 2.8, 12);
      cone.translate(0, -ar * 1.4, 0); // the tip at the origin
      l.arrow = new T.Mesh(cone, l.pmesh.material);
      l.arrow.raycast = () => {};
      l.obj3.add(l.arrow);
    } else l.obj3 = new T.Object3D(); // book -> author: drawn with all the others in one batch (hair)
    l.obj3.raycast = () => {}; // lines are found on screen, a few pixels wide (lineAt)
    return l.obj3;
  }
  // Every book -> author hairline in one draw call (one line object each slows the flight in from the shelves), its
  // brightness per line in the colours' alpha.
  const hairLinks = links.filter(l => l.kind === 'author');
  const hairPos = new Float32Array(hairLinks.length * 6), hairCol = new Float32Array(hairLinks.length * 8);
  const hairGeo = new T.BufferGeometry();
  hairGeo.setAttribute('position', new T.BufferAttribute(hairPos, 3));
  hairGeo.setAttribute('color', new T.BufferAttribute(hairCol, 4));
  const hair = new T.LineSegments(hairGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  hair.frustumCulled = false; hair.raycast = () => {};
  const hairRGB = new T.Color();
  let hairFade = 1;
  function drawHair(focus, dark) {
    hairRGB.set(C().ink3).convertSRGBToLinear();
    hairLinks.forEach((l, i) => {
      const s = l.source, t = l.target, shown = lineShown(l) && has(s) && has(t);
      const o = i * 6, q = i * 8;
      if (shown) { hairPos[o] = s.x; hairPos[o + 1] = s.y; hairPos[o + 2] = s.z; hairPos[o + 3] = t.x; hairPos[o + 4] = t.y; hairPos[o + 5] = t.z; }
      else hairPos.fill(0, o, o + 6);
      const a = !shown ? 0 : hairFade * (focus ? (litLinks.has(l) ? 0.75 : 0.03) : dark ? 0.16 : 0.12);
      for (const k of [q, q + 4]) { hairCol[k] = hairRGB.r; hairCol[k + 1] = hairRGB.g; hairCol[k + 2] = hairRGB.b; hairCol[k + 3] = a; }
    });
    hairGeo.attributes.position.needsUpdate = true;
    hairGeo.attributes.color.needsUpdate = true;
  }
  // The drawn points of a line: on the engine's curve when it bends one.
  const pointsOf = l => (l.__curve ? l.__curve.getPoints(24) : [l.source, l.target].map(n => new T.Vector3(n.x, n.y, n.z)));
  const yAxis = new T.Vector3(0, 1, 0), dir3 = new T.Vector3();
  function placeLink(obj, pos, l) {
    if (l.kind === 'rel') {
      const pts = pointsOf(l);
      obj.geometry.setPositions(pts.flatMap(p => [p.x, p.y, p.z]));
      obj.computeLineDistances();
      // The arrow's tip where the line leaves the newer book's box.
      const t = l.target, reach = t.h * (t.s || 1) * 0.5 + 3, end = new T.Vector3(t.x, t.y, t.z);
      let i = pts.length - 1;
      while (i > 1 && pts[i - 1].distanceTo(end) < reach) i--;
      l.arrow.position.copy(pts[i - 1]);
      l.arrow.quaternion.setFromUnitVectors(yAxis, dir3.subVectors(pts[i], pts[i - 1]).normalize());
    }
    return true;
  }

  /* ---------- the engine ---------- */
  const fg = ForceGraph3D({ controlType: 'orbit', rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })(stage)
    .backgroundColor('rgba(0,0,0,0)')
    .showNavInfo(false)
    .graphData({ nodes, links })
    .nodeId('id')
    .nodeLabel(() => '')
    .linkLabel(() => '')
    .nodeThreeObject(bookObject)
    .linkThreeObject(linkObject)
    .linkPositionUpdate(placeLink)
    .linkCurvature(l => (l.kind === 'rel' ? 0.18 : 0))
    .linkDirectionalParticles(l => (l.kind === 'rel' ? (l.case === 'strong' ? 4 : 3) : 0))
    .linkDirectionalParticleSpeed(l => (l.case === 'speculative' ? 0.0035 : 0.005))
    .linkDirectionalParticleThreeObject(l => l.pmesh)
    .enableNodeDrag(false)
    .d3VelocityDecay(0.32)
    .d3AlphaDecay(0.018)
    .warmupTicks(140)
    .cooldownTime(9000)
    .onNodeHover(n => { hovering = !!n; on.hoverNode(n); })
    .onNodeClick((n, ev) => on.clickNode(n, ev))
    .onBackgroundClick(ev => on.clickBackground(ev))
    .onLinkClick(l => on.clickLink(l))
    .onEngineStop(() => on.engineStop());
  authorForces(fg);
  fg.d3Force('center', null);
  fg.d3Force('cluster', clusterForce());
  fg.d3Force('collide', collideForce());
  const renderer = fg.renderer(), scene = fg.scene(), camera = fg.camera(), controls = fg.controls();
  scene.add(hair);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.debug.checkShaderErrors = false; // reading the compile log waits for the compiler: no parallel compiling
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9;
  controls.minDistance = 30; controls.maxDistance = 4000;
  controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
  const spin = !env.reduced();
  controls.autoRotate = spin; controls.autoRotateSpeed = SPIN;

  // Genre names: large faint letters floating by each region.
  const regions = new Map();
  function makeRegions() {
    regions.forEach(s => { scene.remove(s); s.material.map.dispose(); s.material.dispose(); });
    regions.clear();
    GENRES.forEach(g => {
      const s = textSprite(g, { italic: true, size: 64, fill: C().ink3 });
      s.renderOrder = 1;
      scene.add(s); regions.set(g, s);
    });
  }
  makeRegions();

  // Compile the shaders off the main thread (KHR_parallel_shader_compile) before the first frame: compiling them on
  // first use stalls the page for most of a second, mid-flight when the books are flying in from the shelves.
  let held = true, frozen = false, gone = false;
  fg.pauseAnimation();
  {
    const warm = textSprite('·', { fill: '#000' });
    scene.add(warm);
    // The engine builds the scene's objects a moment after it is given the data: compile once they are there.
    const built = () => new Promise(res => { const t0 = performance.now(); const wait = () => (nodes[0]?.obj3 || performance.now() - t0 > 1500 ? res() : setTimeout(wait, 8)); wait(); });
    built().then(() => {
      if (gone) return null;
      // The warm-up has run: on the timeline the books go to their years, and its axis is compiled with the rest.
      on.placed();
      const t = env.timeline();
      if (t) { makeAxis(t.axis); axis.g.visible = true; }
      return renderer.compileAsync?.(scene, camera);
    }).catch(() => {}).finally(() => {
      scene.remove(warm); warm.material.map.dispose(); warm.material.dispose();
      held = false;
      if (!gone) on.placed(); // (when the objects never came)
      if (!frozen && !gone) fg.resumeAnimation();
    });
  }

  /* ---------- size and the camera's units ---------- */
  const tanHalf = () => Math.tan((camera.fov * Math.PI) / 360);
  // k = 1 where one unit of the map is one pixel on screen at the camera's target, as in the 2D map's zoom.
  let stageH = 800; // kept by size(): reading it from the page mid-flight would lay the page out again
  const unitDist = () => stageH / (2 * tanHalf());
  let sized = '';
  const size = () => {
    const r = stage.getBoundingClientRect();
    stageH = r.height || stageH;
    if (`${r.width}x${r.height}` === sized) return false; // a new drawing buffer costs tens of milliseconds
    sized = `${r.width}x${r.height}`;
    fg.width(r.width).height(r.height);
    lineMats.forEach(m => m.resolution.set(r.width || 1, r.height || 1));
    return true;
  };
  size();
  const has = n => Number.isFinite(n.x) && Number.isFinite(n.z);
  const vec = n => new T.Vector3(n.x, n.y, n.z);
  const scr = p => fg.graph2ScreenCoords(p.x, p.y, p.z);
  // How many pixels one unit spans at a point.
  const pxAt = p => unitDist() / Math.max(1, camera.position.distanceTo(p));

  // Bring a set of books into a box of the stage (default: the free part), no closer than kMax, keeping the turn
  // and tilt the reader left the camera at.
  // face: turn the camera to the layout's own view (the timeline straight on, the web from a little above).
  function frame(ns, ms, kMax = 3, rect = env.freeRect(), kMin = 0.35, face = false) {
    const { W, H, left, right, top, bottom } = rect;
    const ps = ns.filter(has).map(vec);
    if (!ps.length) return { k: 1 };
    const dir = camera.position.clone().sub(controls.target);
    if (face || dir.lengthSq() < 1e-6) dir.set(...(env.layout() === 'timeline' ? FRONT : UP));
    dir.normalize();
    const right3 = new T.Vector3().crossVectors(camera.up, dir).normalize(), up3 = new T.Vector3().crossVectors(dir, right3);
    // The books' extent across, up and in depth as the camera sees them, with room for titles.
    const ext = v => { const a = ps.map(p => p.dot(v)); return [Math.min(...a), Math.max(...a)]; };
    const [r0, r1] = ext(right3), [u0, u1] = ext(up3), [z0, z1] = ext(dir);
    const hw = (r1 - r0) / 2 + 50, hh = (u1 - u0) / 2 + 40;
    const c = new T.Vector3().addScaledVector(right3, (r0 + r1) / 2).addScaledVector(up3, (u0 + u1) / 2).addScaledVector(dir, (z0 + z1) / 2);
    const th = tanHalf(), tw = th * (W / H);
    const fw = Math.max(0.2, (right - left) / W), fh = Math.max(0.2, (bottom - top) / H);
    // Far enough that the nearest books, half the depth closer, still fit.
    let d = Math.max(hw / (fw * tw), hh / (fh * th)) + (z1 - z0) / 2;
    const D = unitDist();
    d = Math.min(Math.max(d, D / kMax), D / kMin);
    // The middle of the box, not of the stage: move the target the other way by as many units.
    const per = (2 * d * th) / H, sx = ((left + right) / 2 - W / 2) * per, sy = ((top + bottom) / 2 - H / 2) * per;
    const target = c.clone().addScaledVector(right3, -sx).addScaledVector(up3, sy);
    const pos = target.clone().addScaledVector(dir, d);
    fg.cameraPosition(pos, target, ms);
    return { k: D / d, pos, target, dir, d };
  }

  // Hover: books by the engine's raycaster; lines (and books it has not caught yet) on screen, every frame.
  let hovering = false, overLine = null, ptrDirty = false;
  stage.addEventListener('pointermove', () => { ptrDirty = true; });
  function lineAt(e, all = false) {
    const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, tol = e.pointerType === 'touch' ? 12 : 6;
    let best = null, bd = tol;
    for (const l of all ? links : relLinks) {
      if (!lineShown(l) || !has(l.source) || !has(l.target)) continue;
      const pts = pointsOf(l).map(scr);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L));
        const d = Math.hypot(a.x + u * dx - px, a.y + u * dy - py);
        if (d < bd) { bd = d; best = l; }
      }
    }
    return best;
  }
  const lineShown = l => l.source.vis && l.target.vis && (l.kind !== 'rel' || l.on);

  /* ---------- every frame: visibility, brightness, sizes, titles, region names ---------- */
  let frameNo = 0, entered = false;
  // Title boxes (and related books) on screen this frame, in a grid of 64 px cells so a new title only looks at its
  // neighbours.
  const placed = new Map(), CELL = 64;
  const cells = (b, f) => {
    // Clamped to a little beyond the screen: a title far off it (or behind the camera) costs nothing.
    const c = v => Math.max(-4, Math.min(80, Math.floor(v / CELL)));
    for (let i = c(b.x0); i <= c(b.x1); i++) for (let j = c(b.y0); j <= c(b.y1); j++) f(i * 4096 + j);
  };
  const place = b => cells(b, c => { const l = placed.get(c); l ? l.push(b) : placed.set(c, [b]); });
  const crowd = b => {
    const seen = new Set();
    let m = 0;
    cells(b, c => (placed.get(c) || []).forEach(o => {
      if (seen.has(o)) return;
      seen.add(o);
      m += Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0));
    }));
    return m;
  };
  const right3 = new T.Vector3(), up3 = new T.Vector3(); // the camera's axes, for titles beside a book
  scene.onBeforeRender = () => {
    frameNo++;
    if (!entered && nodes.every(has)) { entered = true; on.placed(); setTimeout(on.firstFrame); }
    if (ptrDirty && !hovering) {
      ptrDirty = false;
      const p = env.pointer();
      const l = p ? lineAt(p, true) : null;
      if (l !== overLine) { overLine = l; on.hoverLink(l); }
    }
    controls.autoRotate = spin && !env.touched() && !hovering && !overLine && env.layout() !== 'timeline';
    const c = C(), focus = focusing();
    const inFlight = nodes.some(n => n.away); // author names wait until the books have landed
    placed.clear();
    right3.setFromMatrixColumn(camera.matrixWorld, 0); up3.setFromMatrixColumn(camera.matrixWorld, 1);
    for (const n of nodes) {
      const g = n.obj3;
      if (!g) continue;
      // Authors wait until the books flying in from the shelves have landed, then fade in.
      const show = n.vis && !env.outHidden(n) && !n.away && !(n.isA && inFlight);
      g.visible = show;
      if (n.away) { n.a = env.restAlpha(n); continue; }
      if (n.isA && inFlight) { n.a = 0; continue; }
      if (!show) continue;
      const lit1 = lit.has(n), marked = env.marked(n);
      n.a = ease(n.a, focus ? (lit1 ? 1 : 0.1) : env.restAlpha(n));
      n.s = ease(n.s, marked ? 1.18 : 1);
      n.mesh.material.opacity = n.a;
      n.mesh.scale.setScalar(n.h * n.s);
      if (n.seal) { n.seal.position.set(0, n.h * n.s / 2 + 1.6, 0); n.seal.material.opacity = n.a; }
      // Titles: always for related books, for the rest while hovered or lit.
      const dim = !focus && env.filters.rels.size && !n.relOn;
      const want = (n.isA && !inFlight) || lit1 || n === env.hoverNode() || (!focus && !dim && n.deg > 0);
      if (!want && !n.label) continue;
      const s = labelOf(n);
      // On the timeline the books' years come first: an author's name shows as the reader zooms in, or when lit.
      const mix = n.isA && !lit1 && !marked ? env.timeline()?.mix || 0 : 0;
      const named = mix ? 1 - mix * (1 - Math.max(0, Math.min(1, (pxAt(g.position) - 1.2) / 0.6))) : 1;
      s.material.opacity = ease(s.material.opacity, want ? Math.min(1, n.a + 0.15) * named : 0, 0.25);
      s.visible = s.material.opacity > 0.02;
      if (!s.visible) continue;
      // A steady size on screen, a little larger close up. Below the book if that is free, else above it, else
      // beside it; when every place is taken, the least crowded one. Placed boxes are on screen, in pixels.
      const k = pxAt(g.position), px = (n.isA ? 11.5 : n.deg || lit1 ? 12.5 : 11) * Math.min(1.45, Math.max(0.9, Math.sqrt(k)));
      const hW = (px * 1.32) / k, wW = hW * s.aspect, tw = wW * k;
      s.scale.set(wW, hW, 1);
      const ctr = scr(g.position), half = (n.h * n.s * k) / 2, side = (n.h * n.s * (n.isA ? 1 : 0.31) * k) / 2 + 6 + tw / 2;
      const at = (dx, dy) => ({ dx, dy, x0: ctr.x + dx - tw / 2, x1: ctr.x + dx + tw / 2, y0: ctr.y + dy - px / 2, y1: ctr.y + dy + px / 2 });
      const tries = [at(0, half + 5 + px / 2), at(0, -half - 5 - px / 2), at(side, 0), at(-side, 0)];
      const best = tries.find(t => !crowd(t)) || tries.reduce((m, t) => (crowd(t) < crowd(m) ? t : m));
      place(best); place({ x0: ctr.x - side + tw / 2, x1: ctr.x + side - tw / 2, y0: ctr.y - half, y1: ctr.y + half }); // its book too
      s.position.copy(right3).multiplyScalar(best.dx / k).addScaledVector(up3, -best.dy / k);
    }
    for (const l of links) {
      const o = l.obj3;
      if (!o) continue;
      const shown = lineShown(l);
      o.visible = shown;
      if (l.__photonsObj) l.__photonsObj.visible = shown;
      if (!shown) continue;
      const lit1 = litLinks.has(l);
      if (l.kind === 'rel') {
        const a = focus ? (lit1 ? 1 : 0.06) : 1;
        o.material.opacity = 0.88 * a;
        o.material.linewidth = (CASE_W[l.case] || 1.8) * (lit1 && env.hoverLink() === l ? 1.4 : 1);
        l.pmesh.material.opacity = a;
      }
    }
    hairFade = inFlight ? 0 : ease(hairFade, 1, 0.08);
    hair.visible = hairFade > 0.01;
    if (hair.visible) drawHair(focus, c.dark);
    // Region names: by the books that stay home, outward from the middle where related books gather.
    if (frameNo % 12 === 1) placeRegions();
    const k = unitDist() / camera.position.distanceTo(controls.target);
    const fade = Math.max(0, Math.min(1, (3.2 - k) / 1.4));
    const lanes = 1 - (env.timeline()?.mix || 0); // on the timeline the lanes name the genres instead
    regions.forEach(s => { s.material.opacity = s.home ? fade * lanes * (focus ? 0.22 : 0.5) : 0; s.visible = s.material.opacity > 0.01; });
    drawAxis();
    on.frame();
  };
  function placeRegions() {
    const sums = new Map();
    nodes.forEach(n => {
      if (!n.genre || n.deg || !n.vis || !has(n)) return;
      const s = sums.get(n.genre) || { x: 0, y: 0, z: 0, rr: 0, k: 0 };
      s.x += n.x; s.y += n.y; s.z += n.z; s.rr += n.x * n.x + n.y * n.y + n.z * n.z; s.k++; sums.set(n.genre, s);
    });
    regions.forEach((sp, g) => {
      const s = sums.get(g);
      sp.home = !!s;
      if (!s) return;
      const m = new T.Vector3(s.x / s.k, s.y / s.k, s.z / s.k), sd = Math.sqrt(Math.max(0, s.rr / s.k - m.lengthSq()));
      const out = new T.Vector3(m.x, m.y, 0).normalize();
      sp.position.copy(m).addScaledVector(out, sd * 1.2 + 26);
      const h = 22;
      sp.scale.set(h * sp.aspect, h, 1);
    });
  }

  /* ---------- the timeline's axis, on the plane the books stand in (z = 0, y up) ---------- */
  // A faint band on every other genre lane with its name at the lane's top left, a hairline each decade (darker every
  // fifty years), the axis along the bottom with the years under it. Built once per timeline, again for a new theme.
  let axis = null, warm = 0;
  const edgeRay = new T.Ray(), lanePlane = new T.Plane(new T.Vector3(0, 0, 1), 6), edgeAt = new T.Vector3();
  function dropAxis() {
    if (!axis) return;
    scene.remove(axis.g);
    axis.g.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    axis.tex.dispose();
    axis = null;
  }
  function makeAxis(A) {
    const c = C(), g = new T.Group();
    const band = new T.MeshBasicMaterial({ color: c.ink, transparent: true, depthWrite: false, opacity: 0 });
    A.lanes.forEach((L, i) => {
      if (!(i % 2)) return;
      const m = new T.Mesh(new T.PlaneGeometry(A.x1 - A.x0, L.y1 - L.y0), band);
      m.position.set((A.x0 + A.x1) / 2, -(L.y0 + L.y1) / 2, -8);
      m.raycast = () => {};
      g.add(m);
    });
    const lines = (pts, op) => {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pts), 3));
      const o = new T.LineSegments(geo, new T.LineBasicMaterial({ color: c.ink3, transparent: true, depthWrite: false, opacity: 0 }));
      o.raycast = () => {}; o.userData.op = op;
      g.add(o);
    };
    const across = ks => ks.flatMap(k => [k.x, -A.top, -6, k.x, -A.bottom, -6]);
    lines(across(A.ticks.filter(k => !k.major && !k.early)), 0.16);
    lines(across(A.ticks.filter(k => k.early)), 0.18);
    const base = [A.x0, -A.bottom, -6, A.x1, -A.bottom, -6, ...across(A.ticks.filter(k => k.major && !k.early))];
    if (A.brk != null) [-2.5, 2.5].forEach(o => base.push(A.brk + o - 4, -A.bottom - 8, -6, A.brk + o + 4, -A.bottom + 8, -6));
    lines(base, 0.36);
    // Years and lane names on one sheet: one texture to upload.
    const items = [...A.ticks.map(k => ({ text: k.label, fill: k.major ? c.ink2 : c.ink3 })), ...A.lanes.map(L => ({ text: L.name, italic: true, fill: c.ink3 }))];
    const cv = document.createElement('canvas'), x = cv.getContext('2d'), px = 40, pad = Math.ceil(px * 0.3), rh = Math.ceil(px * 1.32), SW = 1024;
    const font = it => `${it.italic ? 'italic ' : ''}${px}px ${c.font}`;
    let cx = 0, cy = 0;
    items.forEach(it => {
      x.font = font(it);
      it.w = Math.min(SW, Math.ceil(x.measureText(it.text).width) + pad * 2);
      if (cx + it.w > SW) { cx = 0; cy += rh; }
      it.x = cx; it.y = cy; cx += it.w;
    });
    cv.width = SW; cv.height = 2 ** Math.ceil(Math.log2(cy + rh));
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.lineWidth = px * 0.22; x.strokeStyle = c.bg;
    items.forEach(it => {
      x.font = font(it);
      x.strokeText(it.text, it.x + it.w / 2, it.y + rh / 2);
      x.fillStyle = it.fill; x.fillText(it.text, it.x + it.w / 2, it.y + rh / 2);
    });
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = T.LinearFilter;
    const sprite = it => {
      const t = tex.clone();
      t.repeat.set(it.w / SW, rh / cv.height);
      t.offset.set(it.x / SW, 1 - (it.y + rh) / cv.height);
      t.needsUpdate = true;
      const sp = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 }));
      sp.raycast = () => {}; sp.aspect = it.w / rh; sp.renderOrder = 2;
      g.add(sp);
      return sp;
    };
    const years = A.ticks.map((k, i) => {
      const sp = sprite(items[i]);
      sp.userData = { x: k.x, minor: !k.major && !k.early, op: k.major ? 0.95 : 0.75 };
      return sp;
    });
    const lanes = A.lanes.map((L, i) => {
      const sp = sprite(items[A.ticks.length + i]);
      sp.center.set(0, 1); sp.userData = { y: -L.y0, op: 0.9 };
      return sp;
    });
    g.visible = false;
    scene.add(g);
    axis = { A, g, band, years, lanes, tex };
    renderer.initTexture?.(tex); // uploaded now, not on the first frame of the switch
  }
  function drawAxis() {
    const t = env.timeline();
    if (!t) { if (axis) axis.g.visible = warm-- > 0; return; } // drawn unseen a few frames ahead: shaders compiled
    if (!axis || axis.A !== t.axis) { dropAxis(); makeAxis(t.axis); }
    const { A, g, band, years, lanes } = axis, mix = t.mix;
    g.visible = true;
    band.opacity = mix * (C().dark ? 0.06 : 0.035);
    g.children.forEach(o => { if (o.isLineSegments) o.material.opacity = mix * o.userData.op; });
    // A steady size on screen, as the titles.
    const k = unitDist() / camera.position.distanceTo(controls.target), px = 11.5, h = (px * 1.32) / k;
    const roomy = 10 * PER_YEAR * k >= 40;
    // Years under the lanes, or along the bottom of the screen (above the switch) when the lanes run below it.
    const W = stage.clientWidth, H = stage.clientHeight;
    const at = (px0, py0) => {
      edgeRay.origin.setFromMatrixPosition(camera.matrixWorld);
      edgeRay.direction.set((px0 / W) * 2 - 1, 1 - (py0 / H) * 2, 0.5).unproject(camera).sub(edgeRay.origin).normalize();
      return edgeRay.intersectPlane(lanePlane, edgeAt);
    };
    const floor = at(W / 2, H - 70) ? edgeAt.y + (px * 0.66) / k : -Infinity;
    const yy = Math.min(-A.top, Math.max(-A.bottom - (5 + px * 0.66) / k, floor));
    years.forEach(s => {
      s.visible = roomy || !s.userData.minor;
      s.material.opacity = mix * s.userData.op;
      s.scale.set(h * s.aspect, h, 1);
      s.position.set(s.userData.x, yy, -6);
    });
    // Lane names at the lanes' left end, or at the screen's left edge when the lanes begin off it (phones).
    const left = at(10, H / 2) ? edgeAt.x : -Infinity;
    lanes.forEach(s => {
      const hh = (12 * 1.32) / k;
      s.material.opacity = mix * s.userData.op;
      s.scale.set(hh * s.aspect, hh, 1);
      s.position.set(Math.max(A.x0 + 6 / k, left), s.userData.y - 2 / k, -6);
    });
  }

  /* ---------- the entrance and camera flights ---------- */
  let flying = 0, resting = 0;
  function flyTo(n, ms = 750) {
    const D = unitDist(), cur = D / camera.position.distanceTo(controls.target);
    const k = Math.max(cur, stage.clientWidth < 640 ? 2.2 : 2.6), d = D / k;
    const dir = camera.position.clone().sub(controls.target).normalize(), target = vec(n);
    fg.cameraPosition(target.clone().addScaledVector(dir, d), target, ms);
    return new Promise(res => { clearTimeout(flying); flying = setTimeout(() => { flying = 0; res(); }, ms + 30); });
  }

  return {
    fg,
    mode: '3d',
    has,
    screen: n => scr(n),
    size(n, scaled) {
      const k = pxAt(vec(n)), h = n.h * (scaled ? n.s : 1) * k;
      return { w: h * 0.31, h };
    },
    mid: l => scr(l.__curve ? l.__curve.getPoint(0.5) : vec(l.source).add(vec(l.target)).multiplyScalar(0.5)),
    lineAt,
    bookAt(e) {
      const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, pad = e.pointerType === 'mouse' ? 3 : 10;
      let best = null, bd = Infinity;
      for (const n of nodes) {
        if (!n.vis || !has(n)) continue;
        const p = scr(n), k = pxAt(vec(n)), hw = (n.h * (n.isA ? 1 : 0.4) * k) / 2 + pad, hh = (n.h * k) / 2 + pad;
        const dx = Math.abs(px - p.x), dy = Math.abs(py - p.y);
        if (dx > hw || dy > hh) continue;
        const d = camera.position.distanceTo(vec(n)) - (n.isA ? 1e5 : 0); // the nearest book in front; an author first
        if (d < bd) { best = n; bd = d; }
      }
      return best;
    },
    frame: (ns, ms, kMax, face) => frame(ns, ms, kMax, env.freeRect(), 0.35, face),
    showPair(l, [x0, y0, x1, y1], ms) {
      frame([l.source, l.target], ms, 3.2, { W: stage.clientWidth, H: stage.clientHeight, left: x0, right: x1, top: y0, bottom: y1 }, 0.6);
    },
    flyTo,
    enter({ pin, arrive, reduced, fit, focusOn }) {
      camera.position.set(...(env.layout() === 'timeline' ? FRONT : UP)); controls.target.set(0, 0, 0); // only the direction counts: fit() sets the distance
      const f = fit(0);
      if (reduced) { if (pin) focusOn(pin, 0); return; }
      if (!f.pos) return;
      fg.cameraPosition(f.target.clone().addScaledVector(f.dir, f.d / (arrive ? 1.1 : 1.6)), f.target, 0);
      if (pin) focusOn(pin, arrive ? 1000 : 1400);
      else fg.cameraPosition(f.pos, f.target, arrive ? 1000 : 1400);
    },
    refresh() {},
    layout() {},
    // The timeline's axis built ahead, while the map is idle.
    prepare(A) { if (!axis || axis.A !== A) { dropAxis(); makeAxis(A); warm = 3; } },
    // soft: the forces cool to almost nothing over the switch (all books are held), so none is kicked when let go.
    reheat(soft) { fg.d3AlphaDecay(soft ? 0.05 : 0.018).d3ReheatSimulation(); },
    // Let the forces come to rest within a few frames (books released where they were).
    rest() { fg.d3AlphaDecay(0.3); clearTimeout(resting); resting = setTimeout(() => fg.d3AlphaDecay(0.018), 800); },
    restyle() {
      const c = C();
      dropAxis();
      nodes.forEach(relabel);
      names?.tex.dispose(); names = null;
      makeRegions(); placeRegions();
      links.forEach(l => {
        if (!l.obj3 || l.kind !== 'rel') return;
        l.obj3.material.color.set(c.rel(l.rel));
        l.pmesh?.material.color.set(c.rel(l.rel));
      });
    },
    resize() { if (size()) { placeAnchors(); fg.d3ReheatSimulation(); } },
    cam() {
      const t = controls.target, p = camera.position, d = p.distanceTo(t);
      return { x: t.x, y: t.y, z: t.z, k: unitDist() / d, az: Math.atan2(p.x - t.x, p.z - t.z) * 180 / Math.PI,
        el: Math.asin(Math.max(-1, Math.min(1, (p.y - t.y) / d))) * 180 / Math.PI };
    },
    still() { controls.autoRotate = false; },
    freeze() { frozen = true; requestAnimationFrame(() => requestAnimationFrame(() => fg.pauseAnimation())); },
    destroy() {
      clearTimeout(flying); clearTimeout(resting); gone = true;
      fg.pauseAnimation();
      scene.onBeforeRender = () => {};
      // Freeing the GPU's copies takes a while: not while books may still be flying out of the map.
      setTimeout(() => {
        nodes.forEach(n => { relabel(n); n.mesh?.material.map.dispose(); n.mesh?.material.dispose(); delete n.obj3; delete n.mesh; delete n.seal; });
        links.forEach(l => { delete l.obj3; delete l.pmesh; });
        sheetTex.dispose(); medalTex.dispose(); names?.tex.dispose(); dropAxis();
        hairGeo.dispose(); hair.material.dispose();
        fg._destructor?.();
        renderer.dispose();
        renderer.forceContextLoss?.();
      }, 1500);
    },
  };
}
