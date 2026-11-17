/* Shared UI helpers. */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});

  /** Tiny element builder: h('div.cls#id', {attrs}, ...children) */
  function h(sel, attrs, ...kids) {
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement(m[1] || 'div');
    (m[2].match(/[.#][\w-]+/g) || []).forEach((p) => (p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1))));
    if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (k) => { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) k.forEach(add); else el.append(k instanceof Node ? k : document.createTextNode(String(k))); };
    kids.forEach(add);
    return el;
  }

  const RED = new Set(['♥', '♦']);
  function cardEl(card, opts) {
    opts = opts || {};
    if (!card || opts.back) return h('div.pcard.back' + (opts.deal ? '.deal' : ''), { 'aria-label': 'face-down card' });
    const el = h('div.pcard' + (RED.has(card.suit) ? '.red' : '') + (opts.deal ? '.deal' : ''), { 'aria-label': `${card.rank} of ${card.suit}`, role: 'img' },
      h('div.corner', h('span', card.rank), h('span.s', card.suit)),
      h('div.pip', card.suit),
      h('div.corner.br', h('span', card.rank), h('span.s', card.suit)));
    return el;
  }

  /** Break an amount into casino chip colors: $500 purple, $100 black, $25 green, $5 red, $1 white. */
  function chipStack(amount) {
    const denoms = [500, 100, 25, 5, 1];
    const wrap = h('div', { style: { position: 'relative', display: 'grid', placeItems: 'center' } });
    let left = Math.round(amount), shown = 0, top = null;
    for (const d of denoms) {
      while (left >= d && shown < 5) { left -= d; shown++; top = d; }
    }
    if (!amount) return wrap;
    wrap.append(h(`div.chip.c${top || 5}`, h('span', amount >= 1000 ? (amount / 1000).toFixed(amount % 1000 ? 1 : 0) + 'k' : String(amount))));
    return wrap;
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms || 2200);
  }

  const CAT_LABEL = {
    surrender: 'Surrender', split: 'Splits', softDouble: 'Soft doubles', hardDouble: 'Hard doubles', softHS: 'Soft hit/stand', hardHS: 'Hard hit/stand',
    insurance: 'Insurance', deviation: 'Count plays', bet: 'Bet sizing', count: 'Count checks', dealerError: 'Dealer errors',
  };
  const TABLE_PAGE = { surrender: 'p.51', split: 'p.52', softDouble: 'pp.53-54', hardDouble: 'p.55', softHS: 'p.56', hardHS: 'p.56', insurance: 'p.50' };
  const TABLE_NAME = { surrender: 'Surrender table', split: 'Split table', softDouble: 'Soft double table', hardDouble: 'Hard double table', softHS: 'Soft hit/stand table', hardHS: 'Hard hit/stand table', insurance: 'Insurance' };

  function handLabel(sit) {
    if (sit.pair) return `Pair of ${sit.pair === 'T' ? '10s' : sit.pair === 'A' ? 'aces' : sit.pair + 's'}`;
    return `${sit.soft ? 'Soft' : 'Hard'} ${sit.total}`;
  }
  /** Stable key for a chart cell, used for the mistake heat map and weak-spot drills. */
  function cellKey(sit, up) {
    if (sit.pair) return `pair:${sit.pair}:${up}`; // any decision on a two-card pair lives in the pair rows
    return `${sit.soft ? 'soft' : 'hard'}:${sit.total}:${up}`;
  }
  function parseCellKey(k) {
    const [kind, v, up] = k.split(':');
    const upN = up === 'T' ? '10' : up;
    if (kind === 'pair') return { kind, v, up, label: `${v === 'T' ? '10' : v},${v === 'T' ? '10' : v} v ${upN}` };
    return { kind, v: Number(v), up, label: `${kind === 'soft' ? 'Soft ' : ''}${v} v ${upN}` };
  }

  function countText(ctx) {
    if (!ctx || ctx.system === 'none') return '';
    const s = (n) => (n > 0 ? '+' + n : String(n));
    return ctx.system === 'reko' ? `REKO RC ${s(ctx.rc)}` : `Hi-Lo RC ${s(ctx.rc)} · TC ${s(ctx.tc)}`;
  }
  const signed = (n) => (n > 0 ? '+' + n : String(n));

  /** Coach verdict card. */
  function verdictEl(o) {
    // o: { ok, you, book, sit, up, d, count, extra, onTakeBack, onRide, info }
    const cls = o.tone || (o.ok ? 'good' : 'bad');
    const name = BJ.ACTION_NAMES;
    const title = o.title || (o.ok ? (o.d && o.d.deviation && o.d.deviation.applied ? 'Correct count play' : 'Correct') : `Book says ${name[o.book]}`);
    const el = h(`div.verdict.${cls}`, { role: 'status' },
      h('div.v-head', h('div.v-mark', cls === 'info' ? 'i' : cls === 'good' ? '✓' : '✕'), h('div', h('div.v-title', title),
        o.sit ? h('div.v-sit', `${handLabel(o.sit)} v dealer ${o.up === 'T' ? '10' : o.up}${o.you && !o.ok ? ` · you chose ${name[o.you]}` : ''}`) : null)));
    if (o.why) el.append(h('div.v-why', o.why, o.d && TABLE_PAGE[o.d.table] ? h('span.cite', ` (${TABLE_NAME[o.d.table]}, ${TABLE_PAGE[o.d.table]})`) : null));
    const dev = o.d && o.d.deviation;
    if (dev && o.count && o.count.system !== 'none') {
      const cv = dev.metric === 'RC' ? o.count.rc : o.count.tc;
      const basic = o.d.basic ? name[o.d.basic] : null;
      const line = dev.system === 'reko'
        ? `REKO: ${dev.label} at RC ≥ +2. RC is ${signed(cv)}, so ${dev.applied ? 'take the variation' : 'play basic strategy'}${basic && dev.applied ? ` (basic: ${basic})` : ''}.`
        : `Hi-Lo index: ${dev.label} at TC ≥ ${signed(dev.at)}. TC is ${signed(cv)}, so ${cv >= dev.at ? 'make the play' : 'do not'}${basic && dev.applied ? ` (basic: ${basic})` : ''}.`;
      el.append(h('div.v-dev', line));
    }
    if (o.extra) el.append(h('div.v-why', o.extra));
    if (o.actions && o.actions.length) el.append(h('div.v-actions', o.actions));
    return el;
  }

  function pct(c, t) { return t ? Math.round((c / t) * 100) : null; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  Object.assign(BJ, { h, cardEl, chipStack, toast, CAT_LABEL, TABLE_PAGE, TABLE_NAME, handLabel, cellKey, parseCellKey, countText, signed, verdictEl, pct, clamp, shuffleArr, pick, sleep });
})(typeof globalThis !== 'undefined' ? globalThis : this);
