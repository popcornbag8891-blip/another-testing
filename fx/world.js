// The void: sky, fog, dust, obsidian runestones, the spectral webcam layer,
// and the spell set-pieces (lightning, fire ring, starfield, dawn).
// All lighting flows from one tweened `state`; spells push weighted layers
// onto it and nothing ever hard-cuts.
import * as THREE from 'three';
import { GLYPHS } from '../recognizer.js';

const C = (hex) => new THREE.Color(hex);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

// ----------------------------------------------------------------- noise --
const vnoiseGLSL = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;

const IDLE = {
  ambient: C('#3a2f6e'), fog: C('#3a2d7a'), sky: C('#05040b'),
  fogDensity: 1, exposure: 1, timeScale: 1,
  stars: 0, fire: 0, dawn: 0, inner: 0, swirl: 0, glyph: 0.22, bloom: 0, pulseGain: 0,
};
const NUM_KEYS = ['fogDensity', 'exposure', 'timeScale', 'stars', 'fire', 'dawn', 'inner', 'swirl', 'glyph', 'bloom', 'pulseGain'];
const COLOR_KEYS = ['ambient', 'fog', 'sky'];

// ------------------------------------------------------------- materials --
const skyMat = () => new THREE.ShaderMaterial({
  uniforms: { uSky: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color() }, uDawn: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uSky; uniform vec3 uAmbient; uniform float uDawn; uniform float uTime; varying vec2 vUv;
    ${vnoiseGLSL}
    void main(){
      vec2 uv = vUv;
      vec3 col = uSky * (0.9 + 0.35 * (1.0 - uv.y));
      col += uAmbient * 0.05 * smoothstep(0.9, 0.2, uv.y);
      // Dawn: a sun swelling behind the horizon, with soft rays.
      vec2 sp = vec2(0.5, mix(0.18, 0.36, uDawn));
      vec2 d = (uv - sp) * vec2(2.0, 1.0);
      float r = length(d);
      float ang = atan(d.y, d.x);
      float rays = 0.55 + 0.45 * fbm(vec2(ang * 6.0, uTime * 0.05));
      vec3 sun = vec3(1.0, 0.72, 0.38) * (exp(-r * 6.0) * 0.32 + exp(-r * 24.0) * 0.8) + vec3(1.0, 0.55, 0.3) * exp(-r * 2.2) * 0.16 * rays;
      col += sun * uDawn;
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthWrite: false,
});

const fogMat = (seed, speed, opacity) => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color() }, uDensity: { value: 1 }, uTime: { value: 0 }, uSeed: { value: seed },
    uSpeed: { value: speed }, uOpacity: { value: opacity }, uTwist: { value: 0 }, uPulse: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uDensity, uTime, uSeed, uSpeed, uOpacity, uTwist, uPulse; varying vec2 vUv;
    ${vnoiseGLSL}
    void main(){
      vec2 uv = vUv - 0.5;
      float r = length(uv);
      float a = uTwist * (1.0 - smoothstep(0.0, 0.6, r)) * 3.0;
      uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
      vec2 p = uv * vec2(3.2, 2.0) + vec2(uTime * uSpeed, uTime * uSpeed * 0.25) + uSeed;
      float n = fbm(p + 1.4 * vec2(fbm(p * 0.6 + uTime * 0.02), fbm(p * 0.6 - uTime * 0.017 + 5.2)));
      float band = smoothstep(0.75, 0.0, abs(vUv.y - 0.36));
      float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
      float d = smoothstep(0.22, 0.85, n) * band * edge * uDensity * uOpacity * (1.0 + uPulse * 0.9);
      gl_FragColor = vec4(uColor * d, 1.0);
    }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
});

