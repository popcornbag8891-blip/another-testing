// World render → overlay render → bloom → final grade (heat haze, chromatic
// aberration, ACES, film grain, vignette, flash). Renderer outputs linear HDR
// into half-float targets; the final pass does tonemapping + sRGB itself.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0.006 }, uGrain: { value: 0.045 }, uVignette: { value: 0.85 }, uFlash: { value: 0 },
    uHeat: { value: 0 }, uExposure: { value: 1 },
    uShockC: { value: new THREE.Vector2(0.5, 0.5) }, uShockT: { value: 1 }, uShockAmp: { value: 0 }, uAspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uCA, uGrain, uVignette, uFlash, uHeat, uExposure, uShockT, uShockAmp, uAspect; uniform vec2 uRes, uShockC;
    varying vec2 vUv;
    float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 uv = vUv;
      if (uHeat > 0.001) {
        float k = uHeat * smoothstep(0.75, 0.0, uv.y);
        vec2 q = uv * vec2(9.0, 16.0) + vec2(0.0, -uTime * 2.2);
        uv += (vec2(vn(q), vn(q + 13.7)) - 0.5) * 0.012 * k;
      }
      // Shockwave: a refracting ring racing out from the rune.
      float ring = 0.0;
      if (uShockAmp > 0.001) {
        vec2 sd = (uv - uShockC) * vec2(uAspect, 1.0);
        float sr = length(sd);
        float rad = uShockT * 1.25;
        ring = exp(-pow((sr - rad) / (0.035 + uShockT * 0.06), 2.0)) * (1.0 - uShockT);
        uv -= (sd / max(sr, 1e-4)) / vec2(uAspect, 1.0) * ring * 0.035 * uShockAmp;
      }
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uCA * (0.4 + r2 * 3.0);
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      col *= 1.0 + ring * uShockAmp * 0.35;
      col = aces(col * uExposure);
      col = toSRGB(col);
      // Grade: gentle S-curve, cool shadows, warm highlights.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
      col += vec3(-0.006, 0.0, 0.016) * (1.0 - luma) + vec3(0.012, 0.004, -0.01) * luma * luma;
      float vig = smoothstep(0.95, 0.18, sqrt(r2) * 1.25);
      col *= mix(1.0, vig, uVignette);
      col += (h21(vUv * uRes + fract(uTime * 37.0) * 91.0) - 0.5) * uGrain;
      col = mix(col, vec3(1.0, 0.99, 0.97), uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, world, overlayScene, overlayCam, opts) {
    this.renderer = renderer;
    this.opts = opts;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.worldPass = new RenderPass(world.scene, world.camera);
    this.overlayPass = new RenderPass(overlayScene, overlayCam);
    this.overlayPass.clear = false;
    this.overlayPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.42, 0.82);
    this.bloomScale = 1;
    const origSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => origSetSize(Math.max(1, Math.round(w * this.bloomScale)), Math.max(1, Math.round(h * this.bloomScale)));
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.overlayPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.flashAmt = 0;
  }

  flash(a) { if (!this.opts.reducedMotion) this.flashAmt = Math.max(this.flashAmt, a); }

  /** Screen-space shockwave from uv (0..1). Softer, never skipped, under reduced motion. */
  shock(u, v, amp = 1) {
    const f = this.final.uniforms;
    f.uShockC.value.set(u, v); f.uShockT.value = 0; f.uShockAmp.value = this.opts.reducedMotion ? amp * 0.25 : amp;
  }

  setBloomScale(s) {
    this.bloomScale = s;
    const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.bloom.setSize(sz.x, sz.y);
  }

  resize(w, h, dpr) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w * dpr, h * dpr);
  }

  render(dt, t, state, shake) {
    const u = this.final.uniforms;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 5);
    u.uTime.value = t;
    u.uFlash.value = this.flashAmt * this.flashAmt;
    u.uExposure.value = state.exposure;
    u.uShockT.value = Math.min(1, u.uShockT.value + dt / 1.1);
    if (u.uShockT.value >= 1) u.uShockAmp.value = 0;
    u.uAspect.value = this.final.uniforms.uRes.value.x / Math.max(1, this.final.uniforms.uRes.value.y);
    u.uHeat.value = this.opts.reducedMotion ? 0 : state.fire;
    u.uCA.value = 0.0045 + shake * 0.012 + this.flashAmt * 0.01;
    this.bloom.strength = 0.7 + state.bloom;
    this.composer.render(dt);
  }
}
