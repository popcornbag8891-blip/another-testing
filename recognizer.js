// $1 Unistroke Recognizer — Wobbrock, Wilson & Li (UIST 2007).
// Written from the paper: resample → rotate to indicative angle → scale to a
// reference square → translate to origin → golden-section search over ±45°.
// Every template is also registered reversed, so direction doesn't matter.

const N = 64;
const SQUARE = 250;
const HALF_DIAG = 0.5 * Math.sqrt(2 * SQUARE * SQUARE);
const ANGLE_RANGE = (45 * Math.PI) / 180;
const ANGLE_PRECISION = (2 * Math.PI) / 180;
const PHI = 0.5 * (-1 + Math.sqrt(5));

// ---------------------------------------------------------------- glyphs --
// Canonical glyphs in unit space, y up. These are both the $1 templates and
// the perfect runes the stroke snaps into. `closed` lets the snap pick the
// best starting vertex so the morph travels the shortest distance.
function poly(pts, perSeg = 24) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

function circle(turns = 1) {
  const out = [];
  const n = Math.round(96 * turns);
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / 96) * Math.PI * 2;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

function bolt() {
  // ⚡ — steep stroke down-left, a short jog right, steep stroke down-left.
  return poly([[0.32, 1], [-0.3, 0.06], [0.3, 0.06], [-0.32, -1]]);
}

function triangle() {
  const s = Math.sqrt(3) / 2;
  return poly([[0, 1], [-s, -0.5], [s, -0.5], [0, 1]]);
}

function spiral(turns = 2.5) {
  const out = [];
  const steps = 140;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = 0.06 + 0.94 * t;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

function star() {
  const pts = [];
  for (let k = 0; k <= 5; k++) {
    const a = Math.PI / 2 + k * ((4 * Math.PI) / 5);
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return poly(pts, 20);
}

function wave(periods = 2) {
  const out = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    out.push([-1 + 2 * t, 0.42 * Math.sin(t * periods * Math.PI * 2)]);
  }
  return out;
}

// Rotate then squash: models the shear a hand-drawn shape picks up, which $1's
// rotate-then-scale normalisation can't undo on its own.
function distort(v, deg, sx) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return v.map(([x, y]) => [(x * c - y * s) * sx, x * s + y * c]);
}
const sheared = (v) => [v, ...[-14, 14].flatMap((d) => [distort(v, d, 0.78), distort(v, d, 1.25)])];

// Bolts with a shorter or longer middle jog.
const boltJog = (jog) => poly([[0.32, 1], [-0.3, 0.06], [-0.3 + jog, 0.06], [-0.32, -1]]);

export const GLYPHS = {
  circle: { draw: circle(), closed: true, variants: [circle(), circle(1.12), circle(1.25), circle(0.9)] },
  bolt: { draw: bolt(), closed: false, variants: [bolt(), boltJog(0.35), boltJog(0.85)] },
  triangle: { draw: triangle(), closed: true, variants: sheared(triangle()) },
  spiral: { draw: spiral(2.5), closed: false, variants: [spiral(2), spiral(2.5), spiral(3)] },
  star: { draw: star(), closed: true, variants: sheared(star()) },
  wave: { draw: wave(2), closed: false, variants: [wave(1.5), wave(2), wave(2.5)] },
};

// ------------------------------------------------------------ $1 pipeline --
const toPts = (arr) => arr.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

export function resample(input, n = N) {
  const pts = input.map((p) => ({ x: p.x, y: p.y }));
  const I = pathLength(pts) / (n - 1);
  if (!(I > 0)) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
  let D = 0;
  const out = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (D + d >= I) {
      const t = (I - D) / d;
      const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
      out.push(q);
      pts.splice(i, 0, q); // q becomes the next start point
      D = 0;
    } else D += d;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] }); // rounding shortfall
  out.length = n;
  return out;
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function rotateBy(pts, a) {
  const c = centroid(pts), cos = Math.cos(a), sin = Math.sin(a);
  return pts.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }));
}

