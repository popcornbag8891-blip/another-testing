// Every sound is synthesised: oscillators, filtered noise, FM, and a
// convolution reverb whose impulse response is generated procedurally.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.musicOn = false; }

  init() {
    if (this.ctx) return this.ctx.resume();
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain(); this.dry.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(4.2, 2.6);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 1;
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(verbOut).connect(this.master);

    // White-noise source buffer, shared by every noise voice.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Music bus with an analyser so visuals can follow the beat.
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = 0.7;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.musicBus.connect(this.analyser);
    this.musicBus.connect(this.dry);
    const mSend = ctx.createGain(); mSend.gain.value = 0.7;
    this.musicBus.connect(mSend).connect(this.verbIn);
    this.beatTimes = new Float64Array(16).fill(-1); this.beatHead = 0; this.lastBeat = -1;

    this._initHum();
    this.ready = true;
    return ctx.resume();
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Low-passed noise with an exponential tail and a few early reflections.
        lp += (Math.random() * 2 - 1 - lp) * (0.6 - 0.45 * t);
        d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.08 && Math.random() < 0.002 ? 4 : 1);
      }
    }
    return buf;
  }

  // ----------------------------------------------------------- helpers --
  get now() { return this.ctx.currentTime; }

  _out(node, wet = 0.4, pan = 0) {
    let n = node;
    if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; n.connect(p); n = p; }
    n.connect(this.dry);
    if (wet > 0) { const s = this.ctx.createGain(); s.gain.value = wet; n.connect(s).connect(this.verbIn); }
    return n;
  }

  _env(g, t, a, peak, d, sustain = 0.0001) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }

  _noise(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(t + dur);
    return s;
  }

  _osc(type, f, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(t + dur);
    return o;
  }

  /** FM bell: sine carrier, sine modulator with a fast-decaying index. */
  _bell(f, t, { ratio = 3.5, index = 3, dur = 2.5, gain = 0.2, wet = 0.6, pan = 0 } = {}) {
    const ctx = this.ctx;
    const car = this._osc('sine', f, t, dur + 0.1);
    const mod = this._osc('sine', f * ratio, t, dur + 0.1);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.5);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    this._env(g, t, 0.004, gain, dur);
    car.connect(g);
    this._out(g, wet, pan);
  }

  // --------------------------------------------------------------- hum --
  _initHum() {
    const ctx = this.ctx;
    this.humA = ctx.createOscillator(); this.humA.type = 'sawtooth';
    this.humB = ctx.createOscillator(); this.humB.type = 'sine';
    this.humF = ctx.createBiquadFilter(); this.humF.type = 'lowpass'; this.humF.frequency.value = 420; this.humF.Q.value = 4;
    this.humG = ctx.createGain(); this.humG.gain.value = 0;
    const subG = ctx.createGain(); subG.gain.value = 0.6;
    this.humA.connect(this.humF);
    this.humB.connect(subG).connect(this.humF);
    this.humF.connect(this.humG);
    this._out(this.humG, 0.35);
    this.humA.start(); this.humB.start();
  }

  /** level 0..1; y01 0 = top of screen. Pitch follows the hand. */
  setHum(level, y01) {
    if (!this.ready) return;
    const t = this.now;
    const f = 98 * Math.pow(2, (1 - y01) * 1.2);
    this.humA.frequency.setTargetAtTime(f, t, 0.06);
    this.humB.frequency.setTargetAtTime(f * 0.5 * 1.003, t, 0.06);
    this.humF.frequency.setTargetAtTime(260 + level * 700 + (1 - y01) * 300, t, 0.08);
    this.humG.gain.setTargetAtTime(level * 0.07, t, level > 0.01 ? 0.12 : 0.25);
  }

  // ------------------------------------------------------------ events --
  chime(root = 76) {
    if (!this.ready) return;
    const t = this.now;
    this._bell(mtof(root), t, { ratio: 2.0, index: 2.2, dur: 2.4, gain: 0.22, wet: 0.7, pan: -0.15 });
    this._bell(mtof(root + 7), t + 0.11, { ratio: 2.0, index: 2.0, dur: 2.8, gain: 0.2, wet: 0.8, pan: 0.15 });
    this._bell(mtof(root + 24), t + 0.11, { ratio: 3.5, index: 1, dur: 1.2, gain: 0.04, wet: 0.9 });
  }

  misfire() {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now;
    const n = this._noise(t, 0.7);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(240, t + 0.45);
    const g = ctx.createGain(); this._env(g, t, 0.025, 0.22, 0.5);
    n.connect(f).connect(g); this._out(g, 0.35);
    const o = this._osc('sine', 330, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.4);
    const og = ctx.createGain(); this._env(og, t, 0.02, 0.05, 0.4);
    o.connect(og); this._out(og, 0.3);
  }

  cancel() {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now;
    const n = this._noise(t, 0.3);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain(); this._env(g, t, 0.01, 0.08, 0.22);
    n.connect(f).connect(g); this._out(g, 0.2);
  }

  dispel() {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now;
    const n = this._noise(t, 2);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(320, t + 1.6);
    const g = ctx.createGain(); this._env(g, t, 0.3, 0.16, 1.5);
    n.connect(f).connect(g); this._out(g, 0.7);
    [0, 0.08].forEach((dt, i) => {
      const o = this._osc('triangle', mtof(72 - i * 5), t + dt, 2);
      o.frequency.exponentialRampToValueAtTime(mtof(60 - i * 5), t + 1.6);
      const og = ctx.createGain(); this._env(og, t + dt, 0.2, 0.05, 1.6);
      o.connect(og); this._out(og, 0.8);
    });
  }

  // ------------------------------------------------------------ spells --
  lux() {
    const ctx = this.ctx, t = this.now;
    [60, 64, 67, 72, 76].forEach((m, i) => {
      const s = t + i * 0.13;
      for (const det of [-6, 0, 6]) {
        const o = this._osc(i === 4 ? 'sine' : 'triangle', mtof(m + 12), s, 5);
        o.detune.value = det;
        const trem = this._osc('sine', 5.5 + i * 0.4, s, 5);
        const tg = ctx.createGain(); tg.gain.value = 0.3;
        const g = ctx.createGain(); this._env(g, s, 0.08, 0.045, 4.2);
        const am = ctx.createGain(); am.gain.value = 0.7;
        trem.connect(tg).connect(am.gain);
        o.connect(am).connect(g);
        this._out(g, 1.0, (i - 2) * 0.2);
      }
    });
    const pad = this._osc('sawtooth', mtof(48), t, 6);
    const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.setValueAtTime(200, t); pf.frequency.exponentialRampToValueAtTime(1800, t + 2.5);
    const pg = ctx.createGain(); this._env(pg, t, 1.2, 0.05, 4.5);
    pad.connect(pf).connect(pg); this._out(pg, 0.9);
  }

  crack(gain = 0.5) {
    const ctx = this.ctx, t = this.now;
    const n = this._noise(t, 0.3);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    const g = ctx.createGain(); this._env(g, t, 0.002, gain, 0.16);
    n.connect(f).connect(g); this._out(g, 0.4, (Math.random() - 0.5) * 0.6);
  }

  fulgur() {
    const ctx = this.ctx, t = this.now;
    this.crack(0.9);
    // Rolling thunder: brown-ish low noise with irregular swells.
    const n = this._noise(t, 5);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140; f.Q.value = 0.7;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 260;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    let tt = t + 0.12;
    g.gain.exponentialRampToValueAtTime(0.9, tt + 0.08);
    for (let i = 0; i < 6; i++) {
      tt += 0.25 + Math.random() * 0.45;
      g.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.6, tt);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.8);
    n.connect(f).connect(f2).connect(g); this._out(g, 0.6);
  }

  ignis() {
    const ctx = this.ctx, t = this.now;
    const n = this._noise(t, 2.5);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(120, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.28); f.frequency.exponentialRampToValueAtTime(320, t + 1.8);
    const g = ctx.createGain(); this._env(g, t, 0.12, 0.85, 1.9);
    n.connect(f).connect(g); this._out(g, 0.4);
    const sub = this._osc('sine', 95, t, 1.6);
    sub.frequency.exponentialRampToValueAtTime(38, t + 1.2);
    const sg = ctx.createGain(); this._env(sg, t, 0.05, 0.5, 1.2);
    sub.connect(sg); this._out(sg, 0.1);
    // Crackle grains.
    for (let i = 0; i < 70; i++) {
      const s = t + 0.15 + Math.random() * 4;
      const gn = this._noise(s, 0.03);
      const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1800 + Math.random() * 4000; hf.Q.value = 3;
      const gg = ctx.createGain(); this._env(gg, s, 0.001, 0.05 + Math.random() * 0.18, 0.012 + Math.random() * 0.02);
      gn.connect(hf).connect(gg); this._out(gg, 0.25, (Math.random() - 0.5) * 1.4);
    }
  }

  vortex() {
    const ctx = this.ctx, t = this.now;
    const n = this._noise(t, 2.4);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 9;
    f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(160, t + 1.9);
    const g = ctx.createGain(); this._env(g, t, 0.25, 0.5, 1.9);
    const pan = ctx.createStereoPanner();
    const lfo = this._osc('sine', 1.6, t, 2.4); const lg = ctx.createGain(); lg.gain.value = 0.8;
    lfo.frequency.exponentialRampToValueAtTime(5, t + 1.8);
    lfo.connect(lg).connect(pan.pan);
    n.connect(f).connect(g).connect(pan); this._out(pan, 0.6);
    const o = this._osc('sine', 700, t, 2.2);
    o.frequency.exponentialRampToValueAtTime(70, t + 2);
    const og = ctx.createGain(); this._env(og, t, 0.1, 0.1, 2);
    o.connect(og); this._out(og, 0.5);
  }

  astra() {
    const t = this.now;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    const seq = [0, 2, 4, 5, 7, 9, 8, 6, 4];
    seq.forEach((k, i) => {
      this._bell(mtof(79 + scale[k]), t + i * 0.14, { ratio: 3.51, index: 1.6, dur: 2.6, gain: 0.09, wet: 1.0, pan: Math.sin(i) * 0.6 });
    });
    this._bell(mtof(55), t, { ratio: 1.41, index: 1.5, dur: 4, gain: 0.08, wet: 1.0 });
  }

  // -------------------------------------------------------------- music --
  startMusic() {
    if (this.musicOn || !this.ready) return;
    this.musicOn = true;
    const t = this.now;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(Math.max(this.musicBus.gain.value, 0.0001), t);
    this.musicBus.gain.linearRampToValueAtTime(0.9, t + 3);
    this.bpm = 76;
    this.step = 0;
    this.nextNote = t + 0.1;
    // A minor pentatonic, four chords of two bars each.
    this.chords = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]];
    this.pent = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79];
    this._sched = setInterval(() => this._schedule(), 40);
  }

  stopMusic() {
    if (!this.musicOn) return;
    this.musicOn = false;
    const t = this.now;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0, t + 2.5);
    const id = this._sched;
    setTimeout(() => { if (!this.musicOn) clearInterval(id); }, 2600);
  }

  _schedule() {
    if (!this.musicOn) return;
    const spb = 60 / this.bpm / 2; // eighth notes
    while (this.nextNote < this.now + 0.25) {
      const t = this.nextNote, s = this.step;
      const bar = Math.floor(s / 8), chord = this.chords[Math.floor(bar / 2) % 4];
      if (s % 16 === 0) this._pad(chord, t, spb * 16);
      if (s % 4 === 0) this._pulse(t, s % 8 === 0 ? 1 : 0.55);
      // Pluck arpeggio: walk the pentatonic, biased to chord tones.
      const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
      if (Math.random() < 0.82) {
        let m = chord[1 + (pattern[s % 8] % 4)] + 12;
        if (Math.random() < 0.3) m = this.pent[Math.floor(Math.random() * this.pent.length)];
        this._pluck(m, t, s % 2 ? 0.05 : 0.08);
      }
      this.step++;
      this.nextNote += spb;
    }
  }

  _pad(chord, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(1300, t + dur * 0.5); f.frequency.linearRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 2); g.gain.setValueAtTime(0.05, t + dur - 1.5); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
    f.connect(g).connect(this.musicBus);
    for (const m of chord.slice(0, 4)) for (const det of [-8, 7]) {
      const o = this._osc('sawtooth', mtof(m), t, dur + 1.6); o.detune.value = det; o.connect(f);
    }
  }

  _pluck(m, t, gain) {
    const ctx = this.ctx;
    const o = this._osc('triangle', mtof(m), t, 1.4);
    const o2 = this._osc('sine', mtof(m) * 2.001, t, 0.6);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3800, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.4);
    const g = ctx.createGain(); this._env(g, t, 0.004, gain, 1.1);
    const g2 = ctx.createGain(); this._env(g2, t, 0.002, gain * 0.25, 0.25);
    const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.8;
    o.connect(f); o2.connect(g2).connect(f);
    f.connect(g).connect(p).connect(this.musicBus);
  }

  _pulse(t, accent) {
    const ctx = this.ctx;
    const o = this._osc('sine', 110, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    const g = ctx.createGain(); this._env(g, t, 0.006, 0.28 * accent, 0.4);
    o.connect(g).connect(this.musicBus);
    this.beatTimes[this.beatHead] = t; this.beatHead = (this.beatHead + 1) % 16;
  }

  /** Smoothed bass energy of the music plus a decaying kick envelope, 0..~1.5. */
  musicLevel() {
    if (!this.ready || this.musicBus.gain.value < 0.01) return 0;
    this.analyser.getByteFrequencyData(this.freq);
    let s = 0;
    for (let i = 1; i < 10; i++) s += this.freq[i];
    const energy = s / (9 * 255);
    let since = 1e9;
    const now = this.now;
    for (let i = 0; i < 16; i++) { const d = now - this.beatTimes[i]; if (d >= 0 && d < since) since = d; }
    return energy * 0.6 + Math.exp(-since * 7) * 0.9 * this.musicBus.gain.value;
  }

  /** True once per new beat (for beat-synced particle bursts). */
  beatTick() {
    if (!this.musicOn) return false;
    const now = this.now;
    let latest = -1;
    for (let i = 0; i < 16; i++) if (this.beatTimes[i] <= now && this.beatTimes[i] > latest) latest = this.beatTimes[i];
    if (latest > this.lastBeat) { this.lastBeat = latest; return true; }
    return false;
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
