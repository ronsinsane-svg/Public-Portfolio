// Cube panel: the circuit puzzle on the six faces of a cube. Conduits wrap
// across the cube's edges, power starts at a marked port tile in the middle of
// the front face, and the lock is the middle tile of the back face.
//
// Same interface as createCircuit(): a puzzle config in, onChange and onSolved
// out. Faces are drawn with the tile pack into one texture (so fills, flow and
// power states work as on the flat panels) and rendered with plain WebGL at a
// low resolution, scaled up with square pixels to stay pixel art.

import { N, E, S, W, rotCW, rotCCW, mulberry32 } from "./circuit.js";
import { createSparks, drawSparks } from "./sparks.js";

const CORE = 96, ROT_MS = 130, FILL_MS = 45, STAGGER_MS = 100, SPIN_MS = 260, SHOW_MS = 450;
const RES = 256;                                   // rendered size, before upscaling
const VIEW = 1.75;                                 // half-width of the view, cube half-size is 1
const BITS = [N, E, S, W];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Each face: outward normal n, and the directions that are right (u) and down
// (v) on the face when seen from outside. A tile's E side points along u, S
// along v.
const FACES = [
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },    // front
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },   // right
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },  // back
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },   // left
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },     // top
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },   // bottom
];
const add = (a, b, k = 1) => a.map((x, i) => x + b[i] * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dirOf = (f, bit) => ({ [E]: f.u, [W]: f.u.map((x) => -x), [S]: f.v, [N]: f.v.map((x) => -x) })[bit];

// ---------- the puzzle graph ----------

// Tiles and, for each tile and side, the neighbouring tile and the side of it
// that faces back. Positions are in doubled tile units so they stay integers.
function buildGraph(n) {
  const tiles = [], at = new Map(), key = (p) => p.join(",");
  FACES.forEach((f, fi) => {
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const p = add(add(f.n.map((x) => x * n), f.u, 2 * c - (n - 1)), f.v, 2 * r - (n - 1));
        at.set(key(p), tiles.length);
        tiles.push({ f: fi, r, c, p });
      }
  });
  const nbr = tiles.map((t) => {
    const f = FACES[t.f], out = {};
    for (const bit of BITS) {
      const d = dirOf(f, bit);
      let q = add(t.p, d, 2), back = null;
      if (Math.abs(dot(q, d)) > n - 1) {            // over the edge onto the face facing d
        q = add(add(t.p, d, 1), f.n, -1);
        const g = FACES.findIndex((x) => dot(x.n, d) === 1);
        back = BITS.find((b) => dot(dirOf(FACES[g], b), f.n) === 1);
      } else back = { [N]: S, [S]: N, [E]: W, [W]: E }[bit];
      out[bit] = [at.get(key(q)), back];
    }
    return out;
  });
  return { tiles, nbr };
}

export function generateCube(n, seed) {
  const rng = mulberry32(seed);
  const { tiles, nbr } = buildGraph(n);
  const sol = new Array(tiles.length).fill(0);
  const parent = tiles.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edges = [];
  tiles.forEach((_, i) => BITS.forEach((b) => { const [j, bj] = nbr[i][b]; if (i < j) edges.push([i, b, j, bj]); }));
  for (let i = edges.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  for (const [i, b, j, bj] of edges) {
    const a = find(i), c = find(j);
    if (a !== c) { parent[a] = c; sol[i] |= b; sol[j] |= bj; }
  }
  const mid = Math.floor(n / 2), idx = (f) => tiles.findIndex((t) => t.f === f && t.r === mid && t.c === mid);
  const src = idx(0), dst = idx(2);
  let cur;
  for (let tries = 0; tries < 50; tries++) {
    cur = sol.map((m, i) => { if (i === src) return m; let k = Math.floor(rng() * 4), x = m; while (k--) x = rotCW(x); return x; });
    if (!traceCube({ tiles, nbr, cur, src, dst }).lockPowered) break;
  }
  return { n, tiles, nbr, sol, src, dst, start: cur.slice(), cur };
}

export function traceCube(p) {
  const dist = new Array(p.tiles.length).fill(-1), entry = new Array(p.tiles.length).fill(0);
  const queue = [p.src];
  dist[p.src] = 0;
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    for (const b of BITS) {
      if (!(p.cur[i] & b)) continue;
      const [j, bj] = p.nbr[i][b];
      if (p.cur[j] & bj && dist[j] < 0) { dist[j] = dist[i] + 1; entry[j] = bj; queue.push(j); }
    }
  }
  const leaks = new Set();
  for (const i of queue)
    for (const b of BITS) {
      if (!(p.cur[i] & b)) continue;
      const [j, bj] = p.nbr[i][b];
      if (!(p.cur[j] & bj)) leaks.add(i);
    }
  return { dist, entry, leaks, count: queue.length, lockPowered: dist[p.dst] >= 0 };
}

