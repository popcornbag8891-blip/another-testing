// Diegetic UI: start screen, grimoire, name card, status dot, quiet notices.
import { GLYPHS } from './recognizer.js';

const $ = (s) => document.querySelector(s);

function glyphPath(name, box = 100, pad = 14) {
  const pts = GLYPHS[name].draw;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const s = (box - pad * 2) / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(box / 2 + (x - cx) * s).toFixed(1)} ${(box / 2 - (y - cy) * s).toFixed(1)}`).join('');
}

const STORE_KEY = 'sigil.v1';
function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function save(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* private mode etc. */ } }

export class UI {
  constructor(spells, handlers) {
    this.spells = spells;
    this.h = handlers;
    this.store = load();
    this.store.cast = this.store.cast || {};

    // Start screen sigil: every glyph layered into one emblem.
    const sig = $('#sigil');
    sig.innerHTML = ['circle', 'star', 'triangle'].map((g, i) =>
      `<path d="${glyphPath(g, 100, [6, 12, 22][i])}" style="--d:${i * 0.5}s" pathLength="1"/>`).join('');

    $('#begin').addEventListener('click', () => this.h.onBegin());

    // Grimoire.
    const list = $('#grimoire ol');
    list.innerHTML = spells.map((s) => `
      <li data-id="${s.id}" style="--c:${s.palette.hexA}" class="${this.store.cast[s.id] ? 'lit' : ''}">
        <button type="button" aria-label="${s.name}, key ${s.key}">
          <svg viewBox="0 0 100 100" aria-hidden="true"><path d="${glyphPath(s.template)}" pathLength="1"/></svg>
          <span class="nm">${s.name}</span><span class="ky">${s.key}</span>
        </button>
      </li>`).join('');
    list.querySelectorAll('li').forEach((li) => {
      const spell = spells.find((s) => s.id === li.dataset.id);
      li.addEventListener('pointerenter', () => { this.trace(spell.id); this.h.onGlyphHover(spell); });
      li.addEventListener('pointerleave', () => this.h.onGlyphLeave(spell));
      li.querySelector('button').addEventListener('click', () => this.h.onGlyphClick(spell));
    });
    $('#grimoire .tab').addEventListener('click', () => this.toggleGrimoire());
    this.grimoireOpen = this.store.grimoire !== false;
    $('#grimoire').classList.toggle('open', this.grimoireOpen);

    this._noticeTimer = 0;
  }

  get tutorialDone() { return !!this.store.tutorialDone; }
  completeTutorial() { this.store.tutorialDone = true; save(this.store); this.tutorial(null); }

  hideStart() { $('#start').classList.add('gone'); document.body.classList.add('live'); }

  toggleGrimoire(force) {
    this.grimoireOpen = force ?? !this.grimoireOpen;
    $('#grimoire').classList.toggle('open', this.grimoireOpen);
    this.store.grimoire = this.grimoireOpen; save(this.store);
  }

  /** Replays the line-drawing animation of a grimoire glyph. */
  trace(id) {
    const li = document.querySelector(`#grimoire li[data-id="${id}"]`);
    if (!li) return;
    li.classList.remove('trace'); void li.offsetWidth; li.classList.add('trace');
  }

  markCast(spell) {
    if (!this.store.cast[spell.id]) { this.store.cast[spell.id] = true; save(this.store); }
    const li = document.querySelector(`#grimoire li[data-id="${spell.id}"]`);
    li?.classList.add('lit');
    li?.classList.remove('flare'); void li?.offsetWidth; li?.classList.add('flare');
  }

  nameCard(name, sub, color) {
    const el = $('#namecard');
    el.querySelector('.n').textContent = name;
    el.querySelector('.s').textContent = sub || '';
    el.style.setProperty('--c', color);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  notice(text, ms = 0) {
    const el = $('#notice');
    clearTimeout(this._noticeTimer);
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text;
    el.classList.add('show');
    if (ms) this._noticeTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  tutorial(text) {
    const el = $('#tutorial');
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text; el.classList.add('show');
  }

  status(kind, label) {
    const el = $('#status');
    if (el.dataset.kind === kind) return;
    el.dataset.kind = kind;
    el.querySelector('.lbl').textContent = label;
  }
}
