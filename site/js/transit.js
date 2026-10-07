// Shelves ⇄ graph: the books fly. Going to the map, every ready spine on screen lifts off its shelf and flies to its
// book's node (the volumes of one work meet there); coming back, each book on screen flies out of its node to its
// place on the shelf. FLIP: a flying spine is laid out once, where it starts, and is then moved only by transform and
// opacity, one frame at a time, toward where its node is drawn now — so a camera that is still settling, or a book
// still drifting, is followed to the end. The graph hides a node until the last of its books has landed on it.
// Under reduced motion app.js crossfades instead.

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const FLY = 880; // ms in the air
const SWEEP = 240; // left-to-right stagger across the screen
const SETTLE = 450; // longest wait, once the map is there, for its first heavy frames to pass before take-off

// A spine on screen: its rect, and a copy of the shelf's spine face to fly.
function spineOf(book) {
  const face = book.querySelector('.face.spine');
  if (!face) return null;
  const el = document.createElement('div');
  el.className = 'fly';
  el.setAttribute('style', book.getAttribute('style')); // --h --t --c --a --fs
  el.append(face.cloneNode(true));
  return el;
}
const onScreen = (r, top) => r.width > 0 && r.bottom > top && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

function layer() {
  const el = document.createElement('div');
  el.className = 'fly-layer';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  return el;
}

// One spine in the air, laid out once on box (a viewport rect: the shelf's spine, the larger end, so its lettering
// stays sharp) and moved by transform alone. from() and to() give the ends as { x, y (centre), w, h, a (opacity) },
// read every frame, so a moving node is followed.
function flyer(host, el, box, from, to, delay, fadeText) {
  el.style.cssText += `;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
  host.append(el);
  const bx = box.left + box.width / 2, by = box.top + box.height / 2;
  const tilt = (Math.random() - 0.5) * 14;
  const text = [...el.querySelectorAll('.spine > *')];
  let shown = -1; // the lettering's opacity last written: a write that changes nothing still costs a style pass
  return {
    el, delay, to,
    // e: 0..1 through the flight; lift: 0..1 how far it has risen off its starting place.
    draw(e, lift = 0) {
      const a = from(), b = to() || a;
      const ay = a.y - 10 * lift;
      const x = a.x + (b.x - a.x) * e, y = ay + (b.y - ay) * e, w = a.w + (b.w - a.w) * e, h = a.h + (b.h - a.h) * e;
      const arc = Math.sin(Math.PI * e) * Math.min(140, Math.hypot(b.x - a.x, b.y - ay) * 0.22);
      el.style.transform = `translate3d(${x - bx}px, ${y - by - arc}px, 0) rotate(${Math.sin(Math.PI * e) * tilt}deg) scale(${w / box.width}, ${h / box.height})`;
      el.style.opacity = (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * e;
      const t = Math.round((fadeText ? Math.max(0, 1 - e * 2.5) : Math.max(0, e * 2.5 - 1.5)) * 50) / 50;
      if (t !== shown) { shown = t; text.forEach(s => { s.style.opacity = t; }); }
    },
  };
}
const centre = (r, a = 1) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, a });

// Run the flights; land(f) when each arrives. A flight with nowhere to go fades where it is.
function run(host, flights, { start = () => true, land = () => {}, lift = false, done = () => {} }) {
  let raf = 0, go = 0, ready = 0, last = 0, calm = 0;
  const wait = performance.now();
  const left = new Set(flights);
  const step = now => {
    // A new map spends its first frames compiling and uploading: the books hover until two quick frames in a row.
    // (Landing on the shelves needs no wait: the map they leave is already running.)
    if (!go && (ready || (start() && (ready = now)))) {
      calm = now - last < 24 ? calm + 1 : 0;
      if (!lift || calm >= 2 || now - ready > SETTLE) { go = now; host.dataset.go = ''; } // for tools/graph_qa.py: on their way
    }
    last = now;
    const up = lift ? easeOut(Math.min(1, (now - wait) / 240)) : 0;
    if (!go) {
      left.forEach(f => f.draw(0, up));
      if (now - wait > 2500) go = now; // the map never came: let them go anyway
      raf = requestAnimationFrame(step);
      return;
    }
    left.forEach(f => {
      const p = Math.max(0, Math.min(1, (now - go - f.delay) / FLY));
      if (!f.to()) { // nowhere to land (its node is off screen): fade out on the spot, and show the node again
        f.draw(0, up);
        f.el.style.opacity = Math.max(0, 1 - p * 3);
        if (p >= 0.34) { land(f); f.el.remove(); left.delete(f); }
        return;
      }
      f.draw(easeInOut(p), up);
      if (p >= 1) { land(f); f.el.remove(); left.delete(f); }
    });
    if (left.size) raf = requestAnimationFrame(step);
    else finish();
  };
  const finish = () => { cancelAnimationFrame(raf); host.remove(); done(); };
  raf = requestAnimationFrame(step);
  return () => { // cut short (another route): put everything where it was going
    cancelAnimationFrame(raf);
    left.forEach(f => land(f));
    left.clear();
    finish();
  };
}

// Shelves → map. Call before the shelves are taken away: lifts the spines on screen off them (hiding the originals)
// and returns { slugs, take(map), cancel }. take(map) is given the graph's flight API once it has positions.
export function liftShelves(view) {
  const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
  const host = layer();
  const flights = [];
  let map = null;
  // Measure every spine before marking any of them, so the page is laid out once, not once per book.
  const seen = [...view.querySelectorAll('.book[data-status="ready"]')].map(book => [book, book.getBoundingClientRect()]);
  seen.forEach(([book, r]) => {
    if (!onScreen(r, top)) return;
    const el = spineOf(book);
    if (!el) return;
    const slug = book.dataset.slug;
    const at = centre(r);
    const f = flyer(host, el, r, () => at, () => map?.rect(slug), (r.left / innerWidth) * SWEEP, true);
    f.slug = slug;
    book.classList.add('is-out');
    flights.push(f);
  });
  const cancel = run(host, flights, { start: () => !!map, land: f => map?.land(f.slug), lift: true });
  return { slugs: flights.map(f => f.slug), take(m) { map = m; }, cancel };
}

// Map → shelves. map: the graph's flight API, still drawing; view: the shelves just drawn (scroll already restored).
// Returns { flown: Set of book elements in the air, cancel }; done() once all have landed.
export function landShelves(view, map, done = () => {}) {
  const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
  const host = layer();
  const flights = [], flown = new Set();
  const seen = [...view.querySelectorAll('.book[data-status="ready"]')].map(book => [book, book.getBoundingClientRect()]);
  seen.forEach(([book, r]) => {
    const slug = book.dataset.slug;
    if (!onScreen(r, top)) return;
    const a = map.rect(slug);
    if (!a) return;
    const el = spineOf(book);
    if (!el) return;
    const end = centre(r);
    const f = flyer(host, el, r, () => a, () => end, (r.left / innerWidth) * SWEEP, false);
    f.draw(0);
    f.book = book; f.slug = slug;
    book.classList.add('is-out');
    flown.add(book);
    flights.push(f);
  });
  map.hide(flights.map(f => f.slug));
  map.freeze();
  // Set off on the fourth frame: the first paints the shelves just drawn and the map draws its last frames before it
  // pauses (freeze), each a long frame; after them the flight runs smooth.
  let frames = 0;
  const cancel = run(host, flights, { start: () => ++frames > 3, land: f => f.book.classList.remove('is-out'), done });
  return { flown, cancel };
}