// ---------- small matrix helpers (3x3, row-major) ----------

const mul = (a, b) => Array.from({ length: 9 }, (_, i) =>
  a[(i / 3 | 0) * 3] * b[i % 3] + a[(i / 3 | 0) * 3 + 1] * b[3 + i % 3] + a[(i / 3 | 0) * 3 + 2] * b[6 + i % 3]);
const rotX = (t) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const rotY = (t) => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
function toQuat([a, b, c, d, e, f, g, h, i]) {
  const t = a + e + i;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; return [(h - f) / s, (c - g) / s, (d - b) / s, s / 4]; }
  if (a > e && a > i) { const s = Math.sqrt(1 + a - e - i) * 2; return [s / 4, (b + d) / s, (c + g) / s, (h - f) / s]; }
  if (e > i) { const s = Math.sqrt(1 + e - a - i) * 2; return [(b + d) / s, s / 4, (f + h) / s, (c - g) / s]; }
  const s = Math.sqrt(1 + i - a - e) * 2; return [(c + g) / s, (f + h) / s, s / 4, (d - b) / s];
}
const fromQuat = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
  2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
function slerp(m0, m1, t) {                        // shortest turn from one orientation to another
  const a = toQuat(m0), b = toQuat(m1);
  let d = a.reduce((s, x, i) => s + x * b[i], 0);
  if (d < 0) { b.forEach((x, i) => (b[i] = -x)); d = -d; }
  const th = Math.acos(Math.min(1, d)), sn = Math.sin(th);
  const ka = sn < 1e-6 ? 1 - t : Math.sin((1 - t) * th) / sn, kb = sn < 1e-6 ? t : Math.sin(t * th) / sn;
  const q = a.map((x, i) => x * ka + b[i] * kb), len = Math.hypot(...q);
  return fromQuat(q.map((x) => x / len));
}

// ---------- rendering ----------

const VERT = `
attribute vec3 aPos; attribute vec2 aUv; attribute vec3 aNormal;
uniform mat3 uRot; uniform float uView;
varying vec2 vUv; varying float vShade;
void main() {
  vec3 p = uRot * aPos, nrm = uRot * aNormal;
  vUv = aUv;
  vShade = 0.5 + 0.5 * max(0.0, dot(nrm, normalize(vec3(-0.35, 0.55, 1.0))));
  gl_Position = vec4(p.xy / uView, -p.z / 4.0, 1.0);
}`;
const FRAG = `
precision mediump float;
uniform sampler2D uTex; varying vec2 vUv; varying float vShade;
void main() {
  vec4 c = texture2D(uTex, vUv);
  gl_FragColor = vec4(floor(c.rgb * vShade * 24.0 + 0.5) / 24.0, 1.0);   // flat, banded shading
}`;

function makeGL(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) throw new Error("WebGL isn't available in this browser.");
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  // Six quads, uv into a 6-face-wide atlas.
  const data = [];
  FACES.forEach((f, fi) => {
    const corner = (su, sv) => add(add(f.n, f.u, su), f.v, sv);
    const uv = (su, sv) => [(fi + (su + 1) / 2) / 6, (sv + 1) / 2];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]])
      data.push(...corner(su, sv), ...uv(su, sv), ...f.n);
  });
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  const attr = (name, size, off) => { const l = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 32, off); };
  attr("aPos", 3, 0); attr("aUv", 2, 12); attr("aNormal", 3, 20);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.enable(gl.DEPTH_TEST);                         // convex cube: depth alone sorts the faces
  const uRot = gl.getUniformLocation(prog, "uRot"), uView = gl.getUniformLocation(prog, "uView");
  return (atlas, rot) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.024, 0.035, 0.051, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.uniformMatrix3fv(uRot, false, transpose(rot));        // GL wants column-major
    gl.uniform1f(uView, VIEW);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  };
}

// ---------- the panel ----------

