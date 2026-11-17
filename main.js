// Sigil — render loop, input arbitration and the casting state machine.
import * as THREE from 'three';
import { Hands } from './hands.js';
import { recognize, accept, fitGlyph, placeGlyph, strokeLength } from './recognizer.js';
import { SPELLS, comboName } from './spells.js';
import { World } from './fx/world.js';
import { Particles, SHAPE, KIND } from './fx/particles.js';
import { Trail } from './fx/trail.js';
import { Post } from './fx/post.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_STROKE_S = 5;      // air-drawing is slower than mouse drawing
const MIN_STROKE_DIAG = 0.1; // fraction of the screen diagonal
const COMBO_WINDOW = 4;
const PALM_HOLD = 0.6;
const RUNE_N = 128;

// ------------------------------------------------------------------ setup --
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NoToneMapping;
document.body.prepend(renderer.domElement);

const ctx = { reducedMotion, time: 0, hideTip: false };
const overlay = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
const world = new World(renderer, SPELLS, ctx);
const particles = new Particles(renderer, overlay);
if (reducedMotion) particles.scale = 0.5;
const trail = new Trail(overlay, particles, ctx);
const webcam = world.createWebcamLayer(overlay);
const post = new Post(renderer, world, overlay, overlayCam, ctx);
const audio = new AudioEngine();
const hands = new Hands();
const spellByTemplate = Object.fromEntries(SPELLS.map((s) => [s.template, s]));

let W = 1, H = 1, aspect = 1, dpr = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  W = window.innerWidth; H = window.innerHeight; aspect = W / H;
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  overlayCam.left = -aspect; overlayCam.right = aspect; overlayCam.updateProjectionMatrix();
  webcam.scale.set(aspect, 1, 1);
  world.resize(W, H);
  post.resize(W, H, dpr);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ state --
const S = {
  live: false,
  drawing: false,
  source: null,          // 'hand' | 'pointer' | null
  suppress: false,       // after a fist-cancel, wait for the pinch to open
  misfires: 0,
  lastCast: null,        // { spell, time, tint }
  palmT: 0, palmFired: false,
  handLostT: 0,
  tutorial: false,
  ghostIndex: -1,
};
const cursor = { x: 0, y: 0, presence: 0, pinch: false };
const pointer = { x: 0, y: 0, down: false, lastMove: -10, touch: false, inside: false };

const ui = new UI(SPELLS, {
  onBegin: begin,
  onGlyphHover: (spell) => showGhostFor(spell),
  onGlyphLeave: () => { trail.stopGhost(); if (S.tutorial) setTimeout(startTutorialGhost, 450); },
  onGlyphClick: (spell) => castByKey(spell),
});

// ------------------------------------------------------------------ input --
const toOverlay = (px, py, out) => { out.x = (px / W * 2 - 1) * aspect; out.y = 1 - (py / H) * 2; return out; };

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!S.live) return;
  renderer.domElement.setPointerCapture(e.pointerId);
  toOverlay(e.clientX, e.clientY, pointer);
  pointer.down = true; pointer.touch = e.pointerType !== 'mouse'; pointer.lastMove = ctx.time;
  if (!S.drawing) startStroke('pointer');
});
renderer.domElement.addEventListener('pointermove', (e) => {
  toOverlay(e.clientX, e.clientY, pointer);
  pointer.lastMove = ctx.time; pointer.inside = true;
});
const pointerUp = () => {
  if (!pointer.down) return;
  pointer.down = false;
  if (S.drawing && S.source === 'pointer') endStroke();
};
renderer.domElement.addEventListener('pointerup', pointerUp);
renderer.domElement.addEventListener('pointercancel', pointerUp);
renderer.domElement.addEventListener('pointerleave', () => { pointer.inside = false; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (!S.live || e.metaKey || e.ctrlKey || e.altKey) return;
  const spell = SPELLS.find((s) => s.key === e.key);
  if (spell) { castByKey(spell); e.preventDefault(); return; }
  if (e.key === 'g' || e.key === 'G') {
    S.ghostIndex = (S.ghostIndex + 1) % SPELLS.length;
    const sp = SPELLS[S.ghostIndex];
    ui.trace(sp.id);
    showGhostFor(sp);
  } else if (e.key === 'Escape') dispel();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; audio.suspend(); }
  else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); if (S.live) audio.resume(); }
});

