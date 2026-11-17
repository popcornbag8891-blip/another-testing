// The light ribbon, the wand-tip ember, and the choreography that turns a
// wobbly stroke into a perfect rune (or a puff of smoke).
// Everything lives in the overlay's orthographic space: y ∈ [-1, 1], x ∈ [-aspect, aspect].
import * as THREE from 'three';
import { SHAPE, KIND } from './particles.js';

const MAX_RAW = 1200;         // raw stroke samples (5 s at up to 240 Hz)
const SUB = 4;                // Catmull-Rom subdivisions per segment
const MAX_V = 2400;           // ribbon centreline vertices after subdivision
const RUNE_N = 128;           // points in a resampled stroke / canonical rune
const WHITE_GOLD = new THREE.Color(1.0, 0.86, 0.62);
const SMOKE = new THREE.Color(0.42, 0.36, 0.55);

const easeOutBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const easeInCubic = (x) => x * x * x;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

const ribbonVS = /* glsl */ `
attribute float aSide; attribute float aU; attribute float aAlpha;
varying float vSide; varying float vU; varying float vAlpha;
void main(){ vSide = aSide; vU = aU; vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ribbonFS = /* glsl */ `
uniform vec3 uBase; uniform vec3 uPalette; uniform float uMix; uniform float uIntensity;
uniform float uAlpha; uniform float uTime; uniform float uShimmer;
varying float vSide; varying float vU; varying float vAlpha;
void main(){
  float s = vSide * vSide;
  float core = exp(-s * 7.0);
  float glow = exp(-s * 1.8) * (1.0 - s);
  vec3 tint = mix(uBase, uPalette, uMix);
  float shimmer = 1.0 + uShimmer * 0.22 * sin(vU * 90.0 - uTime * 9.0) * sin(vU * 23.0 + uTime * 3.0);
  vec3 col = mix(tint, vec3(1.0), core * 0.75) * (core * 1.6 + glow * 0.75) * shimmer;
  gl_FragColor = vec4(col * uIntensity * uAlpha * vAlpha, 1.0);
}`;

class Ribbon {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_V * 2 * 3);
    this.side = new Float32Array(MAX_V * 2);
    this.u = new Float32Array(MAX_V * 2);
    this.alpha = new Float32Array(MAX_V * 2);
    for (let i = 0; i < MAX_V; i++) { this.side[i * 2] = -1; this.side[i * 2 + 1] = 1; }
    const idx = new Uint32Array((MAX_V - 1) * 6);
    for (let i = 0; i < MAX_V - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aU = new THREE.BufferAttribute(this.u, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    geo.setAttribute('aU', this.aU);
    geo.setAttribute('aAlpha', this.aAlpha);
    this.uniforms = {
      uBase: { value: WHITE_GOLD.clone() }, uPalette: { value: new THREE.Color() }, uMix: { value: 0 },
      uIntensity: { value: 1 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uShimmer: { value: 1 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: ribbonVS, fragmentShader: ribbonFS,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
    // Smoothed centreline scratch (no allocation per frame).
    this.cx = new Float32Array(MAX_V); this.cy = new Float32Array(MAX_V); this.cw = new Float32Array(MAX_V);
    this.mode = 'idle';
  }

  /**
   * Build the strip from n control points (xs, ys, widths). Catmull-Rom through
   * the controls, then offset along the normal. `tailFade` tapers alpha at the ends.
   */
  build(xs, ys, ws, n, tailFade = 0.15) {
    if (n < 2) { this.mesh.visible = false; return; }
    const sub = n * SUB > MAX_V ? Math.max(1, Math.floor(MAX_V / n)) : SUB;
    let m = 0;
    for (let i = 0; i < n - 1 && m < MAX_V - 1; i++) {
      const i0 = i > 0 ? i - 1 : i, i2 = i + 1, i3 = i + 2 < n ? i + 2 : i + 1;
      for (let s = 0; s < sub && m < MAX_V - 1; s++) {
        const t = s / sub, t2 = t * t, t3 = t2 * t;
        const cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        this.cx[m] = cr(xs[i0], xs[i], xs[i2], xs[i3]);
        this.cy[m] = cr(ys[i0], ys[i], ys[i2], ys[i3]);
        this.cw[m] = ws[i] + (ws[i2] - ws[i]) * t;
        m++;
      }
    }
    this.cx[m] = xs[n - 1]; this.cy[m] = ys[n - 1]; this.cw[m] = ws[n - 1]; m++;

    for (let i = 0; i < m; i++) {
      const a = i > 0 ? i - 1 : i, b = i < m - 1 ? i + 1 : i;
      let tx = this.cx[b] - this.cx[a], ty = this.cy[b] - this.cy[a];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const w = this.cw[i];
      const k = i * 6;
      this.pos[k] = this.cx[i] + ty * w; this.pos[k + 1] = this.cy[i] - tx * w; this.pos[k + 2] = 0;
      this.pos[k + 3] = this.cx[i] - ty * w; this.pos[k + 4] = this.cy[i] + tx * w; this.pos[k + 5] = 0;
      const u = i / (m - 1);
      this.u[i * 2] = this.u[i * 2 + 1] = u;
      const fade = tailFade > 0 ? Math.min(1, u / tailFade, (1 - u) / (tailFade * 0.35) + 0.35) : 1;
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = Math.max(0, fade);
    }
    this.aPos.needsUpdate = this.aU.needsUpdate = this.aAlpha.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, m * 6);
    this.aU.clearUpdateRanges(); this.aU.addUpdateRange(0, m * 2);
    this.aAlpha.clearUpdateRanges(); this.aAlpha.addUpdateRange(0, m * 2);
    this.mesh.geometry.setDrawRange(0, (m - 1) * 6);
    this.mesh.visible = true;
  }
}

const tipVS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const tipFS = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform float uPinch;
varying vec2 vUv;
void main(){
  vec2 d = vUv - 0.5; float r = length(d) * 2.0;
  float breathe = 0.5 + 0.5 * sin(uTime * 3.14159);          // 0.5 Hz
  float core = exp(-r * r * mix(150.0, 95.0, uPinch));
  float halo = exp(-r * r * mix(9.0, 6.0, uPinch)) * (0.35 + 0.25 * breathe + 0.45 * uPinch);
  float rays = pow(max(0.0, 1.0 - abs(d.x * d.y) * 260.0), 6.0) * exp(-r * 3.5) * (0.15 + 0.5 * uPinch);
  float sparks = 0.0;
  for (int i = 0; i < 5; i++) {
    float ang = uTime * 2.6 + float(i) * 1.2566;
    float rad = 0.16 + 0.02 * sin(uTime * 5.0 + float(i));
    vec2 sp = d - rad * vec2(cos(ang), sin(ang));
    sparks += exp(-dot(sp, sp) * 9000.0) + exp(-dot(sp, sp) * 900.0) * 0.18;
  }
  vec3 col = uColor * (halo + rays) + vec3(1.0, 0.96, 0.9) * core * (1.6 + 1.6 * uPinch) + vec3(1.0, 0.9, 0.7) * sparks * uPinch * 1.4;
  gl_FragColor = vec4(col * uAlpha, 1.0);
}`;

