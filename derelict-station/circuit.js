// Circuit panel: rotate conduit tiles until power runs from the port to the
// lock. A module: createCircuit() takes a puzzle config and two canvases and
// reports progress through onChange and onSolved.
//
// The puzzle always lives in one canonical layout (port on the west, lock on
// the east). Narrow screens show it rotated a quarter turn (port on top), so
// every player gets the same puzzle whichever way it is drawn.

const CORE = 96;                                  // lock core sprite size
const ROT_MS = 130, FILL_MS = 45, STAGGER_MS = 100; // turn, fill frame, cascade step
export const N = 1, E = 2, S = 4, W = 8;
const DIRS = [[N, -1, 0, S], [E, 0, 1, W], [S, 1, 0, N], [W, 0, -1, E]]; // bit, dr, dc, facing bit
export const rotCW = (m) => ((m << 1) | (m >> 3)) & 15;
export const rotCCW = (m) => ((m >> 1) | (m << 3)) & 15;
import { createSparks, drawSparks } from "./sparks.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- puzzle ----------

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seeded spanning tree over the grid (every tile is on the route), then
// each tile turned a random amount.
export function generate(size, seed) {
  const rng = mulberry32(seed);
  const w = size, h = size;
  const sol = Array.from({ length: h }, () => new Array(w).fill(0));
  const src = Math.floor(rng() * h), dst = Math.floor(rng() * h);
  const parent = Array.from({ length: w * h }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edges = [];
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      if (c < w - 1) edges.push([r, c, r, c + 1, E, W]);
      if (r < h - 1) edges.push([r, c, r + 1, c, S, N]);
    }
  for (let i = edges.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  for (const [r1, c1, r2, c2, b1, b2] of edges) {
    const a = find(r1 * w + c1), b = find(r2 * w + c2);
    if (a !== b) { parent[a] = b; sol[r1][c1] |= b1; sol[r2][c2] |= b2; }
  }
  sol[src][0] |= W;
  sol[dst][w - 1] |= E;
  let cur;
  for (let tries = 0; tries < 50; tries++) {
    cur = sol.map((row) => row.map((m) => {
      let k = Math.floor(rng() * 4), x = m;
      while (k--) x = rotCW(x);
      return x;
    }));
    if (!trace({ w, h, src, dst, cur }).lockPowered) break;
  }
  return { w, h, src, dst, sol, start: cur.map((r) => r.slice()), cur };
}

// Breadth-first from the port: each powered tile's distance and entry side
// (for the flow effect), plus tiles with a conduit to nowhere.
export function trace(p) {
  const { w, h, src, dst, cur } = p;
  const dist = Array.from({ length: h }, () => new Array(w).fill(-1));
  const entry = Array.from({ length: h }, () => new Array(w).fill(0));
  const queue = [];
  if (cur[src][0] & W) { dist[src][0] = 0; entry[src][0] = W; queue.push([src, 0]); }
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    for (const [bit, dr, dc, face] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (!(cur[r][c] & bit) || rr < 0 || rr >= h || cc < 0 || cc >= w) continue;
      if (cur[rr][cc] & face && dist[rr][cc] < 0) {
        dist[rr][cc] = dist[r][c] + 1; entry[rr][cc] = face; queue.push([rr, cc]);
      }
    }
  }
  const leaks = new Set();
  for (const [r, c] of queue)
    for (const [bit, dr, dc, face] of DIRS) {
      if (!(cur[r][c] & bit)) continue;
      if ((r === src && c === 0 && bit === W) || (r === dst && c === w - 1 && bit === E)) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= h || cc < 0 || cc >= w || !(cur[rr][cc] & face)) leaks.add(r * w + c);
    }
  const lockPowered = dist[dst][w - 1] >= 0 && (cur[dst][w - 1] & E) !== 0;
  return { dist, entry, leaks, count: queue.length, lockPowered };
}

// ---------- art ----------

const loadImage = (src) => new Promise((ok, fail) => {
  const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error(src)); im.src = src;
});