// hints: { first_turns, first_seconds, next_turns, next_seconds }. A hint is
// earned by being stuck: the first after that many turns or seconds on the
// cube, each later one the same way counted from the last. Using one turns
// the wrong tile nearest the port's correct network to its solved
// orientation and pins it there.
export function createCube({ art, canvas, core, size = 3, seed, rule = "all", saved, hints, onChange, onSolved, onHintReady }) {
  const T = art.T, p = generateCube(size, seed), FW = p.n * T;
  if (saved?.cur?.length === p.tiles.length) p.cur = saved.cur.slice();
  const hint = { used: 0, turns: 0, ms: 0, pinned: [], ...saved?.hint };
  const pinned = new Set(hint.pinned);
  for (const i of pinned) p.cur[i] = p.sol[i];
  const atlas = Object.assign(document.createElement("canvas"), { width: FW * 6, height: FW });
  const ctx = atlas.getContext("2d", { willReadFrequently: true });
  const cctx = core.getContext("2d");
  core.width = core.height = CORE;
  canvas.width = canvas.height = RES;
  const draw3d = makeGL(canvas);
  let rot = mul(rotX(0.45), rotY(-0.6)), spin = null;
  let moves = saved?.moves ?? 0, power, solvedAt = null, raf = 0, cursor = p.src, keyboard = false, lockFill = null;
  const anims = new Map(), fills = new Map(), flowCache = new Map(), clock = performance.now();

  let hintReady = false;
  // Sparks live on the cube's surface in cube units (faces span -1..1) and
  // fold over an edge onto the next face, so they spray round corners.
  const sparks = createSparks({ unit: 2 / FW, step(s, dt) {
    s.p = add(s.p, s.v, dt);
    for (let k = 0; k < 2; k++) {
      const f = FACES[s.f], e = [f.u, f.v].map((ax) => [ax, dot(s.p, ax)]).find(([, x]) => Math.abs(x) > 1);
      if (!e) break;
      const dir = e[0].map((x) => x * Math.sign(e[1])), over = Math.abs(e[1]) - 1, ve = dot(s.v, dir);
      s.p = add(add(s.p, dir, -over), f.n, -over);
      s.v = add(add(s.v, dir, -ve), f.n, -ve);
      s.f = FACES.findIndex((g) => dot(g.n, dir) === 1);
    }
    return true;
  } });
  const sparkFrom = (i, bit) => {
    const t = p.tiles[i], f = FACES[t.f], out = dirOf(f, bit), side = bit === N || bit === S ? f.u : f.v;
    const c = add(add(f.n, f.u, (2 * t.c + 1) / p.n - 1), f.v, (2 * t.r + 1) / p.n - 1);
    const px = 2 / FW, j = (Math.random() * 2 - 1) * 2.5 * px;
    return { p: add(add(c, out, 1 / p.n - px / 2), side, j), out, side, f: t.f };
  };
  const atlasAt = (q, s) => {
    const f = FACES[s.f], clamp = (x) => Math.min(FW - 1, Math.max(0, x));
    return [s.f * FW + clamp((dot(q, f.u) + 1) / 2 * FW), clamp((dot(q, f.v) + 1) / 2 * FW)];
  };
  const isSolved = () => power.lockPowered && (rule === "lock" || (power.count === p.tiles.length && power.leaks.size === 0));

  function update(turned = -1, delay = ROT_MS) {
    const prev = power;
    power = traceCube(p);
    if (prev && !reduceMotion) {                    // fill what gained power, drain what lost it
      const now = performance.now() + (turned >= 0 ? delay : 0), gained = [];
      p.tiles.forEach((_, i) => {
        const was = prev.dist[i] >= 0, is = power.dist[i] >= 0;
        if (!was && is) gained.push([i, power.dist[i]]);
        else if (was && !is && i !== turned) fills.set(i, { t0: now, entry: prev.entry[i], mask: p.cur[i], drain: true });
        else if (!is) fills.delete(i);
      });
      const d0 = Math.min(...gained.map((g) => g[1]));
      for (const [i, d] of gained) fills.set(i, { t0: now + (d - d0) * STAGGER_MS, entry: power.entry[i], mask: p.cur[i], drain: false });
    }
    const state = solvedAt ? "online" : power.lockPowered ? "live" : "dead";
    emit(state);
    if (!solvedAt && isSolved()) { solvedAt = performance.now(); update(); checkHint(); onSolved?.({ moves }); }
  }
  const emit = (state = solvedAt ? "online" : power.lockPowered ? "live" : "dead") => onChange?.({
    state, moves, powered: power.count, total: p.tiles.length, leaks: power.leaks.size, cur: p.cur.slice(),
    ...(hints && { hint: { ...hint, ms: Math.round(hint.ms), pinned: [...pinned] } }) });

  function turn(i, dir) {
    if (solvedAt || i === p.src || i == null || pinned.has(i)) return;
    anims.set(i, { from: p.cur[i], state: tileState(i), dir, q: 1, t0: performance.now() });
    fills.delete(i);
    p.cur[i] = dir > 0 ? rotCW(p.cur[i]) : rotCCW(p.cur[i]);
    moves++; hint.turns++; update(i); checkHint();
  }

  // ---------- hints ----------

  function checkHint() {
    const first = hint.used === 0;
    const need = hints && [hints[first ? "first_turns" : "next_turns"], hints[first ? "first_seconds" : "next_seconds"]];
    const ready = !!need && !solvedAt && (hint.turns >= need[0] || hint.ms >= need[1] * 1000);
    if (ready === hintReady) return;
    hintReady = ready;
    if (ready) emit();                              // saves the charge time
    onHintReady?.(ready);
  }
  // The wrong tile to fix: grow the port's correct network along the
  // solution's links and take the nearest wrong tile on its edge.
  function hintTile() {
    const seen = new Set([p.src]), queue = [p.src];
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      for (const b of BITS) {
        if (!(p.sol[i] & b)) continue;
        const j = p.nbr[i][b][0];
        if (seen.has(j)) continue;
        seen.add(j);
        if (p.cur[j] !== p.sol[j]) return j;
        queue.push(j);
      }
    }
    return -1;
  }
  // The rotation that shows face f square on (its tiles upright), tilted a
  // little so the cube still reads as a cube.
  const faceView = (f) => mul(mul(rotX(0.3), rotY(-0.35)), [...f.u, ...f.v.map((x) => -x), ...f.n]);
  function useHint() {
    if (!hintReady || solvedAt) return;
    const i = hintTile();
    if (i < 0) return;
    let q = 0, m = p.cur[i];
    while (m !== p.sol[i] && q < 4) { m = rotCW(m); q++; }
    if (q === 4) q = 0;                             // a bad save: just snap it
    const dir = q === 3 ? -1 : 1, quarters = q === 3 ? 1 : q;
    const t0 = performance.now() + (reduceMotion ? 0 : SHOW_MS);
    spin = { t0: performance.now(), from: rot, to: faceView(FACES[p.tiles[i].f]), ms: SHOW_MS };
    if (quarters) anims.set(i, { from: p.cur[i], state: tileState(i), dir, q: quarters, t0 });
    fills.delete(i);
    p.cur[i] = p.sol[i];
    pinned.add(i); cursor = i;
    hint.used++; hint.turns = 0; hint.ms = 0;
    update(i, (reduceMotion ? 0 : SHOW_MS) + ROT_MS * quarters);
    checkHint();
  }

  const tileState = (i) => power.dist[i] < 0 ? "off" : power.leaks.has(i) ? "fault" : solvedAt ? "powered" : "base";
  const tileXY = (i) => { const t = p.tiles[i]; return [t.f * FW + t.c * T, t.r * T]; };

  function flowPixels(mask, entry) {
    const key = mask * 16 + entry;
    if (!flowCache.has(key)) {
      const m = (T - 1) / 2;
      const [ex, ey] = { [N]: [m, 0], [E]: [T - 1, m], [S]: [m, T - 1], [W]: [0, m] }[entry] || [m, m];
      flowCache.set(key, art.wires[mask].map((i) => [i, Math.abs((i % T) - ex) + Math.abs(Math.floor(i / T) - ey)]));
    }
    return flowCache.get(key);
  }
  function clipFrame(f, i, now) {
    const clip = art.fill[f.mask]?.[f.entry];
    const k = Math.floor((now - f.t0) / FILL_MS);
    if (!clip || k >= clip.length) { fills.delete(i); return null; }
    if (k < 0) return art.tiles[f.mask][f.drain ? "base" : "off"];
    return clip[f.drain ? clip.length - 1 - k : k];
  }

  // ---------- input: drag spins the cube, a tap or click turns a tile ----------

  let press = null;
  function pick(ev) {                                // ray from the pointer into the cube
    const rect = canvas.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width * 2 - 1) * VIEW;
    const sy = (1 - (ev.clientY - rect.top) / rect.height * 2) * VIEW;
    const inv = transpose(rot), o = apply(inv, [sx, sy, 10]), d = apply(inv, [0, 0, -1]);
    let t0 = -Infinity, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (Math.abs(o[k]) > 1) return null; continue; }
      let a = (-1 - o[k]) / d[k], b = (1 - o[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 > t1) return null;
    const hit = add(o, d, t0);
    const fi = FACES.findIndex((f) => dot(hit, f.n) > 0.999), f = FACES[fi];
    if (fi < 0) return null;
    const c = Math.min(p.n - 1, Math.floor((dot(hit, f.u) + 1) / 2 * p.n));
    const r = Math.min(p.n - 1, Math.floor((dot(hit, f.v) + 1) / 2 * p.n));
    return p.tiles.findIndex((t) => t.f === fi && t.r === r && t.c === c);
  }
  const onDown = (ev) => {
    keyboard = false;
    canvas.setPointerCapture(ev.pointerId);
    press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, dir: ev.button === 2 || ev.shiftKey ? -1 : 1 };
  };
  const onMove = (ev) => {
    if (!press || press.id !== ev.pointerId) return;
    const dx = ev.clientX - press.x, dy = ev.clientY - press.y;
    if (!press.moved && Math.hypot(dx, dy) < 6) return;
    press.moved = true;
    const k = 3 / canvas.getBoundingClientRect().width;       // a full-width drag is ~3 radians
    rot = mul(mul(rotY(dx * k), rotX(dy * k)), rot);
    press.x = ev.clientX; press.y = ev.clientY;
  };
  const onUp = (ev) => {
    if (!press || press.id !== ev.pointerId) return;
    const tap = !press.moved && ev.type === "pointerup";
    const dir = press.dir;
    press = null;
    if (tap) { const i = pick(ev); if (i >= 0) { cursor = i; turn(i, dir); } }
  };
  const frontFace = () => FACES.reduce((best, f, i) => (apply(rot, f.n)[2] > apply(rot, FACES[best].n)[2] ? i : best), 0);
  const onKey = (ev) => {
    const spinBy = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
    const step = { w: N, a: W, s: S, d: E }[ev.key.toLowerCase()];
    if (spinBy && !spin) {
      const a = Math.PI / 2;
      spin = { t0: performance.now(), from: rot, to: mul(spinBy[0] ? rotX(spinBy[0] * a) : rotY(spinBy[1] * a), rot), ms: SPIN_MS };
    } else if (step) {
      if (apply(rot, FACES[p.tiles[cursor].f].n)[2] < 0.1) {   // cursor out of sight: start on the front face
        const f = frontFace(), mid = Math.floor(p.n / 2);
        cursor = p.tiles.findIndex((t) => t.f === f && t.r === mid && t.c === mid);
      } else cursor = p.nbr[cursor][step][0];
    } else if (ev.key === "Enter" || ev.key === " ") {
      turn(cursor, ev.shiftKey ? -1 : 1);
    } else return;
    keyboard = true; ev.preventDefault();
  };
  const noMenu = (ev) => ev.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("contextmenu", noMenu);

  // ---------- frame ----------

  let last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (hints && !solvedAt && !hintReady) { hint.ms += Math.min(250, Math.max(0, now - last)); checkHint(); }
    last = now;
    if (spin) {                                     // keyboard quarter turns, and showing a hint
      const k = reduceMotion ? 1 : Math.min(1, Math.max(0, now - spin.t0) / spin.ms);
      rot = slerp(spin.from, spin.to, k * k * (3 - 2 * k));
      if (k >= 1) spin = null;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#06090d"; ctx.fillRect(0, 0, atlas.width, atlas.height);
    const flowing = [];
    p.tiles.forEach((_, i) => {
      const [x, y] = tileXY(i), a = anims.get(i);
      const k = a ? Math.min(1, Math.max(0, now - a.t0) / (ROT_MS * a.q)) : 1;
      if (a && (k >= 1 || reduceMotion)) anims.delete(i);
      if (a && k < 1 && !reduceMotion) {
        ctx.save(); ctx.translate(x + T / 2, y + T / 2); ctx.rotate(a.dir * a.q * k * Math.PI / 2);
        ctx.drawImage(art.tiles[a.from][a.state], -T / 2, -T / 2); ctx.restore();
        return;
      }
      const f = fills.get(i), clip = f && clipFrame(f, i, now);
      ctx.drawImage(clip || art.tiles[p.cur[i]][i === p.src ? (solvedAt ? "powered" : "base") : tileState(i)], x, y);
      if (power.dist[i] >= 0 && !fills.has(i)) flowing.push([x, y, p.cur[i], power.entry[i], power.dist[i]]);
    });
    if (!reduceMotion && flowing.length) {
      const img = ctx.getImageData(0, 0, atlas.width, atlas.height), d = img.data, aw = atlas.width;
      const L = 30, travel = (now / 1000) * 40;
      for (const [x0, y0, mask, entry, dist] of flowing)
        for (const [i, along] of flowPixels(mask, entry)) {
          const ph = (((dist * T + along - travel) % L) + L) % L;
          const peak = Math.max(0, 1 - Math.min(ph, L - ph) / 6);
          const k = 0.6 + 0.4 * peak, white = Math.max(0, peak - 0.5) * 0.9;
          const o = ((y0 + Math.floor(i / T)) * aw + x0 + (i % T)) * 4;
          for (let ch = o; ch < o + 3; ch++) { const v = d[ch] * k; d[ch] = v + (255 - v) * white; }
        }
      ctx.putImageData(img, 0, 0);
    }
    if (!reduceMotion) {                             // sparks from powered open ends
      const emitters = new Map();
      if (!solvedAt) for (const i of power.leaks) {
        if (fills.has(i) || anims.has(i)) continue;
        for (const b of BITS) {
          const [j, bj] = p.nbr[i][b];
          if (p.cur[i] & b && !(p.cur[j] & bj)) emitters.set(i * 16 + b, () => sparkFrom(i, b));
        }
      }
      drawSparks(ctx, sparks(emitters, now), atlasAt, 2);
    }
    // Port and lock markers: a small square in the middle of each tile.
    const mark = (i, color) => { const [x, y] = tileXY(i); ctx.fillStyle = "#06090d"; ctx.fillRect(x + 12, y + 12, 8, 8);
      ctx.fillStyle = color; ctx.fillRect(x + 13, y + 13, 6, 6); };
    mark(p.src, "#e8fbff");
    ctx.fillStyle = "#e8fbff";                      // pinned by a hint: corner brackets
    for (const i of pinned) {
      if (anims.has(i)) continue;
      const [x, y] = tileXY(i);
      for (const [cx, cy, sx, sy] of [[x + 1, y + 1, 1, 1], [x + T - 2, y + 1, -1, 1], [x + 1, y + T - 2, 1, -1], [x + T - 2, y + T - 2, -1, -1]]) {
        ctx.fillRect(Math.min(cx, cx + sx * 3), cy, 4, 1);
        ctx.fillRect(cx, Math.min(cy, cy + sy * 3), 1, 4);
      }
    }
    mark(p.dst, solvedAt ? "#63e77f" : power.lockPowered ? "#45e4ef" : "#ffa300");
    if (keyboard && document.activeElement === canvas) {
      const [x, y] = tileXY(cursor);
      ctx.strokeStyle = "#45e4ef"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    }
    draw3d(atlas, rot);

    let fr;                                         // lock core: idle, then unlock once
    if (solvedAt) fr = art.core.unlock[Math.min(art.core.unlock.length - 1, reduceMotion ? 99 : Math.floor(Math.max(0, now - solvedAt) / 95))];
    else fr = art.core.idle[reduceMotion ? 0 : Math.floor(Math.max(0, now - clock) / 120) % art.core.idle.length];
    cctx.imageSmoothingEnabled = false; cctx.clearRect(0, 0, CORE, CORE); cctx.drawImage(fr, 0, 0);
  }

  function fit(availW, availH) {
    // Half steps (1, 1.5, 2...) on ordinary screens; dense screens fill the space.
    const s = Math.min(availW, availH) / RES;
    const k = s < 1 || devicePixelRatio >= 2 ? Math.min(s, 3) : Math.min(3, Math.floor(s * 2) / 2);
    canvas.style.width = canvas.style.height = `${RES * k}px`;
    const orient = availW >= 480 ? "h" : "v";                  // core beside the cube, or above it
    core.style.width = core.style.height = `${CORE * (orient === "v" ? 1 : 2)}px`;
    return { orient, scale: k };
  }

  update();
  checkHint();
  raf = requestAnimationFrame(frame);
  return {
    fit,
    reset() { if (!solvedAt) { p.cur = p.start.map((m, i) => (pinned.has(i) ? p.sol[i] : m)); moves = 0; fills.clear(); update(); } },
    hint: useHint,
    destroy() {
      cancelAnimationFrame(raf);
      if (!solvedAt) emit();                        // keep the hint charge time
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("contextmenu", noMenu);
    },
  };
}
