// The spell registry. Each entry: { name, template, palette, sound(), cast(world, fx), dispel() }.
// `fx` = { particles, post, audio, aspect, reducedMotion, tint, every(dt, key, period) }.
// A new spell is one more object in this array (≈30 lines) plus a stone appears for it.
import * as THREE from 'three';
import { SHAPE, KIND } from './fx/particles.js';

const pal = (a, b) => ({ a: new THREE.Color(a), b: new THREE.Color(b), hexA: a, hexB: b });
const _p = { x: 0, y: 0 };
const _c = new THREE.Color();

export const SPELLS = [
  {
    id: 'lux', name: 'Lux', template: 'circle', key: '1', chime: 76,
    palette: pal('#ffd27a', '#fffaf0'),
    sound(audio) { audio.lux(); },
    cast(world, fx) {
      return world.addEffect({
        attack: 1.8, hold: 6.5, release: 3,
        targets: { exposure: 1.1, ambient: '#ffcf7a', fog: '#4f3412', sky: '#0f0803', dawn: 1, inner: 1, glyph: 0.6, bloom: 0.2 },
        update: (w, dt) => {
          if (!fx.every(dt, 'lux', 0.05)) return;
          const P = fx.particles, s = P.spec();
          s.shape = SHAPE.RECT; s.ax = -fx.aspect; s.ay = -1.05; s.bx = fx.aspect; s.by = 0.2;
          s.count = 36 * w; s.vy = 0.05; s.spread = 0.03; s.gravity = 0.05; s.kind = KIND.MOTE;
          P.color(s, fx.tint, 0.99); s.life = 3.5; s.size = 0.008; s.curl = 0.7; s.drag = 0.6;
          P.emit(s);
        },
      });
    },
    dispel() {},
  },
  {
    id: 'fulgur', name: 'Fulgur', template: 'bolt', key: '2', chime: 81,
    palette: pal('#7af3ff', '#e8fdff'),
    sound(audio) { audio.fulgur(); },
    cast(world, fx) {
      let next = 0, strikes = 0;
      const strike = () => {
        const i = Math.floor(Math.random() * world.stones.length);
        const hit = world.strike(i, fx.tint);
        world.stones[i].active = 1;
        fx.post.flash(strikes === 0 ? 0.85 : 0.35);
        world.shake(strikes === 0 ? 0.9 : 0.45);
        if (strikes > 0) fx.audio.crack(0.35);
        world.toOverlay(hit, _p);
        const P = fx.particles, s = P.spec();
        s.ax = _p.x; s.ay = _p.y; s.bx = 0.02; s.count = 600; s.radial = 0.9; s.spread = 0.3; s.gravity = -0.6;
        P.color(s, fx.tint, 1.65); s.life = 0.9; s.size = 0.008; s.drag = 2.2; s.curl = 0.6;
        P.emit(s);
        strikes++;
      };
      return world.addEffect({
        attack: 0.25, hold: 5, release: 2.5,
        targets: { ambient: '#58d8ff', fog: '#0c2a40', exposure: 1.05, glyph: 0.45, bloom: 0.2 },
        update: (w, dt, t, self) => {
          next -= dt;
          if (!self.releasing && next <= 0 && strikes < 7) { strike(); next = 0.45 + Math.random() * 0.9; }
        },
      });
    },
    dispel() {},
  },
  {
    id: 'ignis', name: 'Ignis', template: 'triangle', key: '3', chime: 74,
    palette: pal('#ff6a2b', '#ff2d3a'),
    sound(audio) { audio.ignis(); },
    cast(world, fx) {
      world.shake(0.35);
      return world.addEffect({
        attack: 1.0, hold: 6.5, release: 2.8,
        targets: { fire: 1, ambient: '#ff6a2b', fog: '#3e1306', sky: '#100302', exposure: 1.0, glyph: 0.4, bloom: 0.15 },
        update: (w, dt) => {
          if (!fx.every(dt, 'ignis', 0.035)) return;
          const P = fx.particles, s = P.spec();
          s.shape = SHAPE.RECT; s.ax = -fx.aspect; s.ay = -1.08; s.bx = fx.aspect; s.by = -0.85;
          s.count = 55 * w; s.vy = 0.35; s.spread = 0.12; s.gravity = 0.22;
          _c.copy(fx.tint).lerp(SPELLS[2].palette.b, Math.random() * 0.6);
          P.color(s, _c, 1.65); s.life = 2.6; s.size = 0.0075; s.curl = 2.4; s.drag = 0.7;
          P.emit(s);
        },
      });
    },
    dispel() {},
  },
  {
    id: 'vortex', name: 'Vortex', template: 'spiral', key: '4', chime: 71,
    palette: pal('#b07aff', '#e4d2ff'),
    sound(audio) { audio.vortex(); },
    cast(world, fx) {
      const formation = world.rearrange();
      world.stones.forEach((s) => (s.active = 0.8));
      const P = fx.particles, s = P.spec();
      s.shape = SHAPE.RING; s.ax = 0; s.ay = 0.05; s.bx = 0.9; s.count = 2400; s.tangential = 1.4; s.radial = -0.25; s.spread = 0.05;
      P.color(s, fx.tint, 1.32); s.life = 2.4; s.size = 0.009; s.curl = 0.8; s.drag = 0.9;
      P.emit(s);
      return world.addEffect({
        attack: 0.5, hold: 4.5, release: 2.5, tag: formation,
        targets: { swirl: 1, ambient: '#b07aff', fog: '#33195f', glyph: 0.4, bloom: 0.2 },
        update: (w) => { fx.particles.u.uSwirl.value.z += 1.3 * w; },
      });
    },
    dispel() {},
  },
  {
    id: 'astra', name: 'Astra', template: 'star', key: '5', chime: 83,
    palette: pal('#bfe3ff', '#f2f6ff'),
    sound(audio) { audio.astra(); },
    cast(world, fx) {
      const P = fx.particles, s = P.spec();
      s.shape = SHAPE.RECT; s.ax = -fx.aspect; s.ay = 0.2; s.bx = fx.aspect; s.by = 1.0;
      s.count = 1500; s.vy = -0.03; s.spread = 0.02; s.kind = KIND.MOTE;
      P.color(s, fx.tint, 1.21); s.life = 3; s.size = 0.006; s.drag = 0.5; s.curl = 0.3;
      P.emit(s);
      return world.addEffect({
        attack: 2.2, hold: 7.5, release: 3,
        targets: { stars: 1, fogDensity: 0.12, ambient: '#a9d4ff', fog: '#16233d', sky: '#020309', glyph: 0.35, bloom: 0.15 },
      });
    },
    dispel() {},
  },
  {
    id: 'aria', name: 'Aria', template: 'wave', key: '6', chime: 69,
    palette: pal('#4fffc8', '#d6fff2'),
    sound(audio) { if (audio.musicOn) audio.stopMusic(); else audio.startMusic(); },
    cast(world, fx) {
      // Casting again while the music plays fades it out (sound() already stopped it).
      if (!fx.audio.musicOn) { for (const e of world.effects) if (e.tag === 'aria') world.releaseEffect(e); return null; }
      world.addEffect({ attack: 2.5, hold: 8, release: 4, tag: 'aria', targets: { ambient: '#3fe8c0', fog: '#0c3a33', glyph: 0.35, bloom: 0.15 } });
      return world.addEffect({
        attack: 3, sticky: true, tag: 'aria', release: 2.5, targets: { pulseGain: 1 },
        update: (w) => {
          if (!fx.audio.beatTick()) return;
          const P = fx.particles, s = P.spec();
          s.shape = SHAPE.RING; s.ax = 0; s.ay = 0.05; s.bx = 0.12; s.count = 260 * w; s.radial = 0.75; s.spread = 0.04;
          P.color(s, fx.tint, 1.1); s.life = 1.8; s.size = 0.008; s.drag = 1.2; s.curl = 0.5; s.kind = KIND.MOTE;
          P.emit(s);
        },
      });
    },
    dispel(audio) { audio.stopMusic(); },
  },
];

export const COMBOS = {
  'fulgur+ignis': 'Storm Fire', 'astra+lux': 'Twin Dawn', 'aria+vortex': 'Whirling Choir',
  'astra+fulgur': 'Sky Fracture', 'ignis+vortex': 'Fire Cyclone', 'aria+lux': 'Morning Hymn',
  'aria+astra': 'Star Song', 'ignis+lux': 'Solar Flare', 'fulgur+vortex': 'Tempest', 'astra+vortex': 'Galaxy',
};
export const comboName = (a, b) => COMBOS[[a.id, b.id].sort().join('+')] || `${b.name} · ${a.name}`;