// Tile pack (manifest.json from tools/pixellab/pack.py) and lock core frames.
export async function loadCircuitArt(base) {
  const [manifest, sprites] = await Promise.all(
    ["manifest.json", "sprites.json"].map((u) => fetch(`${base}/${u}`).then((r) => r.json())));
  const T = manifest.tile_size[0];
  const tiles = {};
  await Promise.all(manifest.tiles.flatMap((t) => Object.entries(t.files).map(async ([state, f]) => {
    (tiles[t.mask] ??= {})[state] = await loadImage(`${base}/${f}`);
  })));
  const floor = await loadImage(`${base}/${manifest.extras[0]}`);
  // Fill clips: power entering a tile from one edge, off art to lit art. Each
  // is a horizontal sprite strip, cut into one canvas per frame here.
  const bit = { N, E, S, W }, fill = {};
  await Promise.all(Object.entries(manifest.fill || {}).flatMap(([sides, byEdge]) =>
    Object.entries(byEdge).map(async ([edge, clip]) => {
      const strip = await loadImage(`${base}/${clip.strip}`);
      const mask = [...sides].reduce((m, c) => m | bit[c], 0);
      (fill[mask] ??= {})[bit[edge]] = Array.from({ length: clip.frames }, (_, i) => {
        const cv = Object.assign(document.createElement("canvas"), { width: T, height: T });
        cv.getContext("2d").drawImage(strip, i * T, 0, T, T, 0, 0, T, T);
        return cv;
      });
    })));
  const core = {};
  for (const [name, frames] of Object.entries(sprites.core))
    core[name] = await Promise.all(frames.map((f) => loadImage(`${base}/${f}`)));
  return { T, tiles, floor, core, fill, wires: wirePixels(tiles, T) };
}

// Each tile's wire pixels, from its lit art: bright and clearly more green or
// blue than red (the white-hot core included, the grey panel left out).
function wirePixels(tiles, T) {
  const out = {};
  const cv = Object.assign(document.createElement("canvas"), { width: T, height: T });
  const cx = cv.getContext("2d", { willReadFrequently: true });
  for (const [mask, states] of Object.entries(tiles)) {
    cx.clearRect(0, 0, T, T); cx.drawImage(states.base, 0, 0);
    const d = cx.getImageData(0, 0, T, T).data, px = [];
    for (let i = 0; i < T * T; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      if (Math.max(r, g, b) > 120 && Math.max(g, b) - r > 45) px.push(i);
    }
    out[mask] = px;
  }
  return out;
}

// ---------- the panel ----------

