// Derelict Station: scan the room, find failing systems, repair each one with
// a circuit panel. Systems come online in order; getting all of them running
// is the win. Everything scene-specific comes from scenario.json.

import { createScanner, coverage } from "./scanner.js";
import { loadCircuitArt, createCircuit } from "./circuit.js";
import { createCube } from "./cube.js";

const $ = (id) => document.getElementById(id);
const KEY = "derelict-station-v1";
const LENS_R = 0.16;                // lens radius, in scene heights
const TOUCH_LIFT = 0.2;             // touch lens sits this far above the finger
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const loadImage = (src) => new Promise((ok, fail) => {
  const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error(src)); im.src = src;
});
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const DUR = { lights: 1800, door: 1400, float: 2600, glow: 2000 };

async function main() {
  const scenario = await fetch("scenario.json").then((r) => r.json());
  const [SW, SH] = scenario.scene.size, aspect = SW / SH;
  const spriteDefs = scenario.scene.sprites;
  const [art, bg, ...spriteImgs] = await Promise.all([
    loadCircuitArt("assets/circuit"), loadImage(scenario.scene.image),
    ...Object.values(spriteDefs).map((s) => loadImage(s.image))]);
  const sprites = Object.fromEntries(Object.keys(spriteDefs).map((k, i) => [k, { ...spriteDefs[k], img: spriteImgs[i] }]));
  const systems = scenario.systems;
  const byId = Object.fromEntries(systems.map((s) => [s.id, s]));

  // Progress: which systems are online, and half-finished panels.
  const progress = Object.assign({ online: [], panels: {}, turns: {}, started: null, finished: null }, store.get(KEY, {}));
  const save = () => store.set(KEY, progress);
  const isOnline = (id) => progress.online.includes(id);
  // Outcome animations: id -> start time. Restored systems start "long ago".
  const outcomeAt = Object.fromEntries(progress.online.map((id) => [id, -1e9]));
  const outcomeDone = (id, now) => isOnline(id) && now - outcomeAt[id] >= DUR[byId[id].outcome.type];
  const reachable = (s, now) => s.requires.every((r) => outcomeDone(r, now));

  // ---------- the stage ----------

  const stage = $("stage"), canvas = $("scene");
  const scanner = createScanner(canvas, [SW, SH]);
  const composed = Object.assign(document.createElement("canvas"), { width: SW, height: SH });
  const cx = composed.getContext("2d");

  function fitStage() {
    const aw = Math.min(window.innerWidth - 32, 1280);
    const ah = window.innerHeight - $("top").offsetHeight - $("below").offsetHeight - 48;
    // Whole-number scales keep pixels even. On dense screens (2+ device px
    // per CSS px) the shader's own pixel snapping keeps blocks within a device
    // pixel of each other, so the scene can fill the space instead.
    const s = Math.min(aw / SW, ah / SH);
    const k = devicePixelRatio >= 2 || s < 1 ? s : Math.floor(s);
    stage.style.width = `${SW * k}px`; stage.style.height = `${SH * k}px`;
    stage.style.setProperty("--s", k);
  }
  addEventListener("resize", fitStage);
  fitStage();

  // Scene values for this moment, from which systems are online and how far
  // their outcome animations have run.
  function sceneState(now) {
    const t = (id) => (isOnline(id) ? Math.min(1, (now - outcomeAt[id]) / DUR[byId[id].outcome.type]) : 0);
    const st = { ambient: 0, door: 0, float: 0, glow: 0 };
    for (const s of systems) {
      const k = reduceMotion && isOnline(s.id) ? 1 : t(s.id);
      if (s.outcome.type === "lights") {
        // A few hard flickers, then the lights settle on.
        const flicker = k < 0.45 ? (Math.sin(k * 97) > 0.2 ? 0.8 : 0.1) : ease((k - 0.45) / 0.55);
        st.ambient = k === 0 ? 0 : flicker;
      }
      if (s.outcome.type === "door") st.door = k;
      if (s.outcome.type === "float") st.float = ease(k);
      if (s.outcome.type === "glow") st.glow = k;
    }
    return st;
  }

  function compose(st, now) {
    cx.imageSmoothingEnabled = false;
    cx.drawImage(bg, 0, 0);
    const bob = (i) => (reduceMotion ? 0 : Math.round(Math.sin(now / 700 + i * 1.9) * 2 * st.float));
    scenario.scene.draw_order.forEach((name, i) => {
      const s = sprites[name];
      let [x, y] = s.at;
      if (s.frames) {                    // an outcome clip strip, e.g. the door opening
        const t = st[s.plays], w = s.img.width / s.frames;
        if (t > 0) cx.drawImage(s.img, Math.min(s.frames - 1, Math.floor(t * s.frames)) * w, 0, w, s.img.height, x, y, w, s.img.height);
        return;                          // before it plays, the scene itself shows the start
      }
      if (s.float_to) {
        x = Math.round(x + (s.float_to[0] - x) * st.float);
        y = Math.round(y + (s.float_to[1] - y) * st.float) + bob(i);
      }
      cx.drawImage(s.img, x, y);
      if (name === "cube" && st.glow > 0) {                   // the cube powering up
        cx.globalCompositeOperation = "lighter";
        cx.globalAlpha = (reduceMotion ? 0.5 : 0.35 + 0.25 * Math.sin(now / 180)) * Math.min(1, st.glow * 2);
        cx.drawImage(s.img, x, y);
        cx.globalAlpha = 1; cx.globalCompositeOperation = "source-over";
      }
    });
  }

  // ---------- the scanner lens ----------

  const lenses = new Map();          // pointerId -> lens; "park" = a touch lens left in place
  const touches = new Map();         // pointerId -> { x0, y0, t0, moved }
  let lastPointer = "mouse";
  const toScene = (ev) => {
    const r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  };
  const lens = (x, y) => ({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), r: LENS_R, strength: 1 });

  canvas.addEventListener("pointerdown", (ev) => {
    lastPointer = ev.pointerType;
    if (ev.pointerType === "mouse") return;
    canvas.setPointerCapture(ev.pointerId);
    const [x, y] = toScene(ev);
    touches.set(ev.pointerId, { x0: ev.clientX, y0: ev.clientY, t0: performance.now(), moved: false });
    if (!lenses.has("park")) lenses.set(ev.pointerId, lens(x, y - TOUCH_LIFT));
  });
  canvas.addEventListener("pointermove", (ev) => {
    const [x, y] = toScene(ev);
    if (ev.pointerType === "mouse") { lenses.set("mouse", lens(x, y)); return; }
    const t = touches.get(ev.pointerId);
    if (!t) return;
    if (!t.moved && Math.hypot(ev.clientX - t.x0, ev.clientY - t.y0) > 8) { t.moved = true; lenses.delete("park"); }
    if (t.moved) lenses.set(ev.pointerId, lens(x, y - TOUCH_LIFT));   // raw position, no easing
  });
  const endTouch = (ev) => {
    const t = touches.get(ev.pointerId);
    touches.delete(ev.pointerId);
    const own = lenses.get(ev.pointerId);
    lenses.delete(ev.pointerId);
    if (own) lenses.set("park", own);
    if (t && !t.moved && performance.now() - t.t0 < 450 && ev.type === "pointerup") select();
  };
  canvas.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "mouse") { if (ev.button === 0) select(); } else endTouch(ev);
  });
  canvas.addEventListener("pointercancel", endTouch);
  canvas.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") lenses.delete("mouse"); });
  canvas.addEventListener("keydown", (ev) => {
    const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[ev.key];
    if (step) {
      lastPointer = "keyboard";
      const l = lenses.get("park") || lens(0.5, 0.5);
      lenses.set("park", lens(l.x + step[0] * 6 / SW, l.y + step[1] * 6 / SH));
    } else if (ev.key === "Enter" || ev.key === " ") { lastPointer = "keyboard"; select(); }
    else return;
    ev.preventDefault();
  });

  // The system the lens is over, using the shader's own falloff.
  function underLens(now) {
    let best = null, bestCov = 0.5;
    for (const s of systems) {
      if (isOnline(s.id) || !reachable(s, now)) continue;
      for (const l of lenses.values()) {
        const c = coverage(l, s.source[0], s.source[1], aspect);
        if (c > bestCov) { best = s; bestCov = c; }
      }
    }
    return best;
  }
  const select = () => { const s = underLens(performance.now()); if (s && !panel) openPanel(s); };

  // ---------- panels ----------

  let panel = null;
  const dialog = $("panel");

  function openPanel(sys) {
    progress.started ??= Date.now(); save();
    $("panel-title").textContent = sys.name;
    const cube = sys.puzzle.type === "cube";
    $("panel-note").textContent = sys.puzzle.note || (cube
      ? "Drag to turn the cube; tap a tile to rotate it. Route power from the white port to the lock on the far side, with every conduit powered and no open ends."
      : sys.puzzle.rule === "all"
        ? "Every conduit must carry power, with no open ends."
        : "Route power from the port to the lock.");
    $("panel-msg").textContent = "";
    $("panel-hint").hidden = true;
    $("board").hidden = cube; $("cube").hidden = !cube;
    dialog.showModal();
    const make = cube ? createCube : createCircuit;
    const c = make({
      art, board: $("board"), canvas: $("cube"), core: $("core"), size: sys.puzzle.size, seed: sys.puzzle.seed,
      rule: sys.puzzle.rule, hints: sys.puzzle.hints, saved: progress.panels[sys.id],
      onChange: (st) => {
        $("panel-state").textContent = { dead: "No power", live: "Power reaching the lock", online: "Online" }[st.state];
        $("panel-state").dataset.state = st.state;
        $("panel-turns").textContent = st.moves;
        if (st.state !== "online") { progress.panels[sys.id] = { cur: st.cur, moves: st.moves, hint: st.hint }; save(); }
      },
      onHintReady: (ready) => { $("panel-hint").hidden = !ready; },
      onSolved: ({ moves }) => {
        progress.turns[sys.id] = moves;
        delete progress.panels[sys.id];
        $("panel-msg").textContent = sys.online;
        setTimeout(() => { closePanel(); bringOnline(sys); }, reduceMotion ? 600 : 1500);
      },
    });
    panel = { sys, c };
    fitPanel();
    // Hand focus to the board only for keyboard players; on touch screens a
    // focused board can draw its focus ring over the whole puzzle.
    if (lastPointer === "keyboard") $(cube ? "cube" : "board").focus({ preventScroll: true });
  }
  function fitPanel() {
    if (!panel) return;
    const narrow = window.innerWidth < 640;
    const aw = Math.min(window.innerWidth - 48, 900) - (narrow ? 0 : 200);
    const ah = window.innerHeight - (narrow ? 300 : 220);
    dialog.dataset.orient = panel.c.fit(aw, ah).orient;
    // Short screens: shrink the cube by whatever still overflows, so the Hint
    // and Reset buttons stay in view. (Flat boards only take whole-number
    // scales, where shrinking would halve them; they scroll instead.)
    const over = dialog.scrollHeight - dialog.clientHeight;
    if (over > 0 && panel.sys.puzzle.type === "cube") dialog.dataset.orient = panel.c.fit(aw, $("cube").offsetHeight - over).orient;
  }
  function closePanel() {
    if (!panel) return;
    panel.c.destroy(); panel = null;
    if (dialog.open) dialog.close();
    canvas.focus({ preventScroll: true });
  }
  addEventListener("resize", fitPanel);
  dialog.addEventListener("close", () => { if (panel) { panel.c.destroy(); panel = null; } });
  $("panel-close").addEventListener("click", closePanel);
  $("panel-reset").addEventListener("click", () => panel?.c.reset());
  $("panel-hint").addEventListener("click", (ev) => {
    panel?.c.hint?.();
    if (ev.detail === 0) $("cube").focus({ preventScroll: true });   // keyboard: the button just hid itself
  });

  function bringOnline(sys) {
    if (isOnline(sys.id)) return;
    progress.online.push(sys.id);
    outcomeAt[sys.id] = performance.now();
    if (progress.online.length === systems.length) progress.finished = Date.now();
    save();
  }

  // ---------- status, hint and the win ----------

  function status(now) {
    $("online").textContent = `${progress.online.length} / ${systems.length}`;
    const s = panel ? null : underLens(now);
    const verb = lastPointer === "touch" ? "Tap" : lastPointer === "keyboard" ? "Press Enter" : "Click";
    const allDone = systems.every((x) => outcomeDone(x.id, now));
    $("hint").textContent = allDone ? "Every system is running."
      : s ? `${s.name} detected. ${verb} to open its panel.`
        : lenses.size ? "Nothing responding here. Keep sweeping."
          : lastPointer === "touch" ? "Drag across the room to sweep the scanner."
            : "Move across the room to sweep the scanner.";
    $("hint").dataset.found = s ? "yes" : "no";
    const win = $("win");
    if (allDone && win.hidden) {
      const mins = progress.started && progress.finished
        ? Math.max(1, Math.round((progress.finished - progress.started) / 60000)) : null;
      const turns = Object.values(progress.turns).reduce((a, b) => a + b, 0);
      $("win-stats").textContent = `${turns} turns${mins ? `, about ${mins} min` : ""}.`;
      win.hidden = false;
    }
  }
  let wipeArmed = false;
  $("restart").addEventListener("click", () => {
    if (!wipeArmed) { wipeArmed = true; $("restart").textContent = "Click again to wipe progress"; return; }
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    location.reload();
  });

  // ---------- frame ----------

  function frame(now) {
    requestAnimationFrame(frame);
    const st = sceneState(now);
    compose(st, now);
    const sources = systems.map((s) => ({
      x: s.source[0], y: s.source[1], hw: s.source[2], hh: s.source[3], intensity: s.source[4],
      state: isOnline(s.id) ? 2 : reachable(s, now) ? 1 : 0,
    }));
    scanner.render({ scene: composed, lenses: [...lenses.values()], sources, ambient: st.ambient, time: now / 1000 });
    status(now);
  }
  $("loading").hidden = true;
  requestAnimationFrame(frame);
}

main().catch((err) => {
  $("loading").hidden = false;
  $("loading").textContent = `The station didn't load (${err.message}). It needs to be served over HTTP.`;
});