const streakFS = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
void main(){
  vec2 d = (vUv - 0.5) * 2.0;
  float streak = exp(-d.y * d.y * 900.0) * exp(-d.x * d.x * 2.5) * 1.4;     // anamorphic line
  float halo = exp(-d.y * d.y * 60.0) * exp(-d.x * d.x * 9.0) * 0.35;
  float core = exp(-dot(d * vec2(14.0, 1.0), d * vec2(14.0, 1.0)) * 4.0) * 1.6;  // hot centre
  vec3 col = mix(uColor, vec3(1.0), 0.45) * (streak + halo) + vec3(1.0) * core;
  gl_FragColor = vec4(col * uAlpha, 1.0);
}`;

export class Trail {
  constructor(scene, particles, ctx) {
    this.scene = scene;
    this.particles = particles;
    this.ctx = ctx; // { reducedMotion }
    this.pool = [new Ribbon(scene), new Ribbon(scene), new Ribbon(scene), new Ribbon(scene)];
    this.ghost = new Ribbon(scene);
    this.ghost.uniforms.uShimmer.value = 0;
    this.ghost.mesh.renderOrder = 9;
    this.active = null;

    // Raw stroke buffers.
    this.rx = new Float32Array(MAX_RAW); this.ry = new Float32Array(MAX_RAW);
    this.rs = new Float32Array(MAX_RAW); this.rw = new Float32Array(MAX_RAW);
    this.n = 0; this.startTime = 0; this.speed = 0;
    // Scratch for rune morphs.
    this.mx = new Float32Array(RUNE_N); this.my = new Float32Array(RUNE_N); this.mw = new Float32Array(RUNE_N);
    this.pathBuf = new Float32Array(RUNE_N * 2);

    // Wand tip.
    this.tipU = { uColor: { value: WHITE_GOLD.clone() }, uAlpha: { value: 0 }, uTime: { value: 0 }, uPinch: { value: 0 } };
    this.tip = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.ShaderMaterial({
      uniforms: this.tipU, vertexShader: tipVS, fragmentShader: tipFS,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    }));
    this.tip.renderOrder = 20;
    scene.add(this.tip);
    this.tipPrevX = 0; this.tipPrevY = 0; this.tipVX = 0; this.tipVY = 0;
    this.pinchLevel = 0;

    this.ghostState = null;
    this._c = new THREE.Color();

    // Anamorphic flare streak for the snap.
    this.streakU = { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } };
    this.streak = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: this.streakU, vertexShader: tipVS, fragmentShader: streakFS,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    }));
    this.streak.renderOrder = 15; this.streak.visible = false;
    scene.add(this.streak);
    this.streakT = 1;
  }

  // ------------------------------------------------------------ drawing --
  begin(x, y, t) {
    if (this.active) this.dissolveQuietly(false); // never orphan a live stroke
    const r = this.pool.find((p) => p.mode === 'idle') || this.pool[0];
    r.mode = 'draw';
    r.uniforms.uMix.value = 0; r.uniforms.uIntensity.value = 1; r.uniforms.uAlpha.value = 1;
    r.uniforms.uBase.value.copy(WHITE_GOLD);
    r.mesh.position.set(0, 0, 0);
    this.active = r;
    this.n = 0; this.startTime = t; this.speed = 0;
    this.add(x, y, t);
  }

  add(x, y, t) {
    if (!this.active) return;
    const n = this.n;
    if (n > 0) {
      const dx = x - this.rx[n - 1], dy = y - this.ry[n - 1];
      const d = Math.hypot(dx, dy);
      if (d < 0.0035) return;
      if (n >= MAX_RAW) return;
    }
    this.rx[n] = x; this.ry[n] = y; this.rs[n] = this.speed;
    this.n++;
  }

  get duration() { return this.active ? this.ctx.time - this.startTime : 0; }

  /** Stroke points as [{x,y}] for the recognizer (allocates once per stroke). */
  points() {
    const out = new Array(this.n);
    for (let i = 0; i < this.n; i++) out[i] = { x: this.rx[i], y: this.ry[i] };
    return out;
  }

  _rebuildActive() {
    const r = this.active, n = this.n;
    if (!r || n < 2) { if (r) r.mesh.visible = false; return; }
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);                       // 0 tail … 1 head
      const taper = 0.28 + 0.72 * Math.min(1, u / 0.45) ** 0.7;
      const swell = 0.75 + Math.min(1.25, this.rs[i] / 1.6);
      this.rw[i] = 0.0105 * taper * swell;
    }
    r.build(this.rx, this.ry, this.rw, n, 0.04);
    // Strokes past the 5 s limit dim, a quiet signal they won't count.
    const over = this.duration - 5;
    r.uniforms.uAlpha.value = over > 0 ? Math.max(0.35, 1 - over) : 1;
  }

  /** Every frame while drawing; emits particles that inherit the hand's velocity. */
  _emitWhileDrawing(dt) {
    const n = this.n;
    if (n < 2) return;
    const P = this.particles;
    const x1 = this.rx[n - 1], y1 = this.ry[n - 1];
    const seg = Math.hypot(x1 - this._lastEmitX, y1 - this._lastEmitY);
    const s = P.spec();
    s.shape = SHAPE.SEGMENT; s.ax = this._lastEmitX; s.ay = this._lastEmitY; s.bx = x1; s.by = y1;
    s.count = 4 + seg * 700;
    s.vx = this.tipVX * 0.35; s.vy = this.tipVY * 0.35; s.spread = 0.06;
    P.color(s, WHITE_GOLD, 1.5);
    s.life = 1.2; s.size = 0.011; s.curl = 1.8; s.drag = 1.6; s.gravity = 0.02; s.jitter = 0.01;
    P.emit(s);
    this._lastEmitX = x1; this._lastEmitY = y1;
    // A faint shimmer shed along the whole ribbon.
    if ((this._shed = (this._shed || 0) + dt) > 0.05) {
      this._shed = 0;
      const k = this._samplePath(this.rx, this.ry, n);
      const s2 = P.spec();
      s2.shape = SHAPE.PATH; s2.path = this.pathBuf; s2.pathCount = k; s2.ax = x1; s2.ay = y1;
      s2.count = 10 + n * 0.08; s2.spread = 0.025; s2.gravity = 0.03;
      P.color(s2, WHITE_GOLD, 1.4);
      s2.life = 1.4; s2.size = 0.007; s2.curl = 1.2; s2.drag = 1.2;
      P.emit(s2);
    }
  }

  _samplePath(xs, ys, n) {
    const k = Math.min(n, RUNE_N);
    for (let i = 0; i < k; i++) {
      const j = Math.round((i / Math.max(1, k - 1)) * (n - 1));
      this.pathBuf[i * 2] = xs[j]; this.pathBuf[i * 2 + 1] = ys[j];
    }
    return k;
  }

  // ------------------------------------------------------------ endings --
  _detach() { const r = this.active; this.active = null; return r; }

  /** Successful cast: morph the stroke into the canonical glyph. */
  snap(fit, palette, onFlare, { reveal = false } = {}) {
    const r = this._detach() || this.pool.find((p) => p.mode === 'idle') || this.pool[0];
    r.mode = 'snap';
    r.t = 0; r.fit = fit; r.palette = palette; r.onFlare = onFlare; r.flared = false; r.reveal = reveal;
    r.uniforms.uPalette.value.copy(palette.a);
    r.uniforms.uBase.value.copy(reveal ? palette.b : WHITE_GOLD);
    r.uniforms.uMix.value = reveal ? 1 : 0;
    r.uniforms.uAlpha.value = 1;
  }

  /** Unrecognised: collapse into grey-violet smoke. */
  fizzle() {
    const r = this._detach(); if (!r) return;
    r.mode = 'fizzle'; r.t = 0;
    const k = this._samplePath(this.rx, this.ry, this.n);
    r.k = k; r.sx = Float32Array.from(this.pathBuf.subarray(0, k * 2));
    let cx = 0, cy = 0; for (let i = 0; i < k; i++) { cx += r.sx[i * 2]; cy += r.sx[i * 2 + 1]; }
    r.cxm = cx / k; r.cym = cy / k;
    const P = this.particles, s = P.spec();
    s.shape = SHAPE.PATH; s.path = r.sx; s.pathCount = k; s.ax = r.cxm; s.ay = r.cym;
    s.count = 1100; s.radial = -0.05; s.spread = 0.05; s.gravity = 0.035; s.kind = KIND.SMOKE;
    P.color(s, SMOKE, 0.9);
    s.life = 2.2; s.size = 0.05; s.curl = 0.9; s.drag = 2.2; s.jitter = 0.015;
    P.emit(s);
  }

  /** Fist / junk: fade quietly. */
  dissolveQuietly(smoke = true) {
    const r = this._detach(); if (!r) return;
    r.mode = 'fade'; r.t = 0;
    if (smoke && this.n > 1) {
      const k = this._samplePath(this.rx, this.ry, this.n);
      const P = this.particles, s = P.spec();
      s.shape = SHAPE.PATH; s.path = this.pathBuf; s.pathCount = k;
      s.count = 260; s.spread = 0.03; s.gravity = 0.02; s.kind = KIND.SMOKE;
      P.color(s, SMOKE, 0.6); s.life = 1.4; s.size = 0.035; s.curl = 0.6; s.drag = 2.5;
      P.emit(s);
    }
  }

  // -------------------------------------------------------------- ghost --
  /** Faint self-drawing glyph. loop: repeat until stopGhost(). */
  showGhost(points, { loop = false, duration = 2, color = WHITE_GOLD, alpha = 0.32 } = {}) {
    const n = points.length / 2;
    this.ghostState = { pts: points, n, t: 0, loop, duration, alpha };
    this.ghost.uniforms.uBase.value.copy(color);
    this.ghost.uniforms.uMix.value = 0;
  }
  stopGhost() { if (this.ghostState) this.ghostState.stopping = true; }

  // ------------------------------------------------------------- update --
  update(dt, t, cursor) {
    // Wand tip.
    const U = this.tipU;
    U.uTime.value = t;
    this.pinchLevel += ((cursor.pinch ? 1 : 0) - this.pinchLevel) * Math.min(1, dt * 12);
    U.uPinch.value = this.pinchLevel;
    U.uAlpha.value = cursor.presence * (this.ctx.hideTip ? 0 : 1);
    this.tip.position.set(cursor.x, cursor.y, 0);
    const breath = 1 + 0.1 * Math.sin(t * Math.PI);
    this.tip.scale.setScalar(breath * (1 + this.pinchLevel * 0.35));
    const ivdt = dt > 0 ? 1 / dt : 0;
    const vx = (cursor.x - this.tipPrevX) * ivdt, vy = (cursor.y - this.tipPrevY) * ivdt;
    this.tipVX += (vx - this.tipVX) * 0.35; this.tipVY += (vy - this.tipVY) * 0.35;
    this.tipPrevX = cursor.x; this.tipPrevY = cursor.y;
    this.speed += (Math.hypot(this.tipVX, this.tipVY) - this.speed) * 0.3;

    if (cursor.presence > 0.2 && !this.active) {
      this._moteT = (this._moteT || 0) + dt;
      if (this._moteT > 0.09) {
        this._moteT = 0;
        const P = this.particles, s = P.spec();
        s.ax = cursor.x; s.ay = cursor.y; s.bx = 0; s.count = 2; s.shape = SHAPE.DISC;
        s.vx = this.tipVX * 0.15; s.vy = this.tipVY * 0.15 + 0.02; s.spread = 0.03;
        P.color(s, WHITE_GOLD, 1.6 * cursor.presence); s.life = 2.2; s.size = 0.009; s.curl = 0.8; s.drag = 0.8; s.gravity = 0.015;
        s.kind = KIND.MOTE;
        P.emit(s);
      }
    }

    if (this.active) {
      if (this.n === 1) { this._lastEmitX = this.rx[0]; this._lastEmitY = this.ry[0]; }
      this._rebuildActive();
      this._emitWhileDrawing(dt);
      this.active.uniforms.uTime.value = t;
    }

    for (const r of this.pool) {
      if (r.mode === 'idle' || r.mode === 'draw') continue;
      r.t += dt;
      r.uniforms.uTime.value = t;
      if (r.mode === 'snap') this._updateSnap(r, dt);
      else if (r.mode === 'fizzle') this._updateFizzle(r);
      else if (r.mode === 'fade') {
        r.uniforms.uAlpha.value = Math.max(0, 1 - r.t / 0.28);
        if (r.t > 0.28) this._release(r);
      }
    }
    this._updateGhost(dt);

    if (this.streakT < 1) {
      this.streakT = Math.min(1, this.streakT + dt / 0.75);
      const k = this.streakT;
      this.streakU.uAlpha.value = (1 - k) * (1 - k) * Math.min(1, k * 12);
      this.streak.scale.set(1.6 + k * 2.8, 0.5 + k * 0.4, 1);
      if (k >= 1) this.streak.visible = false;
    }
  }

  _release(r) { r.mode = 'idle'; r.mesh.visible = false; r.mesh.position.set(0, 0, 0); }

  _updateSnap(r, dt) {
    const MORPH = 0.35, HOLD = 0.32, RISE = 1.05;
    const { from, to, size } = r.fit;
    const N = RUNE_N, t = r.t;
    const w = 0.0085 + size * 0.006;
    if (t < MORPH) {
      // Point-by-point morph with a slight sweep along the path and an overshoot ease.
      const x = t / MORPH;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const k = r.reveal ? 1 : easeOutBack(clamp01(x * 1.3 - u * 0.3));
        this.mx[i] = from[i * 2] + (to[i * 2] - from[i * 2]) * k;
        this.my[i] = from[i * 2 + 1] + (to[i * 2 + 1] - from[i * 2 + 1]) * k;
        this.mw[i] = w * (0.8 + 0.4 * Math.sin(u * Math.PI));
      }
      const visible = r.reveal ? Math.max(2, Math.floor(N * easeOutCubic(x))) : N;
      r.uniforms.uMix.value = r.reveal ? 1 : easeOutCubic(x);
      r.uniforms.uIntensity.value = 1 + 0.6 * x;
      r.build(this.mx, this.my, this.mw, visible, 0);
      return;
    }
    if (!r.flared) {
      r.flared = true;
      for (let i = 0; i < N; i++) { this.mx[i] = to[i * 2]; this.my[i] = to[i * 2 + 1]; this.mw[i] = w; }
      r.build(this.mx, this.my, this.mw, N, 0);
      this._burst(r);
      this.streak.position.set(r.fit.center.x, r.fit.center.y, 0);
      this.streakU.uColor.value.copy(r.palette.a);
      this.streakT = 0; this.streak.visible = true;
      r.onFlare?.(r.fit.center);
    }
    const ft = t - MORPH;
    if (ft < HOLD) {
      r.uniforms.uIntensity.value = 1.6 + 3.2 * Math.exp(-ft * 9) + 0.25 * Math.sin(ft * 30);
      r.uniforms.uMix.value = 1;
      return;
    }
    const rt = (ft - HOLD) / RISE;
    if (rt >= 1) { this._release(r); return; }
    // Dissolve upward into the world.
    const e = easeInCubic(rt);
    r.mesh.position.y = e * 0.3;
    r.uniforms.uAlpha.value = 1 - easeOutCubic(rt);
    r.uniforms.uIntensity.value = 1.6 + rt * 0.6;
    for (let i = 0; i < N; i++) this.mw[i] = w * (1 - rt * 0.7);
    r.build(this.mx, this.my, this.mw, N, 0);
    r._riseT = (r._riseT || 0) + dt;
    if (r._riseT > 0.03) {
      r._riseT = 0;
      const P = this.particles, s = P.spec();
      for (let i = 0; i < N; i++) { this.pathBuf[i * 2] = to[i * 2]; this.pathBuf[i * 2 + 1] = to[i * 2 + 1] + e * 0.3; }
      s.shape = SHAPE.PATH; s.path = this.pathBuf; s.pathCount = N; s.ax = r.fit.center.x; s.ay = r.fit.center.y;
      s.count = 70 * (1 - rt); s.vy = 0.12; s.spread = 0.04; s.gravity = 0.18;
      P.color(s, r.palette.a, 1.2); s.life = 1.6; s.size = 0.01; s.curl = 1.4; s.drag = 1.0;
      P.emit(s);
    }
  }

  _burst(r) {
    const P = this.particles, { to, center, size } = r.fit;
    const mul = this.ctx.reducedMotion ? 0.5 : 1;
    let s = P.spec();
    s.shape = SHAPE.PATH; s.path = to; s.pathCount = RUNE_N; s.ax = center.x; s.ay = center.y;
    s.count = 2600 * mul; s.radial = 0.55 + size * 0.4; s.spread = 0.12; s.tangential = 0.3;
    P.color(s, r.palette.a, 1.5); s.life = 1.5; s.size = 0.012; s.curl = 1.6; s.drag = 2.4; s.lifeJitter = 0.7;
    P.emit(s);
    s = P.spec();
    s.shape = SHAPE.PATH; s.path = to; s.pathCount = RUNE_N; s.ax = center.x; s.ay = center.y;
    s.count = 900 * mul; s.radial = 0.12; s.spread = 0.03;
    P.color(s, r.palette.b, 1.7); s.life = 0.9; s.size = 0.016; s.drag = 3; s.lifeJitter = 0.4;
    P.emit(s);
  }

  _updateFizzle(r) {
    const T = 0.5, x = r.t / T;
    if (x >= 1) { this._release(r); return; }
    const c = easeOutCubic(x);
    const k = r.k;
    for (let i = 0; i < k; i++) {
      this.mx[i] = r.sx[i * 2] + (r.cxm - r.sx[i * 2]) * c * 0.3;
      this.my[i] = r.sx[i * 2 + 1] + (r.cym - r.sx[i * 2 + 1]) * c * 0.3 - c * 0.02;
      this.mw[i] = 0.008 * (1 - c * 0.8);
    }
    r.uniforms.uBase.value.copy(WHITE_GOLD).lerp(SMOKE, c);
    r.uniforms.uMix.value = 0;
    r.uniforms.uAlpha.value = 1 - c;
    r.uniforms.uIntensity.value = 0.9;
    r.build(this.mx, this.my, this.mw, k, 0.1);
  }

  _updateGhost(dt) {
    const g = this.ghostState, r = this.ghost;
    if (!g) { r.mesh.visible = false; return; }
    g.t += dt;
    const D = g.duration, hold = 0.6, fade = 0.5, cycle = D + hold + fade;
    let ct = g.t;
    if (g.loop) ct = g.t % cycle;
    if (g.stopping) {
      g.fadeT = (g.fadeT ?? 0) + dt;
      if (g.fadeT > 0.4) { this.ghostState = null; r.mesh.visible = false; return; }
    } else if (!g.loop && ct >= cycle) { this.ghostState = null; r.mesh.visible = false; return; }
    const p = clamp01(ct / D);
    const vis = Math.max(2, Math.floor(g.n * easeOutCubic(p)));
    for (let i = 0; i < g.n; i++) { this.mx[i] = g.pts[i * 2]; this.my[i] = g.pts[i * 2 + 1]; this.mw[i] = 0.007; }
    let a = g.alpha;
    if (ct > D + hold) a *= 1 - clamp01((ct - D - hold) / fade);
    if (g.stopping) a *= 1 - clamp01(g.fadeT / 0.4);
    r.uniforms.uAlpha.value = a * (0.8 + 0.2 * Math.sin(g.t * 3));
    r.uniforms.uIntensity.value = 1;
    r.build(this.mx, this.my, this.mw, vis, 0.02);
  }
}