export function createCircuit({ art, board, core, size, seed, rule = "lock", saved, onChange, onSolved }) {
  const T = art.T;
  const ctx = board.getContext("2d", { willReadFrequently: true });
  const cctx = core.getContext("2d");
  core.width = core.height = CORE;
  const p = generate(size, seed);
  if (saved?.cur) p.cur = saved.cur.map((r) => r.slice());
  let moves = saved?.moves ?? 0, power, solvedAt = null, raf = 0;
  let orient = "h", cursor = [p.src, 0], keyboard = false;
  const anims = new Map(), fills = new Map(), flowCache = new Map(), clock = performance.now();
  let lockFill = null;
  const sparks = createSparks({ step(s, dt) {
    s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt;
    return s.p[0] >= 0 && s.p[1] >= 0 && s.p[0] < board.width && s.p[1] < board.height;
  } });
  // A spark leaving an open end: on the edge's wire, spraying outward.
  const OUT = { [N]: [0, -1], [E]: [1, 0], [S]: [0, 1], [W]: [-1, 0] };
  const sparkFrom = (x, y, bit) => {
    const out = OUT[bit], side = [-out[1], out[0]], j = (Math.random() * 2 - 1) * 2.5;
    return { p: [0, 1].map((k) => [x, y][k] + T / 2 + out[k] * (T / 2 - 0.5) + side[k] * j), out, side };
  };

  // Canonical (r, c) to what's drawn: "h" as is, "v" a quarter turn clockwise.
  const toView = (r, c) => (orient === "h" ? [r, c] : [c, p.h - 1 - r]);
  const fromView = (vr, vc) => (orient === "h" ? [vr, vc] : [p.h - 1 - vc, vr]);
  const viewMask = (m) => (orient === "h" ? m : rotCW(m));
  const viewDims = () => (orient === "h" ? [p.h, p.w] : [p.w, p.h]);   // rows, cols of the grid
  const at = (r, c) => {                                              // canvas px of a cell
    const [vr, vc] = toView(r, c);
    return orient === "h" ? [T + vc * T, vr * T] : [vc * T, T + vr * T];
  };

  const isSolved = () => power.lockPowered &&
    (rule === "lock" || (power.count === p.w * p.h && power.leaks.size === 0));

  // After a change, tiles that just gained power fill from their entry edge,
  // cascading outward; tiles that lost it (without being turned) drain.
  function update(turned = -1) {
    const prev = power;
    power = trace(p);
    if (prev && !reduceMotion) {
      const now = performance.now() + (turned >= 0 ? ROT_MS : 0), gained = [];
      for (let r = 0; r < p.h; r++)
        for (let c = 0; c < p.w; c++) {
          const i = r * p.w + c, was = prev.dist[r][c] >= 0, is = power.dist[r][c] >= 0;
          if (!was && is) gained.push([i, power.dist[r][c], power.entry[r][c], p.cur[r][c]]);
          else if (was && !is && i !== turned) fills.set(i, { t0: now, entry: prev.entry[r][c], mask: p.cur[r][c], drain: true });
          else if (!is) fills.delete(i);
        }
      const d0 = Math.min(...gained.map((g) => g[1]));
      for (const [i, d, entry, mask] of gained) fills.set(i, { t0: now + (d - d0) * STAGGER_MS, entry, mask, drain: false });
      if (!prev.lockPowered && power.lockPowered)
        lockFill = { t0: now + (power.dist[p.dst][p.w - 1] + 1 - (gained.length ? d0 : 0)) * STAGGER_MS };
      if (!power.lockPowered) lockFill = null;
    }
    const state = solvedAt ? "online" : power.lockPowered ? "live" : "dead";
    onChange?.({ state, moves, powered: power.count, total: p.w * p.h, leaks: power.leaks.size,
      cur: p.cur.map((r) => r.slice()) });
    if (!solvedAt && isSolved()) {
      solvedAt = performance.now();
      update();
      onSolved?.({ moves });
    }
  }

  function rotate(r, c, dir) {
    if (solvedAt || r < 0 || r >= p.h || c < 0 || c >= p.w) return;
    // Spin in the state it had before the turn, so a tile this turn connects
    // doesn't flash lit before its fill clip starts from dark.
    anims.set(r * p.w + c, { from: p.cur[r][c], state: tileState(r, c), dir, t0: performance.now() });
    fills.delete(r * p.w + c);
    p.cur[r][c] = dir > 0 ? rotCW(p.cur[r][c]) : rotCCW(p.cur[r][c]);
    moves++; update(r * p.w + c);
  }

  function cellAt(ev) {
    const rect = board.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (board.width / rect.width) - (orient === "h" ? T : 0);
    const y = (ev.clientY - rect.top) * (board.height / rect.height) - (orient === "h" ? 0 : T);
    const [rows, cols] = viewDims(), vr = Math.floor(y / T), vc = Math.floor(x / T);
    return vr >= 0 && vr < rows && vc >= 0 && vc < cols ? fromView(vr, vc) : null;
  }

  const onPointer = (ev) => {
    keyboard = false;
    const cell = cellAt(ev);
    if (!cell) return;
    cursor = cell;
    rotate(cell[0], cell[1], ev.button === 2 || ev.shiftKey ? -1 : 1);
  };
  const onKey = (ev) => {
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[ev.key];
    if (move) {
      const [rows, cols] = viewDims(), [vr, vc] = toView(...cursor);
      cursor = fromView(Math.max(0, Math.min(rows - 1, vr + move[0])), Math.max(0, Math.min(cols - 1, vc + move[1])));
    } else if (ev.key === "Enter" || ev.key === " ") {
      rotate(cursor[0], cursor[1], ev.shiftKey ? -1 : 1);
    } else return;
    keyboard = true; ev.preventDefault();
  };
  const noMenu = (ev) => ev.preventDefault();
  const onBlur = () => { keyboard = false; };
  board.addEventListener("pointerdown", onPointer);
  board.addEventListener("keydown", onKey);
  board.addEventListener("contextmenu", noMenu);
  board.addEventListener("blur", onBlur);

  function flowPixels(mask, entry) {
    const key = mask * 16 + entry;
    if (!flowCache.has(key)) {
      const m = (T - 1) / 2;
      const [ex, ey] = { [N]: [m, 0], [E]: [T - 1, m], [S]: [m, T - 1], [W]: [0, m] }[entry];
      flowCache.set(key, art.wires[mask].map((i) => [i, Math.abs((i % T) - ex) + Math.abs(Math.floor(i / T) - ey)]));
    }
    return flowCache.get(key);
  }

  // The frame of a fill (or, reversed, drain) clip for now; before it starts,
  // the tile's off (or lit) art; null once it has finished or has no clip.
  function clipFrame(f, mask, entry, now, done) {
    if (!f) return null;
    const clip = art.fill[viewMask(mask)]?.[viewMask(entry)];
    const k = Math.floor((now - f.t0) / FILL_MS);
    if (!clip || k >= clip.length) { done(); return null; }
    if (k < 0) return art.tiles[viewMask(mask)][f.drain ? "base" : "off"];
    return clip[f.drain ? clip.length - 1 - k : k];
  }

  const tileState = (r, c) => power.dist[r][c] < 0 ? "off"
    : power.leaks.has(r * p.w + c) ? "fault" : solvedAt ? "powered" : "base";

  function draw(now) {
    raf = requestAnimationFrame(draw);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#06090d"; ctx.fillRect(0, 0, board.width, board.height);
    for (let r = 0; r < p.h; r++) {                              // floor beside the grid
      if (r !== p.src) ctx.drawImage(art.floor, ...at(r, -1));
      if (r !== p.dst) ctx.drawImage(art.floor, ...at(r, p.w));
    }
    ctx.drawImage(art.tiles[viewMask(E)].base, ...at(p.src, -1));  // the port, always live
    const lockState = solvedAt ? "powered" : power.lockPowered ? "base" : "off";
    ctx.drawImage(clipFrame(lockFill, W, W, now, () => { lockFill = null; }) || art.tiles[viewMask(W)][lockState], ...at(p.dst, p.w));

    const flowing = [];
    for (let r = 0; r < p.h; r++)
      for (let c = 0; c < p.w; c++) {
        const [x, y] = at(r, c), a = anims.get(r * p.w + c);
        const k = a ? Math.min(1, Math.max(0, now - a.t0) / 130) : 1;
        if (a && (k >= 1 || reduceMotion)) anims.delete(r * p.w + c);
        if (a && k < 1 && !reduceMotion) {
          ctx.save();
          ctx.translate(x + T / 2, y + T / 2); ctx.rotate(a.dir * k * Math.PI / 2);
          ctx.drawImage(art.tiles[viewMask(a.from)][a.state], -T / 2, -T / 2);
          ctx.restore();
        } else {
          const i = r * p.w + c, f = fills.get(i);
          const clip = f && clipFrame(f, f.mask, f.entry, now, () => fills.delete(i));
          ctx.drawImage(clip || art.tiles[viewMask(p.cur[r][c])][tileState(r, c)], x, y);
          if (power.dist[r][c] >= 0 && !fills.has(i))
            flowing.push([x, y, viewMask(p.cur[r][c]), viewMask(power.entry[r][c]), power.dist[r][c]]);
        }
      }

    if (!reduceMotion) {
      flowing.push([...at(p.src, -1), viewMask(E), viewMask(W), -1]);
      if (power.lockPowered) flowing.push([...at(p.dst, p.w), viewMask(W), viewMask(W), power.dist[p.dst][p.w - 1] + 1]);
      const img = ctx.getImageData(0, 0, board.width, board.height), d = img.data, bw = board.width;
      // Powered wire rests at ~60% brightness and pulses sweep it to full,
      // travelling outward from the port and in step across tiles.
      const L = 30, travel = (now / 1000) * 40;
      for (const [x0, y0, mask, entry, dist] of flowing)
        for (const [i, along] of flowPixels(mask, entry)) {
          const ph = (((dist * T + along - travel) % L) + L) % L;
          const peak = Math.max(0, 1 - Math.min(ph, L - ph) / 6);
          const k = 0.6 + 0.4 * peak, white = Math.max(0, peak - 0.5) * 0.9;
          const o = ((y0 + Math.floor(i / T)) * bw + x0 + (i % T)) * 4;
          for (let ch = o; ch < o + 3; ch++) { const v = d[ch] * k; d[ch] = v + (255 - v) * white; }
        }
      ctx.putImageData(img, 0, 0);
    }

    if (!reduceMotion) {                             // sparks from powered open ends
      const emitters = new Map();
      if (!solvedAt) for (const i of power.leaks) {
        const r = Math.floor(i / p.w), c = i % p.w;
        if (fills.has(i) || anims.has(i)) continue;
        for (const [bit, dr, dc, face] of DIRS) {
          const rr = r + dr, cc = c + dc;
          if (!(p.cur[r][c] & bit) || (r === p.src && c === 0 && bit === W) || (r === p.dst && c === p.w - 1 && bit === E)) continue;
          if (rr >= 0 && rr < p.h && cc >= 0 && cc < p.w && p.cur[rr][cc] & face) continue;
          const [x, y] = at(r, c), vb = viewMask(bit);
          emitters.set(i * 16 + bit, () => sparkFrom(x, y, vb));
        }
      }
      drawSparks(ctx, sparks(emitters, now), (q) => q);
    }

    if (keyboard && document.activeElement === board) {
      const [x, y] = at(...cursor);
      ctx.strokeStyle = "#45e4ef"; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    }

    // Lock core: idle loop, then the unlock clip once, then its last frame.
    let frame;
    if (solvedAt) {
      const i = reduceMotion ? art.core.unlock.length - 1 : Math.floor(Math.max(0, now - solvedAt) / 95);
      frame = art.core.unlock[Math.min(i, art.core.unlock.length - 1)];
    } else {
      frame = art.core.idle[reduceMotion ? 0 : Math.floor(Math.max(0, now - clock) / 120) % art.core.idle.length];
    }
    cctx.imageSmoothingEnabled = false;
    cctx.clearRect(0, 0, CORE, CORE); cctx.drawImage(frame, 0, 0);
  }

  // Pick the layout and the largest whole-number scale that fits; below 1x it
  // shrinks to fit rather than overflow.
  function fit(availW, availH) {
    const dims = { h: [(p.w + 2) * T, p.h * T], v: [p.h * T, (p.w + 2) * T] };
    const scale = (o) => Math.min(availW / dims[o][0], availH / dims[o][1]);
    orient = Math.floor(scale("v")) > Math.floor(scale("h")) ? "v" : "h";
    const [nw, nh] = dims[orient], s = scale(orient);
    const k = s >= 1 ? Math.min(4, Math.floor(s)) : s;
    board.width = nw; board.height = nh;
    board.style.width = `${nw * k}px`; board.style.height = `${nh * k}px`;
    // Stacked (narrow) layouts keep the core at 1x so the board keeps its room.
    const coreScale = orient === "v" ? 1 : Math.max(1, Math.min(2, Math.floor(k)));
    core.style.width = core.style.height = `${CORE * coreScale}px`;
    return { orient, scale: k };
  }

  update();
  raf = requestAnimationFrame(draw);
  return {
    fit,
    reset() { if (!solvedAt) { p.cur = p.start.map((r) => r.slice()); moves = 0; update(); } },
    destroy() {
      cancelAnimationFrame(raf);
      board.removeEventListener("pointerdown", onPointer);
      board.removeEventListener("keydown", onKey);
      board.removeEventListener("contextmenu", noMenu);
      board.removeEventListener("blur", onBlur);
    },
  };
}
