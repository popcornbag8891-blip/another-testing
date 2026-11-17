// Synthetic stress test for the $1 recognizer: noisy, rotated, squashed,
// reversed and re-started strokes for every glyph, plus junk scribbles.
// Run: node tools/test-recognizer.mjs
import { GLYPHS, recognize, resample, accept } from '../recognizer.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

function humanize(name, noise) {
  const g = GLYPHS[name];
  let pts = g.draw.map(([x, y]) => ({ x, y }));
  if (g.closed && rnd() < 0.7) { // start somewhere else on the loop
    pts = pts.slice(0, -1);
    const k = Math.floor(rnd() * pts.length);
    pts = pts.slice(k).concat(pts.slice(0, k));
    pts.push({ ...pts[0] });
  }
  if (rnd() < 0.5) pts.reverse();
  const rot = (rnd() - 0.5) * (40 * Math.PI / 180);
  const sx = 0.75 + rnd() * 0.5, sy = 0.75 + rnd() * 0.5, size = 50 + rnd() * 400;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  pts = resample(pts, 30 + Math.floor(rnd() * 60));
  let wx = 0, wy = 0;
  pts = pts.map((p) => {
    wx = wx * 0.7 + gauss() * noise; wy = wy * 0.7 + gauss() * noise; // correlated wobble
    const x = p.x * sx + wx, y = p.y * sy + wy;
    return { x: (x * cos - y * sin) * size, y: (x * sin + y * cos) * size };
  });
  if (rnd() < 0.6) { // pinch-release hook: a short flick in a random direction
    const a = rnd() * Math.PI * 2, l = pts[pts.length - 1], len = size * (0.05 + rnd() * 0.12);
    for (let k = 1; k <= 4; k++) pts.push({ x: l.x + Math.cos(a) * len * k / 4, y: l.y + Math.sin(a) * len * k / 4 });
  }
  if (rnd() < 0.3) { // pinch-onset hook
    const a = rnd() * Math.PI * 2, f = pts[0], len = size * (0.04 + rnd() * 0.08);
    for (let k = 1; k <= 3; k++) pts.unshift({ x: f.x + Math.cos(a) * len * k / 3, y: f.y + Math.sin(a) * len * k / 3 });
  }
  if (g.closed && rnd() < 0.5) { // overshoot past the start
    const extra = Math.floor(pts.length * (0.05 + rnd() * 0.15));
    pts = pts.concat(pts.slice(1, extra));
  }
  if (g.closed) { // humans overshoot or fall short of closing
    const cut = Math.floor((rnd() - 0.5) * pts.length * 0.12);
    if (cut > 0) pts = pts.slice(0, pts.length - cut);
  }
  return pts;
}

const names = Object.keys(GLYPHS);
const TRIALS = 300;
let allOk = true;
for (const noise of [0.04, 0.08, 0.12]) {
  console.log(`\nnoise ${noise}`);
  for (const name of names) {
    let correct = 0, accepted = 0, wrongAccepted = 0; const conf = {};
    for (let i = 0; i < TRIALS; i++) {
      const r = recognize(humanize(name, noise));
      if (r.name === name) { correct++; if (accept(r)) accepted++; }
      else { conf[r.name] = (conf[r.name] || 0) + 1; if (accept(r)) wrongAccepted++; }
    }
    console.log(`  ${name.padEnd(9)} top1 ${(100 * correct / TRIALS).toFixed(1)}%  cast ${(100 * accepted / TRIALS).toFixed(1)}%  wrong-cast ${wrongAccepted}  confusions ${JSON.stringify(conf)}`);
    // Forgiving by design: ≥85% castable, ≤3% wrong casts at realistic (0.08) noise.
    if (noise <= 0.08 && (accepted / TRIALS < 0.85 || wrongAccepted > TRIALS * 0.03)) allOk = false;
  }
}

// Junk: straight lines, random walks, L-shapes.
let junkCast = 0; const J = 300;
for (let i = 0; i < J; i++) {
  let pts = [];
  const kind = i % 3;
  if (kind === 0) for (let k = 0; k < 40; k++) pts.push({ x: k * 5 + gauss(), y: k * 2 + gauss() });
  else if (kind === 1) { let x = 0, y = 0; for (let k = 0; k < 60; k++) { x += gauss() * 10; y += gauss() * 10; pts.push({ x, y }); } }
  else { for (let k = 0; k < 20; k++) pts.push({ x: 0, y: k * 10 }); for (let k = 0; k < 20; k++) pts.push({ x: k * 10, y: 190 }); }
  if (accept(recognize(pts))) junkCast++;
}
console.log(`\njunk strokes that would cast: ${junkCast}/${J}`);
if (junkCast > J * 0.05) allOk = false; // ≤5% of scribbles may cast something
console.log(allOk ? 'PASS' : 'FAIL');
process.exit(allOk ? 0 : 1);
