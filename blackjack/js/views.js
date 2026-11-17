/* Chart, Game Scout, Progress and Playbook views. */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});
  const { h, Store, COLS } = BJ;
  const S = () => Store.settings;
  const K = (k) => BJ.makeCard(k === 'T' ? '10' : k);
  const HARD_HAND = { 8: ['5', '3'], 9: ['5', '4'], 10: ['6', '4'], 11: ['6', '5'], 12: ['T', '2'], 13: ['T', '3'], 14: ['T', '4'], 15: ['T', '5'], 16: ['T', '6'], 17: ['T', '7'] };
  const CODE_TEXT = { H: 'Hit', S: 'Stand', Dh: 'Double, else hit', Ds: 'Double, else stand', P: 'Split', Rh: 'Surrender, else hit', Rs: 'Surrender, else stand', Rp: 'Surrender, else split' };

  // =============================================================== CHART
  const chartState = { overlay: null, misses: true };
  function deviationMap(system) {
    const R = S().rules;
    const map = {};
    if (system === 'reko') {
      BJ.REKO_VARIATIONS.forEach((v) => {
        if (v.kind === 'sur' && !R.ls) return;
        const key = v.pair ? `pair:${v.pair}:${v.up}` : v.soft ? `soft:${v.soft}:${v.up}` : `hard:${v.total}:${v.up}`;
        map[key] = { text: '+2', title: `REKO: ${v.kind === 'sur' ? 'surrender' : v.kind === 'dbl' ? 'double' : 'stand'} at RC +2 or higher` };
      });
    } else if (system === 'hilo') {
      BJ.HILO_INDEXES.forEach((v) => {
        if (v.kind === 'sur' && !R.ls) return;
        if (v.tenSplit && !S().tenSplits) return;
        const at = !R.s17 && 'h17' in v ? v.h17 : v.at;
        if (at === null) return;
        const key = v.pair ? `pair:${v.pair}:${v.up}` : `hard:${v.total}:${v.up}`;
        const prev = map[key];
        const text = BJ.signed(at);
        map[key] = { text: prev ? `${prev.text}/${text}` : text, title: `${prev ? prev.title + ' · ' : ''}Hi-Lo: ${v.label} at TC ${text} or higher` };
      });
    }
    return map;
  }
  function chartTable(title, rows, devs, rowsLabel) {
    const R = S().rules;
    const cells = Store.stats.cells;
    const tbl = h('table.stbl', h('thead', h('tr', h('th', { scope: 'col' }, rowsLabel), COLS.map((c) => h('th', { scope: 'col' }, BJ.upName(c))))));
    const tb = h('tbody');
    rows.forEach(([label, keys, kind, v]) => {
      const tr = h('tr', h('th.rowh', { scope: 'row' }, label));
      COLS.forEach((up) => {
        const { code } = BJ.chartCell(keys.map(K), up, R, null);
        const key = kind === 'pair' ? `pair:${v}:${up}` : `${kind}:${v}:${up}`;
        const st = cells[key];
        const miss = chartState.misses && st && st.t ? (st.t - st.c) / st.t : 0;
        const dev = devs[key];
        const td = h(`td.${code}${miss ? '.miss' : ''}${dev ? '.has-ix' : ''}`, { title: `${label} v ${BJ.upName(up)}: ${CODE_TEXT[code]}${dev ? ' · ' + dev.title : ''}${st && st.t ? ` · you: ${st.c}/${st.t}` : ''}`, style: miss ? { '--miss': Math.min(1, 0.35 + miss) } : null },
          code, dev ? h('span.ix', dev.text) : null);
        tr.append(td);
      });
      tb.append(tr);
    });
    tbl.append(tb);
    return h('div.panel', h('div.panel-title', h('h3', title)), h('div.stbl-wrap', tbl));
  }
  function renderChart(el) {
    const R = S().rules;
    if (chartState.overlay === null) chartState.overlay = S().system;
    const devs = deviationMap(chartState.overlay);
    el.innerHTML = '';
    const seg = h('div.seg', [['none', 'Basic'], ['reko', 'REKO +2'], ['hilo', 'Hi-Lo indexes']].map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(chartState.overlay === k), on: { click: () => { chartState.overlay = k; renderChart(el); } } }, l)));
    const missBtn = h('label.check', h('input#chart-miss', { type: 'checkbox', checked: chartState.misses ? true : null, on: { change: (e) => { chartState.misses = e.target.checked; renderChart(el); } } }), h('span', 'Circle my misses'));
    el.append(h('div.view-head',
      h('div', h('div.eyebrow', `8 decks · ${R.s17 ? 'S17' : 'H17'} · ${R.das ? 'DAS' : 'no DAS'} · ${R.ls ? 'late surrender' : 'no surrender'}`), h('h2', 'Strategy chart')),
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } }, seg, missBtn)));
    el.append(h('div.order', { style: { marginBottom: '16px' } },
      [['Insurance', 'Basic: never. Counters: REKO RC ≥ +2, Hi-Lo TC ≥ +3.'], ['Surrender', 'First decision, two cards only.'], ['Split', 'Pairs. Not split? Play the total.'], ['Double', 'Two cards. Not allowed? Use the fallback.'], ['Hit / Stand', 'Everything else.']]
        .map(([t, s], i) => h('div', h('b', `${i + 1}. ${t}`), s))));
    const hardRows = [17, 16, 15, 14, 13, 12, 11, 10, 9, 8].map((t) => [t === 17 ? '17+' : String(t), HARD_HAND[t], 'hard', t]);
    const softRows = [9, 8, 7, 6, 5, 4, 3, 2].map((x) => [`A,${x}`, ['A', String(x)], 'soft', 11 + x]);
    const pairRows = ['A', 'T', '9', '8', '7', '6', '5', '4', '3', '2'].map((p) => [`${BJ.upName(p)},${BJ.upName(p)}`, [p, p], 'pair', p]);
    el.append(h('div.chart-grid', chartTable('Hard totals', hardRows, devs, 'You'), h('div', { style: { display: 'grid', gap: '18px' } }, chartTable('Soft totals', softRows, devs, 'You'), chartTable('Pairs', pairRows, devs, 'You'))));
    el.append(h('div.panel', { style: { marginTop: '18px', display: 'grid', gap: '10px' } },
      h('div.legend', Object.entries(CODE_TEXT).map(([c, t]) => h('span', h('i', { class: c, style: { background: `var(--a-${c[0].toLowerCase()})`, color: `var(--a-${c[0].toLowerCase()}-ink)` } }, c), t))),
      h('p.muted', { style: { fontSize: '13.5px' } }, 'Hard 5 to 7 always hit; hard 18 and up always stand. ',
        chartState.overlay === 'reko' ? 'Badges mark the REKO variations: make the play at a running count of +2 or higher (p.73). Eight decks drop the 12 v 4 variation (p.74). Insure at +2.' :
        chartState.overlay === 'hilo' ? 'Badges show Hi-Lo true-count indexes (Sweet 16 + Fab 4): make the play at that true count or higher. Insure at +3.' :
        'Every cell comes from the same engine that grades you, checked against the book\'s tables (pp.51-56).'),
      h('p.cite', 'Book penalties for using the wrong table: H17 surrender ignored, .005%; DAS vs no-DAS split tables swapped, .013-.017%; H17 hard double 11 v A skipped, about .005% (pp.51-55).')));
  }

  // =============================================================== SCOUT
  const RULESETS = ['S17', 'S17 RSA', 'S17 LS', 'S17 LS RSA', 'S17 DAS LS RSA', 'H17', 'H17 RSA', 'H17 LS', 'H17 LS RSA'];
  const RISKS = [['r20', '20% risk, $5K bankroll', 4, 5], ['r2', '2% risk, $10K bankroll', 6, 7], ['r025', '0.25% risk, $100K bankroll', 8, 9]];
  const scoutState = { rules: null, spread: 16, risk: 'r2' };
  function closestRuleset() {
    const R = S().rules;
    const want = [R.s17 ? 'S17' : 'H17', R.das ? 'DAS' : '', R.ls ? 'LS' : '', R.rsa ? 'RSA' : ''].filter(Boolean);
    let best = RULESETS[0], bs = -1;
    RULESETS.forEach((rs) => {
      const parts = rs.split(' ');
      let sc = 0;
      ['S17', 'H17', 'DAS', 'LS', 'RSA'].forEach((p) => { if (parts.includes(p) === want.includes(p)) sc += p === 'S17' || p === 'H17' ? 3 : p === 'LS' ? 2 : 1; });
      if (sc > bs) { bs = sc; best = rs; }
    });
    return { best, exact: best === want.join(' ') };
  }
  function renderScout(el) {
    const T8 = BJ.TABLES8.tables;
    const match = closestRuleset();
    if (!scoutState.rules) scoutState.rules = match.best;
    const risk = RISKS.find((r) => r[0] === scoutState.risk);
    const bySys = {};
    T8.filter((t) => t.rules === scoutState.rules).forEach((t) => (bySys[t.system] = t.rows.filter((r) => r[2] === scoutState.spread)));
    const systems = ['REKO', 'FELT', 'Hi-Lo'];
    const userPen = S().rules.pen;
    el.innerHTML = '';
    el.append(h('div.view-head', h('div', h('div.eyebrow', 'Modern Blackjack · Eight-Deck tables'), h('h2', 'Game Scout')),
      h('p', 'Rate an eight-deck game before you sit down. SCORE is the win per 100 hands for a $10,000 bankroll at a fixed risk, so it folds rules, penetration, spread and risk into one number. Twenty is twice as good as ten.')));
    const rsSel = h('select.input#scout-rules', { on: { change: (e) => { scoutState.rules = e.target.value; renderScout(el); } } }, RULESETS.map((r) => h('option', { value: r, selected: r === scoutState.rules ? true : null }, r.replace('LS', 'late surrender'))));
    const spSeg = h('div.seg', [12, 16, 20].map((s) => h('button', { type: 'button', 'aria-pressed': String(scoutState.spread === s), on: { click: () => { scoutState.spread = s; renderScout(el); } } }, `1:${s}`)));
    const rkSel = h('select.input#scout-risk', { on: { change: (e) => { scoutState.risk = e.target.value; renderScout(el); } } }, RISKS.map(([k, l]) => h('option', { value: k, selected: k === scoutState.risk ? true : null }, l)));
    el.append(h('div.scout-ctl',
      h('div.field', h('label', { for: 'scout-rules' }, 'Rules'), rsSel),
      h('div.field', h('span.label', 'Bet spread'), spSeg),
      h('div.field', h('label', { for: 'scout-risk' }, 'Bankroll and risk'), rkSel)));
    if (!match.exact && scoutState.rules === match.best) el.append(h('p.callout', { style: { marginBottom: '14px' } }, `The book publishes nine common 8-deck rule sets. Closest to your table settings: ${match.best}. Tables without "DAS" are no double after split.`));

    const table = h('table.dtable', h('thead',
      h('tr', h('th', { rowspan: 2 }, 'Penetration'), systems.map((s) => h('th', { colspan: 3, style: { textAlign: 'center' } }, s))),
      h('tr', systems.flatMap(() => [h('th', 'SCORE'), h('th', 'Edge'), h('th', 'Unit · win/100')]))));
    const tb = h('tbody');
    const pens = bySys.REKO.map((r) => r[1]);
    const closestPen = pens.reduce((a, b) => (Math.abs(b - userPen) < Math.abs(a - userPen) ? b : a), pens[0]);
    pens.forEach((pen, i) => {
      const tr = h(`tr${pen === closestPen ? '.sel' : ''}`, h('td', `${pen.toFixed(2)} / 8 (${Math.round((pen / 8) * 100)}%)${pen === closestPen ? ' · yours' : ''}`));
      systems.forEach((s) => {
        const r = bySys[s][i];
        tr.append(h('td', h('span.code.' + BJ.codeFor(r[0]), h('i'), r[0].toFixed(1))), h('td', `${r[3].toFixed(2)}%`), h('td', `$${r[risk[2]]} · $${r[risk[3]].toFixed(2)}`));
      });
      tb.append(tr);
    });
    table.append(tb);

    el.append(h('div.scout-grid',
      h('div', h('div.dtable-wrap', table),
        h('p.cite', { style: { marginTop: '8px' } }, `Source: ${BJ.TABLES8.source}. Unit size and win rate assume an optimal betting ramp for each bankroll and risk (pp.282-283).`)),
      h('div.scout-side',
        h('div.panel', h('div.panel-title', h('h3', 'SCORE by penetration'), h('span.cite', `${scoutState.rules} · 1:${scoutState.spread}`)), scoreChart(bySys, systems, closestPen)),
        h('div.panel', { style: { display: 'grid', gap: '8px' } }, h('h3', 'Reading it'),
          h('div.legend', [['red', '0 to 20'], ['amber', '20 to 30'], ['blue', '30 to 50'], ['green', 'over 50']].map(([c, t]) => h('span.code.' + c, h('i'), t))),
          h('p.muted', { style: { fontSize: '13.5px' } }, 'CODE colors are the book\'s game ratings (p.282). Penetration is usually the biggest single variable (p.100): compare a row or two down the table to see what an extra quarter deck is worth.'),
          h('p.muted', { style: { fontSize: '13.5px' } }, 'REKO and Hi-Lo trade places with rules and penetration even though Hi-Lo uses a true count and real indexes. FELT is a level-two count and usually leads (p.283).')))));
  }
  function scoreChart(bySys, systems, mark) {
    const W = 420, H = 230, L = 36, Rr = 58, Tt = 12, B = 30;
    const all = systems.flatMap((s) => bySys[s].map((r) => r[0]));
    const maxY = Math.max(30, Math.ceil(Math.max(...all) / 10) * 10);
    const pens = bySys[systems[0]].map((r) => r[1]);
    const x = (p) => L + ((p - pens[0]) / (pens[pens.length - 1] - pens[0])) * (W - L - Rr);
    const y = (v) => Tt + (1 - v / maxY) * (H - Tt - B);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'svgchart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'SCORE by penetration for REKO, FELT and Hi-Lo');
    const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
    [[0, 20, '--code-red'], [20, 30, '--code-amber'], [30, 50, '--code-blue'], [50, maxY, '--code-green']].forEach(([a, b, c]) => {
      if (a >= maxY) return;
      add('rect', { x: L, y: y(Math.min(b, maxY)), width: W - L - Rr, height: y(a) - y(Math.min(b, maxY)), style: `fill: var(${c}); opacity: .09` });
    });
    for (let v = 0; v <= maxY; v += 10) { add('line', { x1: L, x2: W - Rr, y1: y(v), y2: y(v), class: 'grid' }); add('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, v); }
    pens.forEach((p) => add('text', { x: x(p), y: H - 10, 'text-anchor': 'middle' }, p.toFixed(2)));
    add('line', { x1: x(mark), x2: x(mark), y1: Tt, y2: H - B, style: 'stroke: var(--brass); stroke-dasharray: 3 3; stroke-width: 1.5' });
    const colors = { REKO: 'var(--brass)', FELT: 'var(--info)', 'Hi-Lo': 'var(--good)' };
    const ends = [];
    systems.forEach((s) => {
      const pts = bySys[s].map((r) => `${x(r[1])},${y(r[0])}`).join(' ');
      add('polyline', { points: pts, style: `fill: none; stroke: ${colors[s]}; stroke-width: 2.4; stroke-linejoin: round` });
      const last = bySys[s][bySys[s].length - 1];
      add('circle', { cx: x(last[1]), cy: y(last[0]), r: 3.5, style: `fill: ${colors[s]}` });
      ends.push({ s, y: y(last[0]) });
    });
    ends.sort((a, b) => a.y - b.y).forEach((e, i, arr) => { if (i && e.y - arr[i - 1].y < 13) e.y = arr[i - 1].y + 13; add('text', { x: W - Rr + 8, y: e.y + 4, class: 'lbl', style: `fill: ${colors[e.s]}` }, e.s); });
    return svg;
  }

  // =============================================================== PROGRESS
  function renderProgress(el) {
    const st = Store.stats;
    const cats = st.cats;
    const sum = (keys) => keys.reduce((a, k) => ({ c: a.c + (cats[k] ? cats[k].c : 0), t: a.t + (cats[k] ? cats[k].t : 0) }), { c: 0, t: 0 });
    const play = sum(['surrender', 'split', 'softDouble', 'hardDouble', 'softHS', 'hardHS', 'deviation', 'insurance']);
    const count = sum(['count']);
    const bet = sum(['bet']);
    const sessions = st.sessions.filter((s) => s.decisions >= 1);
    el.innerHTML = '';
    el.append(h('div.view-head', h('div', h('div.eyebrow', `Since ${new Date(st.since).toLocaleDateString()}`), h('h2', 'Progress')),
      h('p', 'Accuracy is the number that matters while you practice. Keep pushing the speed once a table is clean.')));
    const kpi = (k, v, s) => h('div.kpi', h('div.k', k), h('div.v.num', v), h('div.s', s));
    el.append(h('div.kpis',
      kpi('Playing accuracy', play.t ? `${BJ.pct(play.c, play.t)}%` : '—', `${play.c} of ${play.t} decisions`),
      kpi('Count accuracy', count.t ? `${BJ.pct(count.c, count.t)}%` : '—', `${count.t} count checks`),
      kpi('Bet accuracy', bet.t ? `${BJ.pct(bet.c, bet.t)}%` : '—', `${bet.t} bets graded`),
      kpi('Hands played', String(sessions.reduce((a, s) => a + (s.hands || 0), 0)), `${sessions.length} table session${sessions.length === 1 ? '' : 's'}`)));

    const bars = h('div.bars');
    Object.keys(BJ.CAT_LABEL).forEach((k) => {
      const c = cats[k];
      if (!c || !c.t) return;
      const p = BJ.pct(c.c, c.t);
      bars.append(h('div.bar', h('span', BJ.CAT_LABEL[k]), h('div.track', h('i', { class: p >= 95 ? '' : p >= 80 ? 'mid' : 'low', style: { width: `${p}%` } })), h('span.n', `${p}% · ${c.t}`)));
    });
    const weak = Object.entries(st.cells).filter(([, v]) => v.t >= 2 && v.c < v.t).map(([k, v]) => ({ k, v, rate: (v.t - v.c) / v.t }))
      .sort((a, b) => b.rate - a.rate || b.v.t - a.v.t).slice(0, 10);
    const weakEl = weak.length ? h('div.weak', weak.map((w) => h('div.weak-row', h('span', BJ.parseCellKey(w.k).label), h('span.num.muted', `${w.v.t - w.v.c} missed of ${w.v.t}`), h('span.num', { style: { color: 'var(--bad)' } }, `${Math.round(w.rate * 100)}%`))))
      : h('div.empty', 'No repeat misses yet. Cells you miss twice or more show up here.');
    el.append(h('div.two-col',
      h('div.panel', h('div.panel-title', h('h3', 'By table')), bars.childElementCount ? bars : h('div.empty', 'Play some hands or run a drill to fill this in.')),
      h('div.panel', h('div.panel-title', h('h3', 'Weak spots'), h('a.btn.small', { href: '#drills', on: { click: () => setTimeout(() => BJ.Drills.open('flash', { focus: true }), 0) } }, 'Drill them')), weakEl)));

    const recentSessions = sessions.slice(-24);
    const drills = Object.entries(st.drills);
    el.append(h('div.two-col', { style: { marginTop: '18px' } },
      h('div.panel', h('div.panel-title', h('h3', 'Table sessions'), h('span.cite', 'accuracy per session')), recentSessions.length ? sessionChart(recentSessions) : h('div.empty', 'No table sessions yet.')),
      h('div.panel', h('div.panel-title', h('h3', 'Drills')), drills.length ? h('table.dtable', h('thead', h('tr', h('th', 'Drill'), h('th', 'Runs'), h('th', 'Best'), h('th', 'Last'))),
        h('tbody', drills.map(([k, runs]) => h('tr', h('td', { style: { fontFamily: 'var(--f-body)' } }, (BJ.DrillTitles || {})[k] || k), h('td', runs.length), h('td', `${Math.max(...runs.map((r) => r.acc))}%`), h('td', `${runs[runs.length - 1].acc}%`)))))
        : h('div.empty', 'No drills run yet.'))));
    el.append(dataPanel());
  }
  function sessionChart(ss) {
    const W = 420, H = 150, L = 30, B = 20, T = 10;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'svgchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Accuracy per table session');
    const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
    const y = (p) => T + (1 - p / 100) * (H - T - B);
    [50, 75, 100].forEach((v) => { add('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: 'grid' }); add('text', { x: L - 5, y: y(v) + 4, 'text-anchor': 'end' }, v); });
    const bw = (W - L) / ss.length;
    ss.forEach((s, i) => {
      const p = Math.max(0, BJ.pct(s.correct, s.decisions));
      const top = y(Math.max(50, p));
      add('rect', { x: L + i * bw + 2, y: top, width: Math.max(2, bw - 4), height: H - B - top, rx: 2, style: `fill: ${p >= 95 ? 'var(--good)' : p >= 80 ? 'var(--warn)' : 'var(--bad)'}` });
    });
    add('text', { x: L, y: H - 4 }, 'older');
    add('text', { x: W, y: H - 4, 'text-anchor': 'end' }, 'latest');
    return svg;
  }
  function dataPanel() {
    const area = h('textarea.input#data-io', { rows: 3, placeholder: 'Paste an export here to import it', style: { fontFamily: 'var(--f-mono)', fontSize: '12px' } });
    const confirmWrap = h('span');
    const reset = h('button.btn.small.ghost', { type: 'button', on: { click: () => {
      confirmWrap.innerHTML = '';
      confirmWrap.append(h('span', { style: { fontSize: '13px' } }, 'Erase all progress? '), h('button.btn.small', { type: 'button', on: { click: () => { Store.resetStats(); BJ.toast('Progress erased'); BJ.App.show('progress'); } } }, 'Erase'), h('button.btn.small.ghost', { type: 'button', on: { click: () => (confirmWrap.innerHTML = '') } }, 'Keep'));
    } } }, 'Reset progress');
    return h('div.panel', { style: { marginTop: '18px', display: 'grid', gap: '10px' } },
      h('div.panel-title', h('h3', 'Your data'), h('span.cite', 'Stored only in this browser')),
      h('p.muted', { style: { fontSize: '13.5px' } }, 'Progress lives in this browser. Export copies it as text you can paste into another device.'),
      area,
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
        h('button.btn.small', { type: 'button', on: { click: () => { const t = Store.exportJSON(); area.value = t; area.select(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => BJ.toast('Copied to clipboard'), () => BJ.toast('Selected: copy it with your keyboard')); } } }, 'Export'),
        h('button.btn.small', { type: 'button', on: { click: () => { try { Store.importJSON(area.value); BJ.toast('Imported'); BJ.App.applySettings(true); BJ.App.show('progress'); } catch (e) { BJ.toast(e.message || 'Could not read that text'); } } } }, 'Import'),
        reset, confirmWrap));
  }

  // =============================================================== PLAYBOOK
  function renderPlaybook(el) {
    const R = S().rules;
    const reko = BJ.SYSTEMS.reko;
    el.innerHTML = '';
    el.append(h('div.view-head', h('div', h('div.eyebrow', 'The book, condensed'), h('h2', 'Playbook')),
      h('p', 'The rules this trainer grades you on, where they come from, and the order to learn them in. Page numbers refer to Modern Blackjack.')));
    const reRamp = reko.ramp8;
    const hilo = BJ.HILO_INDEXES.filter((v) => (!v.tenSplit || S().tenSplits) && (v.kind !== 'sur' || R.ls) && !(!R.s17 && v.h17 === null));
    el.append(h('div.book',
      h('div.panel', h('h3', 'The training path'),
        h('ul',
          h('li', h('b', 'Basic strategy first. '), 'Study the Chart, then run Strategy flashcards until every table is clean. The book calls this Chapter Zero: it brings the game to almost break-even (p.49).'),
          h('li', h('b', 'Learn REKO. '), 'It is the book\'s own count: one running count, no true-count division, one switch point at +2 (pp.67-77).'),
          h('li', h('b', 'Count drills until it is automatic. '), 'Running count, Table sweep, Deck countdown. Speed matters: casinos are distracting (p.78).'),
          h('li', h('b', 'Bet with the count. '), 'Bet ramp drill, then play the Table with bet grading on.'),
          h('li', h('b', 'Play it all at once. '), 'Table with other players, count checks every shoe, and dealer errors on (pp.64-65, 83).'),
          h('li', h('b', 'Pick games with Game Scout. '), 'Penetration and spread decide what a game is worth.'))),
      h('div.panel', h('h3', 'REKO for eight decks'),
        h('table.ktable', h('tr', h('th', 'Card'), ['2-7', '8, 9', '10, A'].map((c) => h('td', c))), h('tr', h('th', 'Tag'), ['+1', '0', '−1'].map((c) => h('td', c)))),
        h('p', 'Start every shoe at ', h('b', '−27'), ' (the eight-deck Initial Running Count, p.71). One deck nets +4, so the count drifts up as the shoe goes.'),
        h('div.stbl-wrap', h('table.ktable', h('tr', h('th', 'RC'), reRamp.counts.map((c, i) => h('td', i === 0 ? `≤${c}` : i === reRamp.counts.length - 1 ? `≥+${c}` : BJ.signed(c)))), h('tr', h('th', 'Bet'), reRamp.dollars.map((d) => h('td', `$${d}`))))),
        h('p.cite', 'Eight-Deck Betting Ramp, p.72. Scale to your bankroll; the book suggests at least $10,000 for these bets.'),
        h('p', h('b', 'At RC +2 or higher: '), 'insure; surrender 15 v 9, 15 v A, 14 v 10, 8,8 v 10; double 11 v A, 10 v 10, 10 v A, 9 v 2, 9 v 7, 8 v 5, 8 v 6, A,8 v 5, A,8 v 6; stand 16 v 10, 15 v 10, 12 v 2, 12 v 3. Eight decks drop 12 v 4 (pp.73-74).')),
      h('div.panel', h('h3', 'Hi-Lo for eight decks'),
        h('table.ktable', h('tr', h('th', 'Card'), ['2-6', '7-9', '10, A'].map((c) => h('td', c))), h('tr', h('th', 'Tag'), ['+1', '0', '−1'].map((c) => h('td', c)))),
        h('p', 'Start at 0. True count = running count ÷ decks left, truncated. Insure at TC +3. The book\'s Hi-Lo results use the Sweet 16 and Fab 4 indexes (p.282):'),
        h('div.idx-list', hilo.map((v) => { const at = !R.s17 && 'h17' in v ? v.h17 : v.at; return h('span', h('b', BJ.signed(at)), v.label); })),
        h('p.cite', 'Index values: the published Illustrious 18 / Fab 4 (Don Schlesinger, Blackjack Attack), multi-deck. Modern Blackjack names the set but does not print its numbers.')),
      h('div.panel', h('h3', 'Rules on the felt'),
        h('ul',
          h('li', h('b', 'S17 / H17. '), 'Dealer stands or hits on soft 17. H17 adds surrenders against an ace and two soft doubles.'),
          h('li', h('b', 'DAS. '), 'Double after split. Without it, split 2s, 3s, 4s and 6s less often (p.53).'),
          h('li', h('b', 'LS. '), 'Late surrender: give up half the bet on your first two cards, after the dealer checks for blackjack.'),
          h('li', h('b', 'RSA. '), 'Resplit aces. Split aces otherwise get one card each.'),
          h('li', h('b', 'Penetration. '), 'How deep the cut card sits. 6.5 of 8 decks is 81%.'),
          h('li', h('b', '6:5 blackjack. '), 'Counting advantages in the book assume 3:2. At 6:5 the count does not turn the game in your favor the same way (p.70).'))),
      h('div.panel', h('h3', 'Habits the book insists on'),
        h('ul',
          h('li', 'Make decisions in the order you face them: insurance, surrender, split, double, hit/stand (p.50).'),
          h('li', 'Count the first two cards of each hand as a pair so a ten and a six cancel (p.77).'),
          h('li', 'Watch every payout. Dealers make mistakes, and missing them costs edge (p.65).'),
          h('li', 'Practice faster than any casino deals, so you have spare attention at the table (p.60).'),
          h('li', 'Ignore your practice bankroll: accuracy is the score (p.64).'))),
      h('div.panel', h('h3', 'Sources'),
        h('ul', BJ.SOURCES.map((s) => h('li', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.label)))),
        h('p.cite', 'Basic strategy here is checked cell by cell against the book\'s tables (953 automated checks). A 3-million-round simulation of this engine (S17, DAS, LS, RSA, 6.5/8) gave REKO +1.26% on money bet with the book\'s simple 1-20 ramp; the book lists +1.34% for that game with an optimal ramp.'))));
  }

  BJ.Views = { renderChart, renderScout, renderProgress, renderPlaybook };
})(typeof globalThis !== 'undefined' ? globalThis : this);
