// GPGPU particles: 256×256 texels = 65,536 particles simulated entirely on the
// GPU. The CPU never touches a particle; it only describes *emitters* (up to
// 16 per frame) as uniforms, and each texel decides for itself whether it was
// just spawned by one. Allocation is a ring buffer over texel indices.
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

const SIZE = 256;
const MAX_EM = 16;
const PATH_LEN = 128;

export const SHAPE = { DISC: 0, SEGMENT: 1, PATH: 2, RING: 3, RECT: 4 };
export const KIND = { SPARK: 0, SMOKE: 1, MOTE: 2 };

const noiseGLSL = /* glsl */ `
// Ashima/McEwan 3D simplex noise (MIT).
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const spawnGLSL = /* glsl */ `
#define MAX_EM ${MAX_EM}
uniform vec4 uEm0[MAX_EM]; // start, count, shape, seed
uniform vec4 uEm1[MAX_EM]; // ax, ay, bx, by   (path: cx, cy, pathCount, -)
uniform vec4 uEm2[MAX_EM]; // vx, vy, spread, radial
uniform vec4 uEm3[MAX_EM]; // r, g, b, kind
uniform vec4 uEm4[MAX_EM]; // life, size, curl, gravity
uniform vec4 uEm5[MAX_EM]; // drag, posJitter, lifeJitter, tangential
uniform int uEmCount;
uniform sampler2D uPaths;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// Returns emitter slot that spawned this texel this frame, or -1.
int spawnSlot(float idx, out float local){
  for (int i = 0; i < MAX_EM; i++) {
    if (i >= uEmCount) break;
    vec4 e = uEm0[i];
    if (idx >= e.x && idx < e.x + e.y) { local = idx - e.x; return i; }
  }
  return -1;
}