const stoneMat = (glyphTex, palette) => new THREE.ShaderMaterial({
  uniforms: {
    uGlyph: { value: glyphTex }, uPalette: { value: palette.clone() }, uAmbient: { value: new THREE.Color() },
    uFire: { value: 0 }, uInner: { value: 0 }, uHit: { value: 0 }, uGlow: { value: 0.2 }, uActive: { value: 0 },
    uTime: { value: 0 }, uSeed: { value: Math.random() * 10 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying vec3 vObjN;
    void main(){ vObj = position; vObjN = normal; vN = normalize(mat3(modelMatrix) * normal);
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uGlyph; uniform vec3 uPalette; uniform vec3 uAmbient;
    uniform float uFire, uInner, uHit, uGlow, uActive, uTime, uSeed;
    varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying vec3 vObjN;
    ${vnoiseGLSL}
    void main(){
      vec3 N = normalize(vN);
      vec3 V = normalize(cameraPosition - vW);
      vec3 L = normalize(vec3(-0.5, 0.8, 0.6));
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      vec3 col = vec3(0.010, 0.008, 0.018);
      vec3 key = mix(vec3(0.55, 0.5, 0.8), uAmbient * 2.0, 0.6);
      col += key * max(dot(N, L), 0.0) * 0.05;
      col += key * pow(max(dot(N, normalize(L + V)), 0.0), 90.0) * 1.4;   // glassy obsidian glint
      col += uAmbient * fres * 0.9;
      // Fire light from below.
      float flick = 0.75 + 0.25 * sin(uTime * 23.0 + uSeed) * sin(uTime * 7.3 + uSeed * 2.0);
      col += vec3(1.0, 0.36, 0.08) * uFire * flick * (max(-N.y, 0.0) * 0.5 + 0.04 + fres * 0.45 + pow(max(dot(N, normalize(vec3(0.0, -0.6, 0.8) + V)), 0.0), 40.0) * 0.6);
      // Inner light through veins in the glass.
      float vein = pow(1.0 - abs(vnoise(vObj.xy * 4.0 + vObj.z * 3.0 + uSeed) * 2.0 - 1.0), 14.0);
      col += vec3(1.0, 0.7, 0.36) * uInner * (0.035 + 0.55 * vein + 0.08 * (1.0 - fres));
      // Etched glyph on the front face.
      float front = smoothstep(0.6, 0.9, vObjN.z);
      vec2 guv = vObj.xy / vec2(0.95, 0.95) * 0.5 + 0.5;
      float g = texture2D(uGlyph, guv).r * front;
      float pulse = 0.85 + 0.15 * sin(uTime * 1.3 + uSeed);
      col += uPalette * g * (uGlow * pulse + uActive * 2.2 + uInner * 0.9);
      col += vec3(0.75, 0.95, 1.0) * uHit * (1.6 + fres * 2.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

const boltMat = () => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
  vertexShader: `attribute float aAcross; varying float vA; void main(){ vA = aAcross; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vA;
    void main(){ float s = vA * vA; vec3 c = vec3(1.0) * exp(-s * 10.0) * 3.0 + uColor * exp(-s * 2.0) * 1.6; gl_FragColor = vec4(c * uAlpha, 1.0); }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false,
});

const fireMat = () => new THREE.ShaderMaterial({
  uniforms: { uRise: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(1, 0.42, 0.17) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uRise, uTime; uniform vec3 uTint; varying vec2 vUv;
    ${vnoiseGLSL}
    void main(){
      float u = vUv.x, v = vUv.y;
      float h = uRise * (0.5 + 0.4 * fbm(vec2(u * 22.0, uTime * 0.7)));
      float n = fbm(vec2(u * 46.0, v * 5.0 - uTime * 2.6));
      float n2 = fbm(vec2(u * 90.0 + 3.0, v * 9.0 - uTime * 4.1));
      float f = smoothstep(h, h - 0.32, v + (n - 0.5) * 0.35 + (n2 - 0.5) * 0.12);
      float t = clamp(v / max(h, 0.01), 0.0, 1.0);
      vec3 col = mix(vec3(1.0, 0.62, 0.22) * 0.95, uTint * 0.75, smoothstep(0.0, 0.4, t));
      col = mix(col, vec3(0.75, 0.06, 0.03) * 0.55, smoothstep(0.4, 1.0, t));
      f *= (0.55 + 0.45 * n2) * smoothstep(0.0, 0.3, v);  // tongues, no hard base
      gl_FragColor = vec4(col * f * uRise, 1.0);
    }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

const webcamMat = () => new THREE.ShaderMaterial({
  uniforms: { tVideo: { value: null }, uCover: { value: new THREE.Vector4(1, 1, 0, 0) }, uTexel: { value: new THREE.Vector2(1 / 640, 1 / 480) },
    uTint: { value: new THREE.Color() }, uOpacity: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tVideo; uniform vec4 uCover; uniform vec2 uTexel; uniform vec3 uTint; uniform float uOpacity; varying vec2 vUv;
    float lum(vec2 uv){ return dot(texture2D(tVideo, uv).rgb, vec3(0.299, 0.587, 0.114)); }
    void main(){
      vec2 uv = vUv * uCover.xy + uCover.zw; uv.x = 1.0 - uv.x;   // cover-fit, mirrored
      vec2 e = uTexel * 1.5;
      float tl = lum(uv + vec2(-e.x, e.y)), t = lum(uv + vec2(0.0, e.y)), tr = lum(uv + e);
      float l = lum(uv - vec2(e.x, 0.0)), c = lum(uv), r = lum(uv + vec2(e.x, 0.0));
      float bl = lum(uv - e), b = lum(uv - vec2(0.0, e.y)), br = lum(uv + vec2(e.x, -e.y));
      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
      float gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
      float edge = smoothstep(0.06, 0.5, length(vec2(gx, gy)));
      vec3 col = vec3(c) * 0.35 + uTint * edge * 2.4 + vec3(edge) * 0.5;
      gl_FragColor = vec4(col * uOpacity, 1.0);
    }`,
  blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
});

// ------------------------------------------------------------- formations --
function formation(name) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const p = { x: 0, y: 0, z: 0, ry: 0, rz: 0 };
    if (name === 'arc') {
      const a = THREE.MathUtils.degToRad(-55 + i * 22);
      p.x = 7.6 * Math.sin(a); p.z = -3 + 7.6 * (1 - Math.cos(a)) * 0.55; p.y = 0.25 + 0.35 * Math.cos(i * 1.7); p.ry = -a * 0.55;
    } else if (name === 'circle') {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      p.x = 3.9 * Math.sin(a); p.z = -2.6 + 3.2 * Math.cos(a); p.y = 0.3 + 0.45 * Math.sin(a * 2); p.ry = a * 0.25;
    } else if (name === 'grid') {
      p.x = -3.3 + (i % 3) * 3.3; p.y = i < 3 ? 1.45 : -1.15; p.z = -1.8; p.ry = (i % 3 - 1) * -0.18;
    } else { // tower: slabs laid on their side, stacked
      p.x = Math.sin(i * 1.9) * 0.3; p.y = -3.25 + i * 1.3; p.z = -2.2; p.rz = Math.PI / 2 + Math.sin(i * 2.3) * 0.08; p.ry = Math.sin(i) * 0.25;
    }
    out.push(p);
  }
  return out;
}
export const FORMATIONS = ['arc', 'circle', 'grid', 'tower'];

function glyphTexture(name) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  const pts = GLYPHS[name].draw;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const s = 150 / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const path = () => { g.beginPath(); pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](128 + (x - cx) * s, 128 - (y - cy) * s)); };
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 18; g.lineWidth = 7; g.globalAlpha = 0.5; path(); g.stroke();
  g.shadowBlur = 0; g.lineWidth = 3.5; g.globalAlpha = 1; path(); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function stoneGeometry(seed) {
  const r = (k) => { const x = Math.sin(seed * 91.7 + k * 13.1) * 43758.5453; return x - Math.floor(x); };
  const s = new THREE.Shape();
  const j = (v, k) => v + (r(k) - 0.5) * 0.12;
  s.moveTo(j(-0.36, 1), -1.0);
  s.lineTo(j(0.36, 2), -1.0);
  s.lineTo(j(0.5, 3), j(0.45, 4));
  s.lineTo(j(0.16, 5), j(1.02, 6));
  s.lineTo(j(-0.22, 7), j(0.92, 8));
  s.lineTo(j(-0.5, 9), j(0.4, 10));
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 2, curveSegments: 1 });
  geo.translate(0, 0, -0.15);
  return geo; // ExtrudeGeometry is already non-indexed (flat facets)
}

