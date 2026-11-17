/* Settings and progress, kept in this browser's localStorage (with export/import). */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});
  const KEY_SETTINGS = 'edc.settings.v1';
  const KEY_STATS = 'edc.stats.v1';

  const DEFAULT_SETTINGS = {
    rules: { decks: 8, s17: true, das: true, ls: true, rsa: true, maxHands: 4, pen: 6.5 },
    system: 'reko',          // none | reko | hilo
    tenSplits: false,        // Hi-Lo: include the two ten-split indexes
    hiloRamp: { counts: [1, 2, 3, 4, 5, 6], units: [1, 2, 4, 6, 8, 12] },
    unit: 5,                 // dollars per unit; REKO's book ramp is written in $5 units
    mistakes: 'takeback',    // takeback | ride
    showCount: false,        // live count overlay on the table
    countChecks: 'shoe',     // off | shoe | often
    bots: 2,                 // other players at the table, who play basic strategy
    speed: 'normal',         // slow | normal | fast
    dealerErrors: false,
    gradeBets: true,
  };

  function load(key, fallback) {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; }
  }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable: keep going in memory */ } }

  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(over || {})) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') out[k] = merge(base[k], over[k]);
      else if (over[k] !== undefined) out[k] = over[k];
    }
    return out;
  }

  const settings = merge(DEFAULT_SETTINGS, load(KEY_SETTINGS, {}));
  settings.rules.decks = 8; // this trainer is built for eight decks

  function freshStats() {
    return { since: Date.now(), cats: {}, cells: {}, sessions: [], drills: {}, recent: [] };
  }
  let stats = merge(freshStats(), load(KEY_STATS, {}));

  const listeners = new Set();
  const Store = {
    settings,
    get stats() { return stats; },
    saveSettings() { save(KEY_SETTINGS, settings); listeners.forEach((f) => f('settings')); },
    saveStats() { save(KEY_STATS, stats); },
    on(f) { listeners.add(f); },
    /** Record one graded decision. cat: surrender|split|softDouble|hardDouble|softHS|hardHS|insurance|bet|count|dealerError|deviation */
    record(cat, ok, cellKey, meta) {
      const c = (stats.cats[cat] = stats.cats[cat] || { c: 0, t: 0 });
      c.t++; if (ok) c.c++;
      if (cellKey) {
        const k = (stats.cells[cellKey] = stats.cells[cellKey] || { c: 0, t: 0, last: 0 });
        k.t++; if (ok) k.c++; k.last = Date.now();
      }
      stats.recent.push({ t: Date.now(), cat, ok, cell: cellKey || null, ...(meta || {}) });
      if (stats.recent.length > 400) stats.recent.splice(0, stats.recent.length - 400);
      Store.saveStats();
    },
    recordDrill(name, result) {
      (stats.drills[name] = stats.drills[name] || []).push(Object.assign({ t: Date.now() }, result));
      if (stats.drills[name].length > 60) stats.drills[name].shift();
      Store.saveStats();
    },
    recordSession(s) {
      const i = s.id ? stats.sessions.findIndex((x) => x.id === s.id) : -1;
      if (i >= 0) { stats.sessions[i] = Object.assign(stats.sessions[i], s, { t: Date.now() }); Store.saveStats(); return; }
      stats.sessions.push(Object.assign({ t: Date.now() }, s));
      if (stats.sessions.length > 120) stats.sessions.shift();
      Store.saveStats();
    },
    resetStats() { stats = freshStats(); Store.saveStats(); },
    exportJSON() { return JSON.stringify({ app: 'eight-deck-coach', v: 1, settings, stats }, null, 0); },
    importJSON(text) {
      const o = JSON.parse(text);
      if (!o || o.app !== 'eight-deck-coach') throw new Error('That text is not an Eight-Deck Coach export.');
      stats = merge(freshStats(), o.stats || {});
      Object.assign(settings, merge(DEFAULT_SETTINGS, o.settings || {}));
      Store.saveStats(); Store.saveSettings();
    },
  };

  BJ.Store = Store;
  BJ.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
