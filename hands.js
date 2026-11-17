// Hand tracking: MediaPipe HandLandmarker → a filtered wand-tip cursor plus
// pinch / open-palm / fist gestures. Video never leaves the page.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const PINCH_ON = 0.25;   // normalised thumb–index distance that starts a stroke
const PINCH_OFF = 0.35;  // ...and the larger one that ends it (hysteresis)
const LOST_AFTER = 0.18; // s without a hand before the cursor starts fading

// One Euro Filter — Casiez, Roussel & Vogel (CHI 2012).
// Cutoff rises with speed: heavy smoothing when slow, little lag when fast.
class LowPass {
  constructor() { this.y = 0; this.init = false; }
  filter(x, a) {
    this.y = this.init ? a * x + (1 - a) * this.y : x;
    this.init = true;
    return this.y;
  }
}
const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};
export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = new LowPass(); this.dx = new LowPass(); this.tPrev = -1;
  }
  reset() { this.x.init = false; this.dx.init = false; this.tPrev = -1; }
  filter(value, t) {
    const dt = this.tPrev < 0 ? 1 / 30 : Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;
    const raw = this.x.init ? (value - this.x.y) / dt : 0;
    const edx = this.dx.filter(raw, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alpha(cutoff, dt));
  }
}

const dist3 = (a, b, sx, sy) => {
  const dx = (a.x - b.x) * sx, dy = (a.y - b.y) * sy, dz = (a.z - b.z) * sx;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export class Hands {
  constructor() {
    this.video = null;
    this.landmarker = null;
    this.status = 'off'; // off | loading | ready | denied | error
    this.present = false;  // a hand is currently tracked
    this.presence = 0;     // 0..1 eased, for fading the wand tip
    this.x = 0.5; this.y = 0.5; // filtered cursor, screen-normalised (0..1, y down)
    this.pinch = false;
    this.pinchRatio = 1;
    this.openPalm = false;
    this.fist = false;
    this.fresh = false;    // a new detection landed this frame
    this.lastSeen = -1;
    this._lastVideoTime = -1;
    // Tuned in screen-normalised units/sec: steady at drawing speed, no lag on flicks.
    this._fx = new OneEuro(1.4, 7.0, 1.0);
    this._fy = new OneEuro(1.4, 7.0, 1.0);
    this._fistFrames = 0;
    this._palmFrames = 0;
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera-api');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    const video = document.createElement('video');
    video.playsInline = true; video.muted = true; video.autoplay = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    this.video = video;
    return video;
  }

  async loadModel() {
    this.status = 'loading';
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (err) {
      // Some GPUs/drivers can't run the GPU delegate; CPU still holds 30 fps.
      console.warn('[sigil] GPU delegate unavailable, using CPU:', err?.message || err);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    this.status = 'ready';
  }

  /** Call every rendered frame. `aspect` is the viewport width/height. */
  update(now, dt, aspect) {
    this.fresh = false;
    const v = this.video;
    if (this.landmarker && v && v.readyState >= 2 && v.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = v.currentTime;
      const res = this.landmarker.detectForVideo(v, now);
      this._process(res, now / 1000, aspect);
    }
    if (this.present && now / 1000 - this.lastSeen > LOST_AFTER) {
      this.present = false;
      this.pinch = false; this.openPalm = false; this.fist = false;
      this._fx.reset(); this._fy.reset();
    }
    const target = this.present ? 1 : 0;
    this.presence += (target - this.presence) * Math.min(1, dt * (target ? 10 : 3.5));
  }

  _process(res, t, aspect) {
    const hands = res.landmarks;
    if (!hands || hands.length === 0) return;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;

    // With two hands, follow the one nearest the current cursor.
    let lm = hands[0];
    if (hands.length > 1 && this.present) {
      let best = Infinity;
      for (const h of hands) {
        const p = this._map(h[8], vw, vh, aspect);
        const d = (p.x - this.x) ** 2 + (p.y - this.y) ** 2;
        if (d < best) { best = d; lm = h; }
      }
    }

    const palm = dist3(lm[0], lm[9], vw, vh) || 1;
    this.pinchRatio = dist3(lm[4], lm[8], vw, vh) / palm;
    if (this.pinch ? this.pinchRatio > PINCH_OFF : this.pinchRatio < PINCH_ON) this.pinch = !this.pinch;

    // Finger curl: a tip closer to the wrist than its PIP joint is folded.
    let extended = 0, curled = 0;
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
      const dt = dist3(lm[tip], lm[0], vw, vh), dp = dist3(lm[pip], lm[0], vw, vh);
      if (dt > dp * 1.12) extended++;
      if (dt < dp * 0.98) curled++;
    }
    const thumbOut = dist3(lm[4], lm[17], vw, vh) > dist3(lm[3], lm[17], vw, vh) * 1.05;
    this._palmFrames = extended === 4 && thumbOut && this.pinchRatio > 0.55 ? this._palmFrames + 1 : 0;
    this._fistFrames = curled === 4 ? this._fistFrames + 1 : 0;
    this.openPalm = this._palmFrames >= 3;
    this.fist = this._fistFrames >= 3;

    const p = this._map(lm[8], vw, vh, aspect);
    this.x = this._fx.filter(p.x, t);
    this.y = this._fy.filter(p.y, t);
    this.present = true;
    this.lastSeen = t;
    this.fresh = true;
  }

  // Video is shown mirrored with object-fit: cover, so map landmarks the same
  // way and the wand tip sits exactly on the spectral fingertip.
  _map(p, vw, vh, aspect) {
    const va = vw / vh;
    let x = 1 - p.x, y = p.y;
    if (aspect > va) y = 0.5 + (y - 0.5) * (aspect / va);
    else x = 0.5 + (x - 0.5) * (va / aspect);
    _m.x = x; _m.y = y;
    return _m;
  }

  /** UV transform for the cover-fit mirrored video: uv' = uv * scale + offset. */
  coverUV(aspect, out) {
    const va = this.video ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
    if (aspect > va) { out.set(1, va / aspect, 0, (1 - va / aspect) / 2); }
    else { out.set(aspect / va, 1, (1 - aspect / va) / 2, 0); }
    return out;
  }
}
const _m = { x: 0, y: 0 };