void spawn(int i, float local, float idx, out vec4 pos, out vec4 vel, out vec4 col, out vec4 meta){
  vec4 e0 = uEm0[i], e1 = uEm1[i], e2 = uEm2[i], e3 = uEm3[i], e4 = uEm4[i], e5 = uEm5[i];
  float r1 = hash(vec2(idx, e0.w)), r2 = hash(vec2(idx * 1.37, e0.w + 7.1));
  float r3 = hash(vec2(idx * 0.71, e0.w + 3.3)), r4 = hash(vec2(idx * 2.13, e0.w + 1.9));
  float ang = r2 * 6.2831853;
  vec2 rdir = vec2(cos(ang), sin(ang));
  vec2 p; vec2 center; vec2 tangent = vec2(0.0);
  int shape = int(e0.z + 0.5);
  if (shape == 1) { p = mix(e1.xy, e1.zw, r1); center = mix(e1.xy, e1.zw, 0.5); tangent = normalize(e1.zw - e1.xy + 1e-5); }
  else if (shape == 2) {
    float n = max(e1.z, 2.0);
    float f = r1 * (n - 1.0); float k = floor(f);
    float row = (float(i) + 0.5) / float(MAX_EM);
    vec2 a = texture2D(uPaths, vec2((k + 0.5) / ${PATH_LEN}.0, row)).xy;
    vec2 b = texture2D(uPaths, vec2((min(k + 1.0, n - 1.0) + 0.5) / ${PATH_LEN}.0, row)).xy;
    p = mix(a, b, f - k); center = e1.xy; tangent = normalize(b - a + 1e-5);
  }
  else if (shape == 3) { p = e1.xy + rdir * e1.z; center = e1.xy; tangent = vec2(-rdir.y, rdir.x); }
  else if (shape == 4) { p = vec2(mix(e1.x, e1.z, r1), mix(e1.y, e1.w, r3)); center = vec2(p.x, e1.y); }
  else { p = e1.xy + rdir * e1.z * sqrt(r1); center = e1.xy; }
  p += (vec2(r3, r4) - 0.5) * e5.y;
  vec2 out_ = p - center; float ol = length(out_);
  vec2 radialDir = ol > 1e-4 ? out_ / ol : rdir;
  vec2 v = e2.xy + rdir * e2.z * (0.25 + 0.75 * r3) + radialDir * e2.w * (0.55 + 0.45 * r4) + tangent * e5.w * (r3 - 0.5);
  pos = vec4(p, r4 * 2.0 - 1.0, 1.0);
  vel = vec4(v, 0.0, e5.x);
  float bright = 0.75 + 0.5 * r2;
  col = vec4(e3.rgb * bright, e3.w);
  meta = vec4(e4.x * (1.0 + (r1 - 0.5) * e5.z), e4.y * (0.45 + 1.1 * r3), e4.z, e4.w);
}`;

const commonHeader = /* glsl */ `
uniform float uDt;
uniform float uTime;
${spawnGLSL}
float texIndex(){ return floor(gl_FragCoord.y) * ${SIZE}.0 + floor(gl_FragCoord.x); }
`;

const posShader = /* glsl */ `
${commonHeader}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float local; float idx = texIndex();
  int s = spawnSlot(idx, local);
  if (s >= 0) { vec4 p, v, c, m; spawn(s, local, idx, p, v, c, m); gl_FragColor = p; return; }
  vec4 p = texture2D(texturePosition, uv);
  if (p.w <= 0.0) { gl_FragColor = p; return; }
  vec4 v = texture2D(textureVelocity, uv);
  vec4 m = texture2D(textureMeta, uv);
  p.xy += v.xy * uDt;
  p.w -= uDt / max(m.x, 0.05);
  gl_FragColor = p;
}`;

const velShader = /* glsl */ `
${commonHeader}
uniform vec3 uSwirl;   // x, y, strength
uniform float uPulse;
${noiseGLSL}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float local; float idx = texIndex();
  int s = spawnSlot(idx, local);
  if (s >= 0) { vec4 p, v, c, m; spawn(s, local, idx, p, v, c, m); gl_FragColor = v; return; }
  vec4 v = texture2D(textureVelocity, uv);
  vec4 p = texture2D(texturePosition, uv);
  if (p.w <= 0.0) { gl_FragColor = v; return; }
  vec4 m = texture2D(textureMeta, uv);
  if (m.z > 0.0) {
    // 2D curl of a time-varying noise field: divergence-free, so it swirls instead of clumping.
    vec3 q = vec3(p.xy * 1.7, uTime * 0.22 + p.z);
    float e = 0.02;
    float n0 = snoise(q);
    float nx = snoise(q + vec3(e, 0.0, 0.0));
    float ny = snoise(q + vec3(0.0, e, 0.0));
    vec2 curl = vec2(ny - n0, -(nx - n0)) / e;
    v.xy += curl * m.z * uDt * 0.35;
  }
  v.y += m.w * uDt;
  if (uSwirl.z != 0.0) {
    vec2 d = p.xy - uSwirl.xy; float r = length(d) + 0.15;
    v.xy += (vec2(-d.y, d.x) / r - d * 0.45) * uSwirl.z * uDt;
  }
  if (uPulse > 0.0) v.xy += normalize(p.xy + 1e-4) * uPulse * uDt * 0.6;
  v.xy *= exp(-v.w * uDt);
  gl_FragColor = v;
}`;

const colShader = /* glsl */ `
${commonHeader}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float local; float idx = texIndex();
  int s = spawnSlot(idx, local);
  if (s >= 0) { vec4 p, v, c, m; spawn(s, local, idx, p, v, c, m); gl_FragColor = c; return; }
  gl_FragColor = texture2D(textureColor, uv);
}`;

const metaShader = /* glsl */ `
${commonHeader}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float local; float idx = texIndex();
  int s = spawnSlot(idx, local);
  if (s >= 0) { vec4 p, v, c, m; spawn(s, local, idx, p, v, c, m); gl_FragColor = m; return; }
  gl_FragColor = texture2D(textureMeta, uv);
}`;

const renderVS = /* glsl */ `
uniform sampler2D tPos; uniform sampler2D tCol; uniform sampler2D tMeta;
uniform float uPixel; uniform float uPulse;
attribute vec2 ref;
varying vec3 vCol; varying float vAlpha; varying float vKind;
void main(){
  vec4 p = texture2D(tPos, ref);
  if (p.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 c = texture2D(tCol, ref); vec4 m = texture2D(tMeta, ref);
  float life = p.w;
  float kind = c.w;
  float fade = smoothstep(0.0, 0.3, life) * smoothstep(1.0, 0.92, life);
  float grow = kind > 0.5 && kind < 1.5 ? 1.0 + (1.0 - life) * 2.6 : (kind > 1.5 ? 1.0 : 0.55 + 0.45 * life);
  float size = m.y * grow * (1.0 + 0.25 * p.z) * (1.0 + uPulse * 0.6);
  gl_PointSize = clamp(size * uPixel, 1.0, 256.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p.xy, 0.0, 1.0);
  vCol = c.rgb; vKind = kind;
  vAlpha = fade * (kind > 0.5 && kind < 1.5 ? 0.22 : 1.0);
}`;

const renderFS = /* glsl */ `
varying vec3 vCol; varying float vAlpha; varying float vKind;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 9.0);
  float halo = exp(-r2 * 3.0);
  float a = vKind > 0.5 && vKind < 1.5 ? halo * (1.0 - r2) : core * 1.4 + halo * 0.35;
  gl_FragColor = vec4(vCol * a * vAlpha, 1.0);
}`;

export class Particles {
  constructor(renderer, scene) {
    this.renderer = renderer;
    const gpu = new GPUComputationRenderer(SIZE, SIZE, renderer);
    if (!renderer.extensions.has('EXT_color_buffer_float')) gpu.setDataType(THREE.HalfFloatType);
    const empty = () => {
      const t = gpu.createTexture();
      t.image.data.fill(0);
      return t;
    };
    this.vPos = gpu.addVariable('texturePosition', posShader, empty());
    this.vVel = gpu.addVariable('textureVelocity', velShader, empty());
    this.vCol = gpu.addVariable('textureColor', colShader, empty());
    this.vMeta = gpu.addVariable('textureMeta', metaShader, empty());
    const all = [this.vPos, this.vVel, this.vCol, this.vMeta];
    for (const v of all) gpu.setVariableDependencies(v, all);

    // Shared emitter uniforms: one set of arrays referenced by all four shaders.
    this.pathData = new Float32Array(PATH_LEN * MAX_EM * 4);
    this.pathTex = new THREE.DataTexture(this.pathData, PATH_LEN, MAX_EM, THREE.RGBAFormat, THREE.FloatType);
    this.pathTex.needsUpdate = true;
    this.u = {
      uDt: { value: 0 }, uTime: { value: 0 }, uEmCount: { value: 0 }, uPaths: { value: this.pathTex },
      uSwirl: { value: new THREE.Vector3() }, uPulse: { value: 0 },
    };
    for (let k = 0; k < 6; k++) {
      this.u['uEm' + k] = { value: Array.from({ length: MAX_EM }, () => new THREE.Vector4()) };
    }
    for (const v of all) Object.assign(v.material.uniforms, this.u);

    const err = gpu.init();
    if (err) console.error('[sigil] particles:', err);
    this.gpu = gpu;
    this.capacity = SIZE * SIZE;
    this.cursor = 0;
    this.emCount = 0;
    this.pathDirty = false;
    this.scale = 1; // reduced-motion / adaptive budget multiplier

    // Render: one point per texel.
    const geo = new THREE.BufferGeometry();
    const ref = new Float32Array(SIZE * SIZE * 2);
    for (let i = 0; i < SIZE * SIZE; i++) {
      ref[i * 2] = ((i % SIZE) + 0.5) / SIZE;
      ref[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE;
    }
    geo.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SIZE * SIZE * 3), 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { tPos: { value: null }, tCol: { value: null }, tMeta: { value: null }, uPixel: { value: 500 }, uPulse: { value: 0 } },
      vertexShader: renderVS, fragmentShader: renderFS,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    this._spec = {};
    this.spec();
  }

  /** Returns the shared, reset emitter description. Fill it in, then emit(). */
  spec() {
    const s = this._spec;
    s.count = 100; s.shape = SHAPE.DISC;
    s.ax = 0; s.ay = 0; s.bx = 0; s.by = 0;
    s.vx = 0; s.vy = 0; s.spread = 0.1; s.radial = 0; s.tangential = 0;
    s.r = 1; s.g = 1; s.b = 1; s.kind = KIND.SPARK;
    s.life = 1; s.size = 0.01; s.curl = 0; s.gravity = 0;
    s.drag = 1; s.jitter = 0; s.lifeJitter = 0.5;
    s.path = null; s.pathCount = 0;
    return s;
  }

  color(s, c, mul = 1) { s.r = c.r * mul; s.g = c.g * mul; s.b = c.b * mul; return s; }

  emit(s) {
    if (this.emCount >= MAX_EM) return;
    let count = Math.floor(s.count * this.scale);
    if (count < 1) return;
    count = Math.min(count, this.capacity);
    if (this.cursor + count > this.capacity) this.cursor = 0;
    const i = this.emCount++;
    const U = this.u;
    U.uEm0.value[i].set(this.cursor, count, s.shape, Math.random() * 1000);
    if (s.shape === SHAPE.PATH) {
      const n = Math.min(s.pathCount, PATH_LEN);
      const base = i * PATH_LEN * 4;
      for (let k = 0; k < n; k++) {
        this.pathData[base + k * 4] = s.path[k * 2];
        this.pathData[base + k * 4 + 1] = s.path[k * 2 + 1];
      }
      this.pathDirty = true;
      U.uEm1.value[i].set(s.ax, s.ay, n, 0);
    } else U.uEm1.value[i].set(s.ax, s.ay, s.bx, s.by);
    U.uEm2.value[i].set(s.vx, s.vy, s.spread, s.radial);
    U.uEm3.value[i].set(s.r, s.g, s.b, s.kind);
    U.uEm4.value[i].set(s.life, s.size, s.curl, s.gravity);
    U.uEm5.value[i].set(s.drag, s.jitter, s.lifeJitter, s.tangential);
    this.cursor += count;
  }

  /** Halve (or restore) the live particle budget. */
  setBudget(fraction) {
    this.capacity = Math.max(1024, Math.floor(SIZE * SIZE * fraction));
    this.cursor = 0;
    this.points.geometry.setDrawRange(0, this.capacity);
  }

  update(dt, time, pixelScale) {
    this.u.uDt.value = Math.min(dt, 1 / 20);
    this.u.uTime.value = time;
    this.u.uEmCount.value = this.emCount;
    if (this.pathDirty) { this.pathTex.needsUpdate = true; this.pathDirty = false; }
    this.gpu.compute();
    this.emCount = 0;
    const m = this.material.uniforms;
    m.tPos.value = this.gpu.getCurrentRenderTarget(this.vPos).texture;
    m.tCol.value = this.gpu.getCurrentRenderTarget(this.vCol).texture;
    m.tMeta.value = this.gpu.getCurrentRenderTarget(this.vMeta).texture;
    m.uPixel.value = pixelScale;
    m.uPulse.value = this.u.uPulse.value;
  }
}