// ----------------------------------------------------------------- world --
export class World {
  constructor(renderer, spells, opts) {
    this.renderer = renderer;
    this.opts = opts; // { reducedMotion }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.camBase = new THREE.Vector3(0, 0.4, 11);
    this.camera.position.copy(this.camBase);
    this.lookAt = new THREE.Vector3(0, 0.15, 0);
    this.shakeAmt = 0;

    // Live, blended world state.
    this.state = {};
    for (const k of NUM_KEYS) this.state[k] = IDLE[k];
    for (const k of COLOR_KEYS) this.state[k] = IDLE[k].clone();
    this.effects = [];
    this.pulse = 0;

    this._buildSky();
    this._buildFog();
    this._buildDust();
    this._buildStones(spells);
    this._buildFire();
    this._buildStars();
    this._buildBolts();

    this._v = new THREE.Vector3();
    this._spring = { k: 22, c: 5.6 };
  }

  // ----------------------------------------------------------- building --
  _buildSky() {
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(320, 170), skyMat());
    this.sky.position.set(0, 10, -90);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  _buildFog() {
    this.fog = [];
    const layers = [[-14, 0.65, 0.012], [-8, 0.55, 0.018], [-4, 0.42, 0.024], [1.5, 0.26, 0.032], [6, 0.14, 0.04]];
    layers.forEach(([z, op, sp], i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), fogMat(i * 7.3, sp, op));
      m.position.set(0, -1.5, z);
      m.renderOrder = 1;
      this.scene.add(m);
      this.fog.push(m);
    });
  }

  _buildDust() {
    const N = 2800;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 2] = -16 + Math.random() * 24;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uPixel: { value: 1 }, uPulse: { value: 0 }, uSwirl: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime, uPixel, uPulse, uSwirl; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * (0.4 + aSeed * 0.6);
          p.x += sin(t * 0.21 + aSeed * 40.0) * 0.8;
          p.y = mod(p.y + t * 0.12 + 8.0, 16.0) - 8.0;
          p.z += cos(t * 0.17 + aSeed * 23.0) * 0.6;
          float a = uSwirl * (1.0 - smoothstep(0.0, 14.0, length(p.xy))) * 2.5;
          p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float tw = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 60.0);
          vA = tw * smoothstep(-30.0, -4.0, mv.z) * smoothstep(0.5, 3.0, -mv.z) * (1.0 + uPulse);
          gl_PointSize = min(7.0, (0.05 + aSeed * 0.07) * uPixel / -mv.z * (1.0 + uPulse * 0.5));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-r * r * 5.0) * vA; gl_FragColor = vec4(uColor * a, 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 2;
    this.scene.add(this.dust);
  }

  _buildStones(spells) {
    this.stones = [];
    this.formationIndex = 0;
    const slots = formation('arc');
    spells.forEach((sp, i) => {
      const mesh = new THREE.Mesh(stoneGeometry(i + 1), stoneMat(glyphTexture(sp.template), sp.palette.a));
      mesh.scale.setScalar(0.85);
      const s = slots[i];
      mesh.position.set(s.x, s.y, s.z);
      this.scene.add(mesh);
      this.stones.push({
        mesh, spell: sp, slot: i, seed: i * 1.7,
        pos: new THREE.Vector3(s.x, s.y, s.z), vel: new THREE.Vector3(), target: new THREE.Vector3(s.x, s.y, s.z),
        ry: s.ry, rz: s.rz, vry: 0, vrz: 0, tRy: s.ry, tRz: s.rz, hit: 0, active: 0,
      });
    });
    this.vortexT = -1;
  }

  _buildFire() {
    this.fireMat = fireMat();
    this.fire = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 5.4, 128, 1, true), this.fireMat);
    this.fire.position.set(0, -3.75, -2.0);
    this.fire.renderOrder = 3;
    this.fire.visible = false;
    this.scene.add(this.fire);
  }

  _buildStars() {
    const N = 2600;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 140;
      pos[i * 3 + 1] = -12 + Math.random() * 60;
      pos[i * 3 + 2] = -55 - Math.random() * 20;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: /* glsl */ `uniform float uTime, uReveal, uPixel; attribute float aSeed; varying float vA; varying float vS;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float big = step(0.985, aSeed);
          vA = uReveal * (0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 3.0) + aSeed * 90.0)) * (0.6 + big * 0.8);
          vS = aSeed;
          gl_PointSize = max(1.0, (0.12 + aSeed * 0.18 + big * 0.22) * uPixel / -mv.z * 1.6);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying float vS;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-r * r * 9.0) * vA;
          vec3 c = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.92, 0.8), step(0.7, vS)); gl_FragColor = vec4(c * a * 2.0, 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -5;
    this.stars.visible = false;
    this.scene.add(this.stars);

    // Constellations: chains of bright stars whose lines draw themselves.
    const lp = [], lprog = [], bright = [];
    const centers = [[-28, 22], [-6, 27], [18, 24], [34, 14], [-36, 6], [8, 12], [-16, 14]];
    centers.forEach(([cx, cy], ci) => {
      let x = cx, y = cy;
      const chain = [[x, y]];
      const n = 4 + (ci % 3);
      for (let k = 0; k < n; k++) {
        const a = (ci * 2.1 + k * 1.3 + Math.random()) % (Math.PI * 2);
        x += Math.cos(a) * (3 + Math.random() * 3.5); y += Math.sin(a) * (2 + Math.random() * 3);
        chain.push([x, y]);
      }
      chain.forEach(([px, py]) => bright.push(px, py, -60));
      for (let k = 0; k < chain.length - 1; k++) {
        lp.push(chain[k][0], chain[k][1], -60, chain[k + 1][0], chain[k + 1][1], -60);
        const p0 = (ci * 0.6 + k) / (n + 4), p1 = (ci * 0.6 + k + 1) / (n + 4);
        lprog.push(p0, p1);
      }
    });
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    lgeo.setAttribute('aProg', new THREE.BufferAttribute(new Float32Array(lprog), 1));
    this.constMat = new THREE.ShaderMaterial({
      uniforms: { uReveal: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: `attribute float aProg; varying float vP; void main(){ vP = aProg; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uReveal, uAlpha; varying float vP;
        void main(){ if (vP > uReveal) discard; float head = smoothstep(uReveal - 0.04, uReveal, vP);
          gl_FragColor = vec4(vec3(0.6, 0.8, 1.0) * (0.5 + head * 2.5) * uAlpha, 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.constLines = new THREE.LineSegments(lgeo, this.constMat);
    this.constLines.frustumCulled = false;
    this.constLines.visible = false;
    this.scene.add(this.constLines);
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bright), 3));
    bgeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(bright.length / 3).fill(0.995), 1));
    this.constStars = new THREE.Points(bgeo, this.starMat);
    this.constStars.frustumCulled = false;
    this.constStars.visible = false;
    this.scene.add(this.constStars);
    this.constReveal = 0;

    // Meteors.
    this.meteors = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uAlpha; varying vec2 vUv;
          void main(){ float a = pow(vUv.x, 3.0) * exp(-pow((vUv.y - 0.5) * 2.0, 2.0) * 6.0);
            gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * a * uAlpha * 3.0, 1.0); }`,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      m.visible = false;
      m.scale.set(9, 0.22, 1);
      this.scene.add(m);
      this.meteors.push({ mesh: m, t: 1, vx: 0, vy: 0 });
    }
    this.meteorTimer = 0;
  }

  _buildBolts() {
    this.bolts = [];
    const CAP = 1600;
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(CAP * 3), across = new Float32Array(CAP);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aAcross', new THREE.BufferAttribute(across, 1).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.Mesh(geo, boltMat());
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      this.bolts.push({ mesh, pos, across, n: 0, t: 1, cap: CAP });
    }
  }

  // ------------------------------------------------------------- effects --
  /**
   * Push a weighted layer onto the world. Layers ease in, hold, ease out, and
   * stack additively with whatever else is active (that's what makes combos).
   */
  addEffect({ targets = {}, attack = 1.0, hold = 6, release = 2.5, update = null, onEnd = null, sticky = false, tag = null }) {
    const fx = { targets: {}, attack, hold, release, update, onEnd, sticky, tag, t: 0, w: 0, releasing: false, relFrom: 0, relT: 0 };
    for (const [k, v] of Object.entries(targets)) fx.targets[k] = COLOR_KEYS.includes(k) ? C(v) : v;
    this.effects.push(fx);
    return fx;
  }

  releaseEffect(fx) {
    if (!fx || fx.releasing) return;
    fx.releasing = true; fx.relFrom = fx.w; fx.relT = 0;
  }

  dispelAll() { for (const fx of this.effects) this.releaseEffect(fx); }

  shake(amount) { if (!this.opts.reducedMotion) this.shakeAmt = Math.max(this.shakeAmt, amount); }

  // ------------------------------------------------------------- vortex --
  rearrange() {
    this.formationIndex = (this.formationIndex + 1) % FORMATIONS.length;
    const slots = formation(FORMATIONS[this.formationIndex]);
    // Shuffle stones across slots so positions swap, never the identity.
    const order = [0, 1, 2, 3, 4, 5];
    do {
      for (let i = 5; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    } while (order.some((v, i) => v === this.stones[i].slot) && Math.random() < 0.85);
    this.pendingSlots = slots; this.pendingOrder = order;
    this.vortexT = 0;
    for (const s of this.stones) { s.spinR = Math.hypot(s.pos.x, s.pos.y - 0.3); s.spinA = Math.atan2(s.pos.y - 0.3, s.pos.x); }
    return FORMATIONS[this.formationIndex];
  }

  // -------------------------------------------------------------- strike --
  /** Forked lightning into a stone. Returns the stone's world position. */
  strike(stoneIndex, color) {
    const b = this.bolts.find((x) => x.t >= 1) || this.bolts[0];
    const s = this.stones[stoneIndex];
    const end = s.pos.clone().add(this._v.set(0, 0.9 * 0.85, 0));
    const start = new THREE.Vector3(end.x + (Math.random() - 0.5) * 6, 9, end.z - 2);
    b.n = 0;
    const main = this._displace(start, end, 6, 0.32);
    this._boltStrip(b, main, 0.06);
    // A few branches peeling off the main channel.
    for (let k = 0; k < 3; k++) {
      const i = 4 + Math.floor(Math.random() * (main.length * 0.6));
      const a = main[i];
      const dir = new THREE.Vector3((Math.random() - 0.5) * 3.5, -1.5 - Math.random() * 2.5, (Math.random() - 0.5));
      this._boltStrip(b, this._displace(a, a.clone().add(dir), 4, 0.3), 0.028);
    }
    const g = b.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aAcross.needsUpdate = true;
    g.setDrawRange(0, b.n);
    b.mesh.material.uniforms.uColor.value.copy(color);
    b.t = 0;
    b.mesh.visible = true;
    s.hit = 1;
    return end;
  }

  _displace(a, b, depth, rough) {
    let pts = [a.clone(), b.clone()];
    let disp = a.distanceTo(b) * rough;
    for (let d = 0; d < depth; d++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const m = p.clone().lerp(q, 0.5);
        const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
        const off = (Math.random() - 0.5) * disp;
        m.x += (-dy / l) * off; m.y += (dx / l) * off; m.z += (Math.random() - 0.5) * disp * 0.3;
        next.push(m, q);
      }
      pts = next;
      disp *= 0.55;
    }
    return pts;
  }

  _boltStrip(b, pts, w) {
    for (let i = 0; i < pts.length - 1 && b.n + 6 <= b.cap; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
      const taper = 1 - (i / pts.length) * 0.5;
      const nx = (-dy / l) * w * taper, ny = (dx / l) * w * taper;
      const quad = [[p, 1, -1], [p, -1, 1], [q, 1, -1], [p, -1, 1], [q, -1, 1], [q, 1, -1]];
      for (const [v, sgn, acr] of quad) {
        b.pos[b.n * 3] = v.x + nx * sgn; b.pos[b.n * 3 + 1] = v.y + ny * sgn; b.pos[b.n * 3 + 2] = v.z;
        b.across[b.n] = acr; b.n++;
      }
    }
  }

  /** World → overlay (ortho) coordinates. */
  toOverlay(v, out) {
    this._v.copy(v).project(this.camera);
    out.x = this._v.x * this.camera.aspect; out.y = this._v.y;
    return out;
  }

  // -------------------------------------------------------------- update --
  update(dt, t, pixelScale) {
    // 1. Blend effect layers into state.
    const S = this.state;
    for (const k of NUM_KEYS) S[k] = IDLE[k];
    for (const k of COLOR_KEYS) S[k].copy(IDLE[k]);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.t += dt;
      if (fx.releasing) {
        fx.relT += dt;
        fx.w = fx.relFrom * (1 - smooth(fx.relT / fx.release));
        if (fx.relT >= fx.release) { this.effects.splice(i, 1); fx.onEnd?.(); continue; }
      } else {
        fx.w = smooth(fx.t / fx.attack);
        if (!fx.sticky && fx.t > fx.attack + fx.hold) this.releaseEffect(fx);
      }
    }
    for (const fx of this.effects) {
      const w = fx.w;
      for (const k in fx.targets) {
        const v = fx.targets[k];
        if (COLOR_KEYS.includes(k)) S[k].lerp(v, w * 0.85);
        else S[k] += (v - IDLE[k]) * w;
      }
    }
    for (const fx of this.effects) fx.update?.(fx.w, dt, t, fx);

    const P = this.pulse * S.pulseGain;

    // 2. Push state into materials.
    const su = this.sky.material.uniforms;
    su.uSky.value.copy(S.sky); su.uAmbient.value.copy(S.ambient); su.uDawn.value = S.dawn; su.uTime.value = t;
    const fogVis = S.fogDensity;
    for (const f of this.fog) {
      const u = f.material.uniforms;
      u.uColor.value.copy(S.fog); u.uDensity.value = fogVis; u.uTime.value = t * S.timeScale;
      u.uTwist.value = S.swirl; u.uPulse.value = P;
    }
    const du = this.dustMat.uniforms;
    du.uTime.value = t * S.timeScale; du.uColor.value.copy(S.ambient).multiplyScalar(1.6); du.uPixel.value = pixelScale;
    du.uPulse.value = P; du.uSwirl.value = S.swirl;

    // 3. Stones: springs, bobbing, vortex spiral.
    if (this.vortexT >= 0) {
      this.vortexT += dt;
      const SPIN = 1.0;
      if (this.vortexT < SPIN) {
        const x = this.vortexT / SPIN, e = smooth(x);
        for (const s of this.stones) {
          const a = s.spinA + e * Math.PI * 2.4;
          const r = s.spinR * (1 - e * 0.82) + 0.4;
          s.target.set(Math.cos(a) * r, 0.3 + Math.sin(a) * r * 0.75, -2 + Math.sin(a) * 1.2);
          s.tRy = s.ry + 0.2; s.tRz = s.rz * (1 - e);
        }
      } else {
        this.stones.forEach((s, i) => {
          const slot = this.pendingSlots[this.pendingOrder[i]];
          s.slot = this.pendingOrder[i];
          s.target.set(slot.x, slot.y, slot.z); s.tRy = slot.ry; s.tRz = slot.rz;
        });
        this.vortexT = -1;
      }
    }
    const k = this.vortexT >= 0 ? 55 : this._spring.k, c = this.vortexT >= 0 ? 9 : this._spring.c;
    const sdt = Math.min(dt, 1 / 30);
    for (let i = 0; i < this.stones.length; i++) {
      const s = this.stones[i];
      s.vel.x += (k * (s.target.x - s.pos.x) - c * s.vel.x) * sdt;
      s.vel.y += (k * (s.target.y - s.pos.y) - c * s.vel.y) * sdt;
      s.vel.z += (k * (s.target.z - s.pos.z) - c * s.vel.z) * sdt;
      s.pos.addScaledVector(s.vel, sdt);
      s.vry += (k * 0.6 * (s.tRy - s.ry) - c * 0.8 * s.vry) * sdt; s.ry += s.vry * sdt;
      s.vrz += (k * 0.6 * (s.tRz - s.rz) - c * 0.8 * s.vrz) * sdt; s.rz += s.vrz * sdt;
      const bob = Math.sin(t * 0.55 * S.timeScale + i * 1.3) * 0.13;
      s.mesh.position.set(s.pos.x, s.pos.y + bob, s.pos.z);
      s.mesh.rotation.set(Math.sin(t * 0.3 + i) * 0.05, s.ry + Math.sin(t * 0.21 + i * 2) * 0.12, s.rz);
      s.hit = Math.max(0, s.hit - dt * 3.2);
      s.active = Math.max(0, s.active - dt * 0.22);
      const u = s.mesh.material.uniforms;
      u.uAmbient.value.copy(S.ambient); u.uFire.value = S.fire; u.uInner.value = S.inner;
      u.uHit.value = s.hit * s.hit; u.uGlow.value = S.glyph * (1 + P * 2); u.uActive.value = s.active; u.uTime.value = t;
    }

    // 4. Set pieces.
    this.fire.visible = S.fire > 0.01;
    this.fireMat.uniforms.uRise.value = S.fire; this.fireMat.uniforms.uTime.value = t;

    const sv = S.stars;
    this.stars.visible = this.constLines.visible = this.constStars.visible = sv > 0.01;
    this.starMat.uniforms.uReveal.value = sv; this.starMat.uniforms.uTime.value = t; this.starMat.uniforms.uPixel.value = pixelScale;
    this.constReveal = sv > 0.5 ? Math.min(1.05, this.constReveal + dt * 0.16) : Math.max(0, this.constReveal - dt * 0.5);
    this.constMat.uniforms.uReveal.value = this.constReveal; this.constMat.uniforms.uAlpha.value = sv;
    this.meteorTimer -= dt;
    if (sv > 0.6 && this.meteorTimer <= 0) {
      this.meteorTimer = 0.7 + Math.random() * 1.3;
      const m = this.meteors.find((x) => x.t >= 1);
      if (m) {
        m.t = 0; m.mesh.visible = true;
        m.mesh.position.set(-10 + Math.random() * 50, 18 + Math.random() * 14, -50);
        const a = Math.PI + 0.45 + Math.random() * 0.3;
        m.vx = Math.cos(a) * 55; m.vy = Math.sin(a) * 55;
        m.mesh.rotation.z = a + Math.PI;
      }
    }
    for (const m of this.meteors) {
      if (m.t >= 1) { m.mesh.visible = false; continue; }
      m.t += dt / 0.9;
      m.mesh.position.x += m.vx * dt; m.mesh.position.y += m.vy * dt;
      m.mesh.material.uniforms.uAlpha.value = Math.sin(Math.min(1, m.t) * Math.PI) * sv;
    }

    for (const b of this.bolts) {
      if (b.t >= 1) { b.mesh.visible = false; continue; }
      b.t += dt / 0.5;
      const tt = b.t * 0.5;
      const flick = tt < 0.05 ? 1 : tt < 0.09 ? 0.15 : tt < 0.15 ? 1 : Math.max(0, 1 - (tt - 0.15) / 0.35);
      b.mesh.material.uniforms.uAlpha.value = flick;
    }

    // 5. Camera: gentle drift + shake.
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const sh = this.shakeAmt * this.shakeAmt;
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 0.07) * 0.25 + (Math.random() - 0.5) * sh * 0.5,
      this.camBase.y + Math.sin(t * 0.05) * 0.12 + (Math.random() - 0.5) * sh * 0.5,
      this.camBase.z,
    );
    this.camera.lookAt(this.lookAt);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Spectral webcam layer, lives in the overlay scene. */
  createWebcamLayer(overlayScene) {
    this.webcam = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), webcamMat());
    this.webcam.renderOrder = -1;
    this.webcam.visible = false;
    this.webcam.frustumCulled = false;
    overlayScene.add(this.webcam);
    return this.webcam;
  }
}
