// Scanner: one full-screen WebGL quad, one fragment shader, no library.
// Every pixel does three things: how much lens is over it, what the hidden
// layer looks like there (generated from data, not a second image), and a
// blend of the two. For pixel art, everything is snapped to the scene's pixel
// grid and the lens edge and heat ramp are ordered-dithered.

export const MAX_LENSES = 4, MAX_SOURCES = 8;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);   // 0-1, top-left origin
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uSize;                       // scene size in pixels (320, 240)
uniform vec4 uLens[${MAX_LENSES}];        // x, y (0-1), radius (scene heights), strength
uniform vec4 uSrc[${MAX_SOURCES}];        // x, y, half-width, half-height (0-1)
uniform vec4 uSrcInfo[${MAX_SOURCES}];    // intensity, state (0 none, 1 fault, 2 online), phase
uniform float uAmbient;                   // room lighting, 0 dark to 1 lit
uniform float uTime;

// 4x4 Bayer threshold in [0, 1), without bit operations (GLSL ES 1.0).
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

// Thermal ramp: a small palette, dithered between neighbouring stops.
vec3 stop(int i) {
  if (i <= 0) return vec3(0.055, 0.071, 0.141);
  if (i == 1) return vec3(0.114, 0.169, 0.325);
  if (i == 2) return vec3(0.494, 0.145, 0.325);
  if (i == 3) return vec3(1.0, 0.0, 0.302);
  if (i == 4) return vec3(1.0, 0.639, 0.0);
  if (i == 5) return vec3(1.0, 0.925, 0.153);
  return vec3(1.0, 0.945, 0.910);
}
vec3 ramp(float t, float dither) {
  float x = clamp(t, 0.0, 1.0) * 6.0;
  float i = floor(x);
  return stop(int(i + step(dither, x - i)));
}

void main() {
  vec2 px = floor(vUv * uSize);                 // this scene pixel
  vec2 p = (px + 0.5) / uSize;                  // its centre, 0-1
  float aspect = uSize.x / uSize.y;
  float dither = bayer4(px);
  vec3 scene = texture2D(uScene, p).rgb;
  vec3 lit = scene * mix(vec3(0.10, 0.12, 0.20), vec3(1.0), uAmbient);

  // 1. Lens coverage, and a one-pixel rim.
  float m = 0.0, rim = 0.0;
  for (int i = 0; i < ${MAX_LENSES}; i++) {
    vec4 L = uLens[i];
    if (L.w <= 0.0) continue;
    vec2 d = p - L.xy; d.x *= aspect;
    float dist = length(d);
    m = max(m, (1.0 - smoothstep(L.z * 0.8, L.z, dist)) * L.w);
    rim = max(rim, step(abs(dist - L.z), 0.6 / uSize.y) * L.w);
  }

  // 2. The hidden layer, from data: falloffs around each system plus a little
  // of the scene's own luminance so the room's shape still reads.
  float heat = dot(scene, vec3(0.299, 0.587, 0.114)) * 0.45;
  for (int i = 0; i < ${MAX_SOURCES}; i++) {
    vec4 s = uSrc[i], info = uSrcInfo[i];
    if (info.y < 0.5) continue;
    float f = 1.0 - smoothstep(0.15, 1.0, length((p - s.xy) / s.zw));
    float pulse = info.y < 1.5 ? 0.85 + 0.15 * sin(uTime * 3.0 + info.z) : 0.28;
    heat += f * info.x * pulse;
  }

  // 3. Blend, with the lens edge dithered to whole pixels.
  float mask = step(dither + 0.001, m);
  vec3 col = mix(lit, ramp(heat, dither), mask);
  col = mix(col, vec3(0.27, 0.89, 0.94), rim);
  gl_FragColor = vec4(col, 1.0);
}`;

// Same lens falloff as the shader, for hit-testing without GPU read-back.
export function coverage(lens, x, y, aspect) {
  const dx = (x - lens.x) * aspect, dy = y - lens.y, d = Math.hypot(dx, dy);
  const e0 = lens.r * 0.8, e1 = lens.r;
  const t = Math.min(1, Math.max(0, (d - e0) / (e1 - e0)));
  return (1 - t * t * (3 - 2 * t)) * lens.strength;
}

export function createScanner(canvas, size) {
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error("WebGL isn't available in this browser.");
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);

  const u = (n) => gl.getUniformLocation(prog, n);
  const loc = { size: u("uSize"), lens: u("uLens"), src: u("uSrc"), info: u("uSrcInfo"),
    ambient: u("uAmbient"), time: u("uTime"), scene: u("uScene") };
  gl.uniform1i(loc.scene, 0);
  gl.uniform2f(loc.size, size[0], size[1]);
  const lensData = new Float32Array(MAX_LENSES * 4), srcData = new Float32Array(MAX_SOURCES * 4),
    infoData = new Float32Array(MAX_SOURCES * 4);

  // Draw one frame. `scene` is a canvas holding the composed scene; lenses
  // and sources are plain arrays, written straight into the uniforms.
  function render({ scene, lenses, sources, ambient, time }) {
    const w = canvas.clientWidth * devicePixelRatio | 0, h = canvas.clientHeight * devicePixelRatio | 0;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    lensData.fill(0); srcData.fill(0); infoData.fill(0);
    lenses.slice(0, MAX_LENSES).forEach((l, i) => lensData.set([l.x, l.y, l.r, l.strength], i * 4));
    sources.slice(0, MAX_SOURCES).forEach((s, i) => {
      srcData.set([s.x, s.y, s.hw, s.hh], i * 4);
      infoData.set([s.intensity, s.state, i * 1.7, 0], i * 4);
    });
    gl.uniform4fv(loc.lens, lensData);
    gl.uniform4fv(loc.src, srcData);
    gl.uniform4fv(loc.info, infoData);
    gl.uniform1f(loc.ambient, ambient);
    gl.uniform1f(loc.time, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  return { render };
}