// ------------------------------------------------------------------ begin --
async function begin() {
  if (S.live) return;
  S.live = true;
  await audio.init();
  ui.hideStart();
  ui.status('loading', 'opening the camera');
  ui.notice('The camera watches only your hand. Video never leaves this device.');
  if (!ui.tutorialDone) startTutorial();
  try {
    const video = await hands.startCamera();
    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const u = webcam.material.uniforms;
    u.tVideo.value = tex;
    u.uTexel.value.set(1 / video.videoWidth, 1 / video.videoHeight);
    webcam.visible = true;
    ui.status('loading', 'waking the wand');
    await hands.loadModel();
    ui.status('searching', 'raise your hand');
    ui.notice('Raise your hand. Pinch to draw, release to cast.', 5000);
    if (S.tutorial) ui.tutorial(tutorialText());
  } catch (err) {
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    const missing = err?.name === 'NotFoundError' || err?.message === 'no-camera-api' || err?.name === 'OverconstrainedError';
    if (!denied && !missing) console.warn('[sigil] hand tracking unavailable:', err);
    hands.status = denied ? 'denied' : 'error';
    hands.video?.srcObject?.getTracks().forEach((tr) => tr.stop());
    webcam.visible = false;
    ui.status('pointer', 'drawing with pointer');
    ui.notice(denied ? 'No camera. Draw with your mouse or finger instead.' : 'No camera found. Draw with your mouse or finger instead.', 6000);
    if (S.tutorial) ui.tutorial(tutorialText());
  }
}

function tutorialText() {
  return hands.status === 'ready' ? 'Pinch your thumb and finger, and trace the circle.' : 'Press and drag to trace the circle.';
}
function startTutorial() {
  S.tutorial = true;
  ui.tutorial(tutorialText());
  startTutorialGhost();
}
function startTutorialGhost() {
  if (!S.tutorial || S.drawing) return;
  trail.showGhost(placeGlyph('circle', 0, 0.02, 0.62, RUNE_N), { loop: true, duration: 1.8, alpha: 0.16 });
}
function showGhostFor(spell) {
  trail.showGhost(placeGlyph(spell.template, 0, 0.02, 0.7, RUNE_N), { duration: 1.3, color: spell.palette.a, alpha: 0.2 });
}

// ---------------------------------------------------------------- casting --
function startStroke(source) {
  S.drawing = true; S.source = source; S.handLostT = 0;
  if (S.tutorial) trail.stopGhost();
  const p = source === 'pointer' ? pointer : cursor;
  trail.begin(p.x, p.y, ctx.time);
}

function endStroke() {
  if (!S.drawing) return;
  const fromHand = S.source === 'hand';
  S.drawing = false; S.source = null;
  const pts = trail.points();
  // Opening a pinch drags the fingertip; the last two tracked frames are that motion, not the glyph.
  if (fromHand && pts.length > 12) pts.length -= 2;
  const dur = trail.duration;
  const diag = Math.hypot(2 * aspect, 2);
  const len = strokeLength(pts);
  S.lastStroke = { n: pts.length, dur: +dur.toFixed(2), len: +(len / diag).toFixed(3), result: 'junk' };
  if (pts.length < 4 || len < MIN_STROKE_DIAG * diag || dur > MAX_STROKE_S) {
    trail.dissolveQuietly(false);         // junk: ignored, never punished
    if (S.tutorial) setTimeout(startTutorialGhost, 400);
    return;
  }
  const r = recognize(pts);
  Object.assign(S.lastStroke, { result: r.name, score: +r.score.toFixed(3) });
  if (accept(r)) {
    const spell = spellByTemplate[r.name];
    const fit = fitGlyph(spell.template, pts, RUNE_N);
    snapAndCast(spell, fit, false);
  } else misfire(r, pts);
}

function castByKey(spell) {
  if (!S.live) return;
  if (S.drawing) { trail.dissolveQuietly(false); S.drawing = false; S.source = null; }
  const to = placeGlyph(spell.template, 0, 0.02, 0.62, RUNE_N);
  snapAndCast(spell, { from: to, to, center: { x: 0, y: 0.02 }, size: 0.62 }, true);
}

function snapAndCast(spell, fit, reveal) {
  const prev = S.lastCast && ctx.time - S.lastCast.time < COMBO_WINDOW && S.lastCast.spell !== spell ? S.lastCast : null;
  const tint = spell.palette.a.clone();
  if (prev) tint.lerp(prev.tint, 0.4);
  const palette = { a: tint, b: spell.palette.b };
  trail.snap(fit, palette, (c) => {
    audio.chime(spell.chime);
    world.flareSigil(tint);
    post.shock((c.x / aspect + 1) / 2, (c.y + 1) / 2, 1);
    fire(spell, tint, prev);
  }, { reveal });
  S.misfires = 0;
}

function fire(spell, tint, prev) {
  const timers = {};
  const fx = {
    particles, post, audio, reducedMotion, tint,
    get aspect() { return aspect; },
    every(dt, key, period) { timers[key] = (timers[key] || 0) + dt; if (timers[key] < period) return false; timers[key] -= period; return true; },
  };
  spell.sound(audio);
  spell.cast(world, fx);
  const stone = world.stones.find((s) => s.spell === spell);
  if (stone) stone.active = 1.2;
  ui.nameCard(spell.name, prev ? comboName(spell, prev.spell) : '', `#${tint.getHexString(THREE.SRGBColorSpace)}`);
  ui.markCast(spell);
  S.lastCast = { spell, time: ctx.time, tint };
  if (S.tutorial) { S.tutorial = false; ui.completeTutorial(); trail.stopGhost(); }
}