function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function scaleTo(pts, size) {
  const b = bbox(pts);
  const w = Math.max(b.w, 1e-6), h = Math.max(b.h, 1e-6);
  return pts.map((p) => ({ x: (p.x * size) / w, y: (p.y * size) / h }));
}

function translateTo(pts) {
  const c = centroid(pts);
  return pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

function normalize(raw) {
  let pts = resample(toPts(raw), N);
  const c = centroid(pts);
  pts = rotateBy(pts, -Math.atan2(c.y - pts[0].y, c.x - pts[0].x));
  return translateTo(scaleTo(pts, SQUARE));
}

function pathDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return d / a.length;
}

const distanceAtAngle = (pts, T, a) => pathDistance(rotateBy(pts, a), T);

function distanceAtBestAngle(pts, T, a, b, eps) {
  let x1 = PHI * a + (1 - PHI) * b, f1 = distanceAtAngle(pts, T, x1);
  let x2 = (1 - PHI) * a + PHI * b, f2 = distanceAtAngle(pts, T, x2);
  while (Math.abs(b - a) > eps) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = PHI * a + (1 - PHI) * b; f1 = distanceAtAngle(pts, T, x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = (1 - PHI) * a + PHI * b; f2 = distanceAtAngle(pts, T, x2); }
  }
  return Math.min(f1, f2);
}

// ---------------------------------------------------------------- public --
// Closed glyphs get extra variants that start part-way around the loop, since
// people begin a triangle or star wherever their hand happens to be.
function cyclicShifts(v, k) {
  const loop = resample(toPts(v), 96 + 1).slice(0, 96);
  const out = [];
  for (let i = 0; i < k; i++) {
    const off = Math.round((i / k) * loop.length);
    const s = loop.slice(off).concat(loop.slice(0, off));
    s.push({ ...s[0] });
    out.push(s);
  }
  return out;
}

const templates = [];
for (const [name, g] of Object.entries(GLYPHS)) {
  const variants = g.closed && name !== 'circle' ? g.variants.flatMap((v) => cyclicShifts(v, 10)) : g.variants;
  for (const v of variants) {
    templates.push({ name, reversed: false, points: normalize(v) });
    templates.push({ name, reversed: true, points: normalize(v.slice().reverse()) });
  }
}

/** Acceptance rule used by the app (current: strict $1 threshold). */
// A clean match casts at 0.80 (the $1 paper's threshold). A messier stroke
// still casts if it clearly beats every other glyph, since air-drawing is wobbly.
export const accept = (r) => r.score >= 0.8 || (r.score >= MIN_LOOSE && r.score - (r.second?.score ?? 0) >= MARGIN);
const MIN_LOOSE = 0.74, MARGIN = 0.08;

/**
 * Remove the short flick a pinch makes as it opens or closes: if the last
 * (or first) ~4% of the stroke turns sharply away from the path, drop it.
 */
export function dehook(input) {
  let pts = toPts(input);
  if (pts.length < 8) return pts;
  const L = pathLength(pts);
  const trimEnd = (arr) => {
    let acc = 0, k = arr.length - 1;
    while (k > 1 && acc < L * 0.04) { acc += Math.hypot(arr[k].x - arr[k - 1].x, arr[k].y - arr[k - 1].y); k--; }
    let acc2 = 0, j = k;
    while (j > 0 && acc2 < L * 0.06) { acc2 += Math.hypot(arr[j].x - arr[j - 1].x, arr[j].y - arr[j - 1].y); j--; }
    const ax = arr[arr.length - 1].x - arr[k].x, ay = arr[arr.length - 1].y - arr[k].y;
    const bx = arr[k].x - arr[j].x, by = arr[k].y - arr[j].y;
    const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
    return cos < -0.3 ? arr.slice(0, k + 1) : arr; // doubled back more than ~107°
  };
  pts = trimEnd(pts);
  pts = trimEnd(pts.reverse()).reverse();
  return pts;
}

