// Leak sparks: short bursts of pixel sparks spraying out of every open
// conduit end that carries power. Shared by the flat panels and the cube; each
// supplies its own space through `step` (how a spark moves, and whether it is
// still on the board) and draws the sparks itself.
//
// Emitters are rebuilt every frame as a Map of key -> spawn(), where spawn()
// returns { p, out, side, ...extra }: a position, the outward direction and
// the direction across the wire, as plain arrays in the caller's space
// (`unit` = the space's length of one canvas pixel).

const COLORS = ["#ffffff", "#ffe98a", "#ffa300", "#c8401e"];   // white-hot to ember

export function createSparks({ step, unit = 1 }) {
  const parts = [], next = new Map();
  let last = null;

  function burst(spawn) {
    const n = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const { p, out, side, ...extra } = spawn();
      const a = (Math.random() * 2 - 1) * 1.1, px = 40 + Math.random() * 70;   // spread, px per second
      const v = out.map((o, i) => (o * Math.cos(a) + side[i] * Math.sin(a)) * px * unit);
      parts.push({ p: p.slice(), v, age: 0, life: 0.2 + Math.random() * 0.35, fast: px > 70, ...extra });
      if (k === 0) parts.push({ p: p.slice(), v: v.map(() => 0), age: 0, life: 0.08, flash: true, ...extra });
    }
  }

  // Advance to `now` and return the live sparks.
  return function tick(emitters, now) {
    const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const [key, spawn] of emitters) {
      if (!next.has(key)) next.set(key, now + 150 + Math.random() * 900);   // new leaks stagger in
      if (now >= next.get(key)) { burst(spawn); next.set(key, now + 900 + Math.random() * 1400); }
    }
    for (const key of next.keys()) if (!emitters.has(key)) next.delete(key);
    for (let i = parts.length - 1; i >= 0; i--) {
      const s = parts[i];
      s.age += dt;
      s.v = s.v.map((x) => x * (1 - 3 * dt));              // sparks slow as they fly
      if (s.age >= s.life || !step(s, dt)) parts.splice(i, 1);
    }
    return parts;
  };
}

// Draw sparks as square pixels that cool from white-hot to ember; fast ones
// leave a dimmer pixel behind, and each burst starts with a flash at the
// conduit end. at(p, spark) maps a position to canvas pixels.
export function drawSparks(ctx, parts, at, size = 1) {
  const color = (s, k) => COLORS[Math.min(COLORS.length - 1, Math.floor((s.age / s.life + k) * COLORS.length))];
  const put = ([x, y], w = size) => ctx.fillRect(Math.floor(x - w / 2 + 0.5), Math.floor(y - w / 2 + 0.5), w, w);
  for (const s of parts) {
    if (s.flash) { ctx.fillStyle = COLORS[1]; put(at(s.p, s), size + 2); ctx.fillStyle = COLORS[0]; put(at(s.p, s)); continue; }
    if (s.fast && s.age < s.life * 0.6) { ctx.fillStyle = color(s, 0.35); put(at(s.p.map((x, i) => x - s.v[i] * 0.02), s)); }
    ctx.fillStyle = color(s, 0); put(at(s.p, s));
  }
}