function misfire(r, pts) {
  trail.fizzle();
  audio.misfire();
  S.misfires++;
  if (S.misfires >= 3) {
    S.misfires = 0;
    // Show the glyph it most resembled, where it was drawn.
    const spell = spellByTemplate[r.name];
    const fit = fitGlyph(spell.template, pts, RUNE_N);
    setTimeout(() => {
      trail.showGhost(fit.to, { duration: 1.1, color: spell.palette.a, alpha: 0.24 });
      ui.notice(`Perhaps ${spell.name}?`, 2000);
      ui.trace(spell.id);
    }, 350);
  } else if (S.tutorial) setTimeout(startTutorialGhost, 600);
}

function cancelStroke() {
  if (!S.drawing) return;
  S.drawing = false; S.source = null; S.suppress = true;
  trail.dissolveQuietly(true);
  audio.cancel();
}

function dispel() {
  const any = world.effects.length > 0 || audio.musicOn;
  world.dispelAll();
  for (const sp of SPELLS) sp.dispel(audio);
  audio.dispel();
  const s = particles.spec();
  s.shape = SHAPE.RING; s.ax = cursor.presence > 0.3 ? cursor.x : 0; s.ay = cursor.presence > 0.3 ? cursor.y : 0;
  s.bx = 0.05; s.count = 900; s.radial = 1.4; s.spread = 0.05; s.kind = KIND.MOTE;
  s.r = 0.75; s.g = 0.72; s.b = 0.95; s.life = 1.4; s.size = 0.008; s.drag = 2.4; s.curl = 0.5;
  particles.emit(s);
  ui.notice(any ? 'Dispelled.' : 'The void is already calm.', 1600);
}

// ------------------------------------------------------------- per frame --
// ------------------------------------------------- hand as a pointer --
// The wand tip can hover and pinch-select the grimoire glyphs and the runestones.
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _hits = [];
const hover = { el: null, stone: null };

function handTarget() {
  const px = (cursor.x / aspect + 1) / 2 * W, py = (1 - cursor.y) / 2 * H;
  const el = document.elementFromPoint(px, py)?.closest('#grimoire button');
  if (el) return { el, stone: null };
  _ndc.set(cursor.x / aspect, cursor.y);
  raycaster.setFromCamera(_ndc, world.camera);
  for (const st of world.stones) {
    _hits.length = 0;
    if (raycaster.intersectObject(st.mesh, false, _hits).length) return { el: null, stone: st };
  }
  return null;
}

function setHover(target) {
  const el = target?.el || null, stone = target?.stone || null;
  if (el === hover.el && stone === hover.stone) return;
  if (hover.el) { hover.el.closest('li')?.classList.remove('hand-hover'); hover.el.classList.remove('hand-hover'); }
  if (hover.el || hover.stone) { trail.stopGhost(); if (S.tutorial) setTimeout(startTutorialGhost, 450); }
  hover.el = el; hover.stone = stone;
  const li = el?.closest('li');
  const spell = li ? SPELLS.find((sp) => sp.id === li.dataset.id) : stone?.spell;
  if (el) (li || el).classList.add('hand-hover');
  if (spell) { if (li) ui.trace(spell.id); showGhostFor(spell); }
}

function activate(target) {
  trail.stopGhost();
  if (target.el) target.el.click();            // grimoire glyph → cast, tab → toggle
  else if (target.stone) castByKey(target.stone.spell);
}