/** @returns {{name:string, score:number, reversed:boolean, second:{name:string,score:number}}} */
export function recognize(raw) {
  // Score the stroke as drawn and with pinch hooks trimmed; keep the better match per glyph.
  const raws = toPts(raw), trimmed = dehook(raws);
  const candidates = trimmed.length === raws.length ? [normalize(raws)] : [normalize(raws), normalize(trimmed)];
  const best = new Map();
  for (const pts of candidates) for (const t of templates) {
    const d = distanceAtBestAngle(pts, t.points, -ANGLE_RANGE, ANGLE_RANGE, ANGLE_PRECISION);
    const score = 1 - d / HALF_DIAG;
    const prev = best.get(t.name);
    if (!prev || score > prev.score) best.set(t.name, { name: t.name, score, reversed: t.reversed });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  return { ...ranked[0], second: ranked[1] };
}

/**
 * Fit the canonical glyph onto a user stroke: same centre, matched size, and
 * the start vertex/direction that minimise travel, so the morph reads as the
 * stroke "tightening" rather than sliding around.
 * Both returned arrays have `count` points as flat [x0,y0,x1,y1,...].
 */
export function fitGlyph(name, strokePts, count) {
  const g = GLYPHS[name];
  const user = resample(toPts(strokePts), count);
  const ub = bbox(user);
  const canon = toPts(g.draw);
  const cb = bbox(canon);
  const cw = Math.max(cb.w, 0.2), ch = Math.max(cb.h, 0.2);
  const uw = Math.max(ub.w, 0.02), uh = Math.max(ub.h, 0.02);
  let s = Math.sqrt((uw * uh) / (cw * ch));
  s = Math.min(s, (1.35 * Math.max(uw, uh)) / Math.max(cw, ch));
  const ucx = (ub.minX + ub.maxX) / 2, ucy = (ub.minY + ub.maxY) / 2;
  const ccx = (cb.minX + cb.maxX) / 2, ccy = (cb.minY + cb.maxY) / 2;

  // A closed glyph is resampled without its duplicate end point so cyclic shifts are seamless.
  let base = canon.map((p) => ({ x: (p.x - ccx) * s + ucx, y: (p.y - ccy) * s + ucy }));
  if (g.closed) base = resample(base, count + 1).slice(0, count);
  else base = resample(base, count);

  let bestPts = null, bestD = Infinity;
  for (const dir of [base, base.slice().reverse()]) {
    const shifts = g.closed ? count : 1;
    for (let sh = 0; sh < shifts; sh += g.closed ? 2 : 1) {
      let d = 0;
      for (let i = 0; i < count && d < bestD; i++) {
        const p = dir[(i + sh) % count];
        d += (p.x - user[i].x) ** 2 + (p.y - user[i].y) ** 2;
      }
      if (d < bestD) {
        bestD = d;
        bestPts = [];
        for (let i = 0; i < count; i++) bestPts.push(dir[(i + sh) % count]);
      }
    }
  }
  // Close the loop visually: last point returns to the first.
  if (g.closed) bestPts[count - 1] = { ...bestPts[0] };
  const from = new Float32Array(count * 2), to = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    from[i * 2] = user[i].x; from[i * 2 + 1] = user[i].y;
    to[i * 2] = bestPts[i].x; to[i * 2 + 1] = bestPts[i].y;
  }
  return { from, to, center: { x: ucx, y: ucy }, size: Math.max(cw, ch) * s };
}

/** Canonical glyph placed at (cx, cy) with its larger side = size. Flat Float32Array. */
export function placeGlyph(name, cx, cy, size, count) {
  const g = GLYPHS[name];
  const canon = toPts(g.draw);
  const cb = bbox(canon);
  const s = size / Math.max(cb.w, cb.h);
  const mx = (cb.minX + cb.maxX) / 2, my = (cb.minY + cb.maxY) / 2;
  const pts = resample(canon.map((p) => ({ x: (p.x - mx) * s + cx, y: (p.y - my) * s + cy })), count);
  const out = new Float32Array(count * 2);
  pts.forEach((p, i) => { out[i * 2] = p.x; out[i * 2 + 1] = p.y; });
  return out;
}

export function strokeLength(pts) { return pathLength(toPts(pts)); }