function updateInput(dt) {
  const handReady = hands.status === 'ready';
  hands.update(performance.now(), dt, aspect);

  // Which source drives the wand tip: an active pointer stroke, else a visible hand, else the pointer.
  const pointerActive = pointer.down || (!pointer.touch && pointer.inside && ctx.time - pointer.lastMove < 2.5);
  const handDriving = !(S.drawing && S.source === 'pointer') && hands.present;
  if (handDriving) {
    toOverlay(hands.x * W, hands.y * H, cursor);
    cursor.presence = hands.presence;
    cursor.pinch = hands.pinch;
  } else {
    const target = S.live && pointerActive ? 1 : 0;
    if (target || hands.presence < 0.02) {
      cursor.x = pointer.x; cursor.y = pointer.y;
      cursor.presence += (target - cursor.presence) * Math.min(1, dt * (target ? 12 : 3));
    } else {
      // Hand just left: the tip fades out where it was last seen instead of freezing.
      toOverlay(hands.x * W, hands.y * H, cursor);
      cursor.presence = hands.presence;
    }
    cursor.pinch = pointer.down;
  }

  if (!S.live) return;

  if (handReady) ui.status(hands.present ? (hands.pinch ? 'pinch' : 'tracking') : 'searching', hands.present ? 'hand found' : 'raise your hand');

  // Hand stroke lifecycle.
  if (hands.present) {
    S.handLostT = 0;
    if (!hands.pinch) S.suppress = false;
    const target = S.drawing ? null : handTarget();
    setHover(target);
    if (hover.stone) hover.stone.active = Math.max(hover.stone.active, 0.6);
    if (!S.drawing && hands.pinch && !S.suppress && !pointer.down) {
      if (target) { activate(target); S.suppress = true; } // pinch on a sigil selects it; wait for release
      else startStroke('hand');
    }
    else if (S.drawing && S.source === 'hand') {
      if (hands.fist) cancelStroke();
      else if (!hands.pinch) endStroke();
      else if (hands.fresh) trail.add(cursor.x, cursor.y, ctx.time);
    }
    // Open palm held → dispel.
    if (hands.openPalm && !S.drawing) {
      S.palmT += dt;
      if (S.palmT >= PALM_HOLD && !S.palmFired) { S.palmFired = true; dispel(); }
    } else { S.palmT = 0; S.palmFired = false; }
  } else if (hover.el || hover.stone) setHover(null);
  if (!hands.present && S.drawing && S.source === 'hand') {
    S.handLostT += dt;
    if (S.handLostT > 0.25) endStroke(); // hand left the frame: treat as a release
  }

  if (S.drawing && S.source === 'pointer') trail.add(pointer.x, pointer.y, ctx.time);

  // Hum: fades in while pinching; pitch follows the hand's height.
  const humLevel = S.drawing ? 1 : cursor.pinch ? 0.5 : 0;
  audio.setHum(humLevel * cursor.presence, (1 - cursor.y) / 2);
}

// ---------------------------------------------------- adaptive quality --
const Q = { avg: 16.7, step: 0, since: 0, warm: 0 };
function adapt(dtMs) {
  if (dtMs > 250) return; // tab switch / breakpoint, not a real frame
  Q.avg += (dtMs - Q.avg) * 0.04;
  Q.warm += dtMs; Q.since += dtMs;
  if (Q.warm < 4000 || Q.since < 2500 || Q.avg <= 20 || Q.step >= 3) return;
  Q.since = 0;
  // Ladder: lower DPR → halve bloom resolution → halve particle budget. Skip rungs that can't help.
  const rungs = [
    () => { if (dpr <= 1) return false; dpr = Math.max(1, dpr * 0.66); resize(); return true; },
    () => { post.setBloomScale(0.5); return true; },
    () => { particles.setBudget(0.5); return true; },
  ];
  while (Q.step < rungs.length && !rungs[Q.step++]()) { /* next rung */ }
  console.info(`[sigil] adaptive quality step ${Q.step} (avg ${Q.avg.toFixed(1)} ms)`);
}

// -------------------------------------------------------------------- loop --
const _cover = new THREE.Vector4();
let raf = 0, last = performance.now();
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dtMs = now - last; last = now;
  const dt = Math.min(dtMs / 1000, 0.1);
  ctx.time += dt;
  const t = ctx.time;

  updateInput(dt);

  particles.u.uSwirl.value.set(0, 0.05, 0);
  world.pulse = audio.ready ? audio.musicLevel() : 0;
  const bufH = H * dpr;
  world.update(dt, t, bufH / (2 * Math.tan(THREE.MathUtils.degToRad(world.camera.fov / 2))));
  particles.u.uPulse.value = world.pulse * world.state.pulseGain * 0.5;
  ctx.hideTip = !S.live;
  trail.update(dt, t, cursor);
  particles.update(dt * world.state.timeScale, t, bufH / 2);

  if (webcam.visible) {
    const u = webcam.material.uniforms;
    hands.coverUV(aspect, _cover);
    u.uCover.value.copy(_cover);
    u.uTint.value.copy(world.state.ambient);
    u.uOpacity.value += (0.12 - u.uOpacity.value) * Math.min(1, dt * 0.8);
  }

  post.render(dt, t, world.state, world.shakeAmt);
  adapt(dtMs);
}
raf = requestAnimationFrame(frame);

// Debug/test hook (harmless in production): lets automated checks drive the app.
window.__sigil = { S, SPELLS, world, trail, particles, hands, audio, begin, castByKey, dispel, Q,
  stroke(points, source = 'pointer') { // points in overlay units
    S.drawing = true; S.source = source; trail.begin(points[0].x, points[0].y, ctx.time);
    for (const p of points) trail.add(p.x, p.y, ctx.time);
    endStroke();
  } };
