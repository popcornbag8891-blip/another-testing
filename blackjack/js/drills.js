/* Drills, modeled on the practice drills the book describes (pp.60-65, 78-83). */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});
  const { h, cardEl, Store, cardFromKey, pick, shuffleArr, sleep } = BJ;
  const S = () => Store.settings;
  const UPS = BJ.COLS;
  const K = (k) => cardFromKey(k);

  // ---------- hand synthesis ----------
  const TENS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T'];
  const val = (k) => (k === 'T' ? 10 : Number(k));
  function hardCombo(total, n) {
    const out = [];
    if (n === 2) { for (let i = 0; i < TENS.length; i++) for (let j = i + 1; j < TENS.length; j++) if (val(TENS[i]) + val(TENS[j]) === total) out.push([TENS[i], TENS[j]]); }
    else { for (let i = 0; i < TENS.length; i++) for (let j = i; j < TENS.length; j++) for (let k = j; k < TENS.length; k++) if (val(TENS[i]) + val(TENS[j]) + val(TENS[k]) === total) out.push([TENS[i], TENS[j], TENS[k]]); }
    return out.length ? shuffleArr(pick(out).slice()) : null;
  }
  function softCombo(total, n) {
    const rest = total - 11;
    if (n === 2) return rest >= 2 && rest <= 9 ? ['A', String(rest)] : null;
    const opts = [];
    for (let a = 2; a <= 9; a++) for (let b = a; b <= 9; b++) if (a + b === rest) opts.push(['A', String(a), String(b)]);
    if (rest >= 3) opts.push(['A', 'A', String(rest - 1)].filter((x) => x !== '10'));
    const ok = opts.filter((o) => o.every((x) => x === 'A' || (Number(x) >= 2 && Number(x) <= 9)));
    return ok.length ? pick(ok) : null;
  }
  function cardsFor(sit) {
    if (sit.kind === 'pair') return [sit.pair, sit.pair];
    if (sit.kind === 'soft') return softCombo(sit.total, sit.n);
    return hardCombo(sit.total, sit.n);
  }

  /** Candidate cells for the strategy flashcards. */
  function strategyCandidates(cats) {
    const R = S().rules;
    const out = [];
    const add = (cat, kind, x, n, ups) => (ups || UPS).forEach((up) => out.push({ cat, kind, total: kind === 'pair' ? null : x, pair: kind === 'pair' ? x : null, n, up }));
    if (cats.surrender && R.ls) { [14, 15, 16, 17].forEach((t) => add('surrender', 'hard', t, 2, ['8', '9', 'T', 'A'])); add('surrender', 'pair', '8', 2, ['9', 'T', 'A']); }
    if (cats.split) ['A', 'T', '9', '8', '7', '6', '5', '4', '3', '2'].forEach((p) => add('split', 'pair', p, 2));
    if (cats.softDouble) [13, 14, 15, 16, 17, 18, 19].forEach((t) => add('softDouble', 'soft', t, 2));
    if (cats.hardDouble) [8, 9, 10, 11].forEach((t) => add('hardDouble', 'hard', t, 2));
    if (cats.softHS) [17, 18, 19].forEach((t) => add('softHS', 'soft', t, 3));
    if (cats.hardHS) [12, 13, 14, 15, 16].forEach((t) => { add('hardHS', 'hard', t, 3); add('hardHS', 'hard', t, 2); });
    return out;
  }
  function keyOfCandidate(c) { return c.kind === 'pair' ? `pair:${c.pair}:${c.up}` : `${c.kind}:${c.total}:${c.up}`; }
  function weightedPick(cands, focus) {
    if (!focus) return pick(cands);
    const cells = Store.stats.cells;
    const w = cands.map((c) => { const s = cells[keyOfCandidate(c)]; return s && s.t ? 1 + 8 * ((s.t - s.c) / s.t) : 1.4; });
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  /** Candidates for count-play flashcards in the current system. */
  function countCandidates() {
    const sys = S().system === 'none' ? 'reko' : S().system;
    const R = S().rules;
    const out = [{ ins: true, sys }];
    if (sys === 'reko') {
      BJ.REKO_VARIATIONS.forEach((v) => {
        if (v.kind === 'sur' && !R.ls) return;
        out.push({ sys, dev: v, kind: v.pair ? 'pair' : v.soft ? 'soft' : 'hard', total: v.soft || v.total, pair: v.pair, up: v.up, n: v.kind === 'hs' ? 3 : 2 });
      });
    } else {
      BJ.HILO_INDEXES.forEach((v) => {
        if (v.kind === 'sur' && !R.ls) return;
        if (v.tenSplit && !S().tenSplits) return;
        if (!R.s17 && v.h17 === null) return;
        out.push({ sys, dev: v, kind: v.pair ? 'pair' : 'hard', total: v.total, pair: v.pair, up: v.up, n: v.kind === 'hs' ? 3 : 2 });
      });
    }
    return out;
  }

  // ---------- drill registry ----------
  const DRILLS = [
    { id: 'flash', title: 'Strategy flashcards', src: 'Book drill: Flashcards, Playing Decisions (p.62)', blurb: 'One hand, one dealer card, your call. Pick the tables to study; weak spots come back more often.', setup: setupFlash, run: runFlash },
    { id: 'index', title: 'Count plays', src: 'Book drill: REKO flashcards with a set count (p.82)', blurb: 'Hands where the count changes the play, shown with a count near the switch point. Insurance included.', setup: setupIndex, run: runIndex },
    { id: 'runcount', title: 'Running count', src: 'Book drill: Running Count, resolution 8 cards (p.80)', blurb: 'Cards flash from a fresh eight-deck shoe. Every few cards you are stopped and asked for the count.', setup: setupRunCount, run: runRunCount },
    { id: 'countdown', title: 'Deck countdown', src: 'Book drill: Physical counting drill (p.78)', blurb: 'Flip a full deck as fast as you can. The last card stays hidden: name its tag from your count.', setup: setupCountdown, run: runCountdown },
    { id: 'sweep', title: 'Table sweep', src: 'Book drill: Full Table, Running Count (p.81)', blurb: 'A whole table of hands flashes up. Count it in one sweep, pairing high and low cards to cancel.', setup: setupSweep, run: runSweep },
    { id: 'truecount', title: 'True count', src: 'Hi-Lo: running count ÷ decks left (p.188)', blurb: 'Read the discard tray, estimate decks left to the half deck, and convert the running count.', setup: setupTrue, run: runTrue },
    { id: 'ramp', title: 'Bet ramp', src: 'REKO 8-deck ramp (p.72) or your Hi-Lo ramp', blurb: 'A count appears. Put out the right bet before the deal, every time.', setup: setupRamp, run: runRamp },
    { id: 'addup', title: 'Add up hands', src: 'Book drill: Add up Hands, 2-5 cards (p.61)', blurb: 'Total two to five cards fast. Type soft hands with an S, like S17.', setup: setupAddup, run: runAddup },
  ];

  let rootEl = null;
  let abort = null;

  function list() {
    stop();
    rootEl.innerHTML = '';
    rootEl.append(h('div.view-head', h('div', h('div.eyebrow', 'Practice drills'), h('h2', 'Drills')),
      h('p', 'Drills are not as much fun as playing, but they exercise one skill at a time, faster than any casino. Push the speed until you have spare attention at a real table.')));
    const grid = h('div.drill-list');
    DRILLS.forEach((d) => {
      const hist = Store.stats.drills[d.id] || [];
      const best = hist.length ? Math.max(...hist.map((x) => x.acc || 0)) : null;
      grid.append(h('button.drill-card', { type: 'button', on: { click: () => open(d.id) } },
        h('h3', d.title), h('p', d.blurb), h('div.src', d.src),
        h('div.best', hist.length ? `Best accuracy ${best}% · ${hist.length} run${hist.length > 1 ? 's' : ''}` : 'Not tried yet')));
    });
    rootEl.append(grid);
  }

  function stop() { if (abort) abort.stopped = true; abort = null; document.onkeydown = null; }

  function open(id, preset) {
    stop();
    const d = DRILLS.find((x) => x.id === id);
    rootEl.innerHTML = '';
    const felt = h('div.drill-felt');
    const side = h('div.panel.drill-setup');
    rootEl.append(h('div.view-head', h('div', h('div.eyebrow', 'Drill'), h('h2', d.title)), h('button.btn', { type: 'button', on: { click: list } }, '← All drills')),
      h('div.drill-stage', felt, side));
    const form = h('form.opts', { on: { submit: (e) => { e.preventDefault(); start(); } } });
    const getOpts = d.setup(form, preset || {});
    form.append(h('button.btn.primary', { type: 'submit' }, 'Start'));
    side.append(h('h3', 'Setup'), h('p.muted', d.blurb), form, h('p.cite', d.src));
    felt.append(h('div.prompt', d.title), h('div.sub', 'Choose your options and press Start.'));
    function start() {
      stop();
      const token = { stopped: false };
      abort = token;
      felt.innerHTML = '';
      d.run(felt, getOpts(), token, (res) => {
        if (token.stopped) return;
        Store.recordDrill(d.id, res);
        felt.innerHTML = '';
        felt.append(h('div.result-big', h('div.eyebrow', { style: { color: 'rgba(243,239,227,.7)' } }, 'Result'), h('div.big', `${res.acc}%`),
          h('div.sub', res.summary || ''), res.misses && res.misses.length ? h('div.sub', 'Missed: ' + res.misses.slice(0, 8).join(' · ')) : null,
          h('div.drill-answers', h('button.btn.primary', { type: 'button', on: { click: start } }, 'Again'), h('button.btn', { type: 'button', on: { click: list } }, 'All drills'))));
      });
    }
  }

  // ---------- small form helpers ----------
  function sel(form, id, label, options, value) {
    const s = h(`select.input#${id}`, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) ? true : null }, t)));
    form.append(h('div.field', h('label', { for: id }, label), s));
    return () => s.value;
  }
  function chk(form, id, label, checked, note) {
    const c = h(`input#${id}`, { type: 'checkbox', checked: checked ? true : null });
    form.append(h('label.check', { for: id }, c, h('span', label, note ? h('small', note) : null)));
    return () => c.checked;
  }
  function answerButtons(answers, onPick) {
    const wrap = h('div.drill-answers');
    answers.forEach(([k, label]) => wrap.append(h('button.btn', { type: 'button', 'data-k': k, on: { click: () => onPick(k) } }, label, h('span.kbd', k))));
    document.onkeydown = (e) => {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const k = e.key.toUpperCase();
      if (answers.some(([a]) => a === k)) { e.preventDefault(); onPick(k); }
    };
    return wrap;
  }
  function progress(i, n) { return h('div.progressbar', h('i', { style: { width: `${(i / n) * 100}%` } })); }
  function numberForm(label, onSubmit, placeholder) {
    const input = h('input.input.num#drill-in', { inputmode: 'text', autocomplete: 'off', 'aria-label': label, placeholder: placeholder || '' });
    const f = h('form.drill-form', { on: { submit: (e) => { e.preventDefault(); if (input.value.trim() !== '') onSubmit(input.value.trim()); } } }, input, h('button.btn.primary', { type: 'submit' }, 'Enter'));
    setTimeout(() => input.focus(), 20);
    return f;
  }
  const finish = (done, right, n, t0, extra) => done(Object.assign({ acc: Math.round((right / n) * 100), n, ms: Math.round((Date.now() - t0) / n) }, extra));

  // ---------- 1. strategy flashcards ----------
  function setupFlash(form) {
    const R = S().rules;
    const g = {};
    form.append(h('div.label', 'Tables, in the order you decide (p.50)'));
    [['surrender', 'Surrender', !R.ls ? 'Late surrender is off in your rules' : null], ['split', 'Splits'], ['softDouble', 'Soft doubles'], ['hardDouble', 'Hard doubles'], ['softHS', 'Soft hit/stand'], ['hardHS', 'Hard hit/stand']]
      .forEach(([k, l, note]) => (g[k] = chk(form, 'fc-' + k, l, k !== 'surrender' || R.ls, note)));
    const len = sel(form, 'fc-len', 'Cards', [[25, '25'], [50, '50'], [100, '100']], 25);
    const focus = chk(form, 'fc-focus', 'Focus on my misses', true, 'Cells you miss come back more often.');
    return () => ({ cats: Object.fromEntries(Object.entries(g).map(([k, f]) => [k, f()])), n: Number(len()), focus: focus() });
  }
  function runFlash(felt, o, token, done) {
    const cands = strategyCandidates(o.cats);
    if (!cands.length) { felt.append(h('div.prompt', 'Pick at least one table')); return; }
    const R = S().rules;
    let i = 0, right = 0; const misses = []; const t0 = Date.now();
    const next = () => {
      if (token.stopped) return;
      if (i >= o.n) return finish(done, right, o.n, t0, { summary: `${right} of ${o.n} right · ${((Date.now() - t0) / o.n / 1000).toFixed(1)}s per card`, misses });
      const c = weightedPick(cands, o.focus);
      const keys = cardsFor(c);
      if (!keys) return next();
      const cards = keys.map(K);
      const d = BJ.decide(cards, c.up, { rules: R });
      felt.innerHTML = '';
      const answers = [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double'], ['P', 'Split']];
      if (R.ls) answers.push(['R', 'Surrender']);
      const shown = Date.now();
      felt.append(progress(i, o.n),
        h('div.row', h('div', h('div.eyebrow', { style: { color: 'rgba(243,239,227,.7)', textAlign: 'center', marginBottom: '6px' } }, 'Dealer'), h('div.cards.flash', cardEl(K(c.up), { deal: true })))),
        h('div.cards.spread.flash', cards.map((x) => cardEl(x, { deal: true }))),
        h('div.sub', `${BJ.handLabel(d.sit)}${cards.length > 2 ? ' (three cards: no double or surrender)' : ''}`),
        answerButtons(answers.filter(([k]) => (k !== 'P' || d.sit.pair) && ((k !== 'D' && k !== 'R') || cards.length === 2)), (k) => {
          document.onkeydown = null;
          const ok = k === d.action;
          i++; if (ok) right++; else misses.push(`${BJ.handLabel(d.sit)} v ${BJ.upName(c.up)} → ${BJ.ACTION_NAMES[d.action]}`);
          Store.record(d.table, ok, BJ.cellKey(d.sit, c.up), { drill: 'flash', ms: Date.now() - shown });
          const v = BJ.verdictEl({ ok, you: k, book: d.action, sit: d.sit, up: c.up, d, why: ok ? null : d.why });
          felt.append(v);
          felt.querySelectorAll('.drill-answers .btn').forEach((b) => (b.disabled = true));
          if (ok) { setTimeout(next, 450); return; }
          felt.append(h('div.drill-answers', h('button.btn.primary', { type: 'button', on: { click: () => { document.onkeydown = null; next(); } } }, 'Next ', h('span.kbd', 'Enter'))));
          document.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.onkeydown = null; next(); } };
        }));
    };
    next();
  }

  // ---------- 2. count plays ----------
  function setupIndex(form) {
    const len = sel(form, 'ix-len', 'Cards', [[20, '20'], [40, '40'], [80, '80']], 20);
    form.append(h('p.muted', { style: { fontSize: '13px' } }, S().system === 'hilo' ? 'Hi-Lo Sweet 16 + Fab 4, true count shown.' : 'REKO variations at RC +2, running count shown. (Pick Hi-Lo in the rules menu to drill its indexes.)'));
    return () => ({ n: Number(len()) });
  }
  function runIndex(felt, o, token, done) {
    const cands = countCandidates();
    const R = S().rules;
    let i = 0, right = 0; const misses = []; const t0 = Date.now();
    const next = () => {
      if (token.stopped) return;
      if (i >= o.n) return finish(done, right, o.n, t0, { summary: `${right} of ${o.n} right`, misses });
      const c = pick(cands);
      let count;
      if (c.sys === 'reko') { const rc = pick([-1, 0, 1, 1, 2, 2, 3, 4]); count = { system: 'reko', rc }; }
      else { const at = c.ins ? BJ.HILO_INSURANCE : (!R.s17 && 'h17' in c.dev ? c.dev.h17 : c.dev.at); const tc = at + pick([-2, -1, -1, 0, 0, 1, 2]); count = { system: 'hilo', tc, rc: tc * 4, tenSplits: S().tenSplits }; }
      const badge = c.sys === 'reko' ? `REKO running count ${BJ.signed(count.rc)}` : `Hi-Lo true count ${BJ.signed(count.tc)}`;
      felt.innerHTML = '';
      felt.append(progress(i, o.n), h('div.badge', badge));
      if (c.ins) {
        const d = BJ.decideInsurance(count);
        felt.append(h('div.cards.flash', cardEl(K('A'), { deal: true })), h('div.prompt', 'Dealer shows an ace. Insurance?'),
          answerButtons([['Y', 'Insure'], ['N', 'No']], (k) => {
            document.onkeydown = null;
            const ok = (k === 'Y') === (d.action === 'I'); i++; if (ok) right++; else misses.push(`Insurance at ${badge.split(' ').slice(-1)[0]}`);
            Store.record('insurance', ok, null, { drill: 'index' });
            felt.append(BJ.verdictEl({ tone: ok ? 'good' : 'bad', title: ok ? 'Correct' : d.action === 'I' ? 'Insure' : 'Do not insure', why: d.why }));
            felt.querySelectorAll('.drill-answers .btn').forEach((b) => (b.disabled = true));
            setTimeout(next, ok ? 500 : 1700);
          }));
        return;
      }
      const keys = cardsFor(c);
      if (!keys) return next();
      const cards = keys.map(K);
      const d = BJ.decide(cards, c.up, { rules: R, count });
      const answers = [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double']];
      if (d.sit.pair) answers.push(['P', 'Split']);
      if (R.ls && cards.length === 2) answers.push(['R', 'Surrender']);
      const lab = (t) => h('div.eyebrow', { style: { color: 'rgba(243,239,227,.7)', textAlign: 'center', marginBottom: '6px' } }, t);
      felt.append(h('div.row', h('div', lab('Dealer'), h('div.cards.flash', cardEl(K(c.up), { deal: true }))), h('div', lab('You'), h('div.cards.spread.flash', cards.map((x) => cardEl(x, { deal: true }))))),
        h('div.sub', `${BJ.handLabel(d.sit)} v ${BJ.upName(c.up)}${cards.length > 2 ? ' · three cards' : ''}`),
        answerButtons(answers, (k) => {
          document.onkeydown = null;
          const ok = k === d.action; i++; if (ok) right++; else misses.push(`${BJ.handLabel(d.sit)} v ${BJ.upName(c.up)} at ${count.system === 'reko' ? 'RC' : 'TC'} ${BJ.signed(count.system === 'reko' ? count.rc : count.tc)} → ${BJ.ACTION_NAMES[d.action]}`);
          Store.record('deviation', ok, BJ.cellKey(d.sit, c.up), { drill: 'index' });
          felt.append(BJ.verdictEl({ ok, you: k, book: d.action, sit: d.sit, up: c.up, d, why: null, count }));
          felt.querySelectorAll('.drill-answers .btn').forEach((b) => (b.disabled = true));
          setTimeout(next, ok ? 600 : 2200);
        }));
    };
    next();
  }

  // ---------- 3. running count ----------
  const tagsOf = (sys) => BJ.SYSTEMS[sys === 'none' ? 'reko' : sys].tags;
  const sysOf = () => (S().system === 'none' ? 'reko' : S().system);
  function setupRunCount(form) {
    const speed = sel(form, 'rc-speed', 'Deal speed', [[1200, 'Slow (under 1 card/s)'], [700, 'Steady'], [420, 'Brisk'], [250, 'Fast'], [150, 'Blur']], 700);
    const per = sel(form, 'rc-per', 'Cards per flash', [[1, '1'], [2, '2'], [3, '3']], 1);
    const every = sel(form, 'rc-every', 'Ask for the count about every', [[8, '8 cards'], [16, '16 cards'], [32, '32 cards']], 8);
    const len = sel(form, 'rc-len', 'Length', [[104, 'Two decks'], [208, 'Four decks'], [338, 'To the cut (6.5 decks)']], 104);
    return () => ({ speed: Number(speed()), per: Number(per()), every: Number(every()), len: Number(len()) });
  }
  async function runRunCount(felt, o, token, done) {
    const sys = sysOf(); const tags = tagsOf(sys);
    const shoe = new BJ.Shoe(8, 7);
    let rc = sys === 'reko' ? BJ.SYSTEMS.reko.irc[8] : 0;
    let dealt = 0, asked = 0, right = 0; const misses = []; const t0 = Date.now();
    const show = h('div.row');
    const status = h('div.sub', `${BJ.SYSTEMS[sys].name}. Start at ${BJ.signed(rc)}.`);
    const bar = h('div.progressbar', h('i', { style: { width: '0%' } }));
    felt.append(bar, h('div.prompt', 'Keep the count'), show, status);
    let nextAsk = o.every + Math.floor(Math.random() * 4) - 1;
    await sleep(900);
    while (dealt < o.len && !token.stopped) {
      const n = Math.min(o.per, o.len - dealt);
      show.innerHTML = '';
      for (let i = 0; i < n; i++) { const c = shoe.draw(); rc += tags[c.key]; dealt++; show.append(h('div.cards.flash', cardEl(c, { deal: true }))); }
      bar.firstChild.style.width = `${(dealt / o.len) * 100}%`;
      await sleep(o.speed);
      if (token.stopped) return;
      if (dealt >= nextAsk || dealt >= o.len) {
        show.innerHTML = '';
        asked++;
        const ans = await new Promise((resolve) => { status.innerHTML = ''; status.append(h('div', `After ${dealt} cards: running count?`), numberForm('Running count', resolve, '±0')); });
        if (token.stopped) return;
        const ok = Number(ans) === rc; if (ok) right++; else misses.push(`card ${dealt}: ${BJ.signed(rc)} (you ${ans})`);
        Store.record('count', ok, null, { drill: 'runcount' });
        status.innerHTML = ''; status.append(h('div', { style: { color: ok ? '#9ff0bf' : '#ffb3ad', fontWeight: 700 } }, ok ? `Right: ${BJ.signed(rc)}` : `It was ${BJ.signed(rc)}. Carry on from ${BJ.signed(rc)}.`));
        nextAsk = dealt + o.every + Math.floor(Math.random() * 5) - 2;
        await sleep(ok ? 700 : 1600);
      }
    }
    if (!token.stopped) done({ acc: Math.round((right / Math.max(1, asked)) * 100), n: asked, ms: Math.round((Date.now() - t0) / dealt), summary: `${right} of ${asked} checkpoints right over ${dealt} cards`, misses });
  }

  // ---------- 4. deck countdown ----------
  function setupCountdown(form) {
    const mode = sel(form, 'cd-mode', 'Flip', [['manual', 'By hand: Space or tap for the next card'], ['900', 'Auto, 0.9s'], ['500', 'Auto, 0.5s'], ['300', 'Auto, 0.3s'], ['180', 'Auto, 0.18s']], 'manual');
    form.append(h('p.muted', { style: { fontSize: '13px' } }, `A full deck nets ${BJ.SYSTEMS[sysOf()].deckSum >= 0 ? '+' : ''}${BJ.SYSTEMS[sysOf()].deckSum} in ${BJ.SYSTEMS[sysOf()].name}, so the last card's tag is that total minus your count after 51 cards.`));
    return () => ({ mode: mode() });
  }
  async function runCountdown(felt, o, token, done) {
    const sys = sysOf(); const tags = tagsOf(sys); const sum = BJ.SYSTEMS[sys].deckSum;
    const deck = shuffleArr(BJ.RANKS.flatMap((r) => BJ.SUITS.map((s) => BJ.makeCard(r, s))));
    const spot = h('div.cards.flash');
    const counter = h('div.sub', 'Card 1 of 51');
    felt.append(h('div.prompt', 'Count down the deck'), spot, counter, h('div.sub', o.mode === 'manual' ? 'Space, Enter or tap the card to flip.' : 'Flipping…'));
    const t0 = Date.now();
    for (let i = 0; i < 51; i++) {
      if (token.stopped) return;
      spot.innerHTML = ''; spot.append(cardEl(deck[i], { deal: true })); counter.textContent = `Card ${i + 1} of 51`;
      if (o.mode === 'manual') {
        await new Promise((res) => {
          const go = (e) => { if (e && e.type === 'keydown' && ![' ', 'Enter', 'ArrowRight'].includes(e.key)) return; if (e) e.preventDefault(); document.onkeydown = null; spot.onclick = null; res(); };
          document.onkeydown = go; spot.onclick = () => go(); spot.style.cursor = 'pointer';
        });
      } else await sleep(Number(o.mode));
    }
    const secs = (Date.now() - t0) / 1000;
    const lastTag = tags[deck[51].key];
    spot.innerHTML = ''; spot.append(cardEl(null, { back: true }));
    counter.textContent = `51 cards in ${secs.toFixed(1)}s. What is the last card's tag?`;
    const answers = [['1', '+1'], ['0', '0'], ['-', '−1']];
    felt.append(answerButtons(answers.map(([k, l]) => [k === '-' ? '-' : k, l]), (k) => {
      document.onkeydown = null;
      const got = k === '1' ? 1 : k === '0' ? 0 : -1;
      const ok = got === lastTag;
      Store.record('count', ok, null, { drill: 'countdown' });
      spot.innerHTML = ''; spot.append(cardEl(deck[51], { deal: true }));
      const rc51 = deck.slice(0, 51).reduce((a, c) => a + tags[c.key], 0);
      felt.append(h('div.sub', `Count after 51 cards: ${BJ.signed(rc51)}. ${BJ.signed(sum)} − (${BJ.signed(rc51)}) = ${BJ.signed(lastTag)}.`));
      setTimeout(() => done({ acc: ok ? 100 : 0, n: 1, ms: Math.round(secs * 1000 / 51), secs: Math.round(secs * 10) / 10, summary: `${ok ? 'Right' : 'Wrong'} · ${secs.toFixed(1)}s for 51 cards. The book's benchmark: count down a deck in 20 seconds (p.78).` }), 1800);
    }));
  }

  // ---------- 5. table sweep ----------
  function setupSweep(form) {
    const hands = sel(form, 'sw-h', 'Hands at the table', [[3, '3'], [5, '5'], [7, '7']], 5);
    const flash = sel(form, 'sw-f', 'Flash time', [[4000, '4 seconds'], [2500, '2.5 seconds'], [1500, '1.5 seconds'], [900, '0.9 seconds']], 2500);
    const full = chk(form, 'sw-full', 'Full hands (2 to 4 cards)', false, 'Off: first two cards of each hand, as at the start of a round.');
    return () => ({ hands: Number(hands()), flash: Number(flash()), full: full(), n: 10 });
  }
  async function runSweep(felt, o, token, done) {
    const sys = sysOf(); const tags = tagsOf(sys);
    const shoe = new BJ.Shoe(8, 7);
    let right = 0; const misses = []; const t0 = Date.now();
    for (let r = 0; r < o.n; r++) {
      if (token.stopped) return;
      felt.innerHTML = '';
      const up = shoe.draw();
      let net = tags[up.key];
      const grid = h('div.table-sweep');
      for (let i = 0; i < o.hands; i++) {
        const n = o.full ? 2 + Math.floor(Math.random() * 3) : 2;
        const cs = Array.from({ length: n }, () => shoe.draw());
        cs.forEach((c) => (net += tags[c.key]));
        grid.append(h('div.cards', cs.map((c) => cardEl(c, { deal: true }))));
      }
      felt.append(progress(r, o.n), h('div.cards.flash', cardEl(up, { deal: true })), grid);
      await sleep(o.flash);
      if (token.stopped) return;
      felt.innerHTML = '';
      const ans = await new Promise((res) => felt.append(progress(r, o.n), h('div.prompt', `Net ${BJ.SYSTEMS[sys].name} count of that table?`), numberForm('Table count', res, '±0')));
      const ok = Number(ans) === net; if (ok) right++; else misses.push(`${BJ.signed(net)} (you ${ans})`);
      Store.record('count', ok, null, { drill: 'sweep' });
      felt.append(h('div.sub', { style: { color: ok ? '#9ff0bf' : '#ffb3ad', fontWeight: 700 } }, ok ? 'Right' : `It was ${BJ.signed(net)}`));
      await sleep(ok ? 600 : 1400);
    }
    finish(done, right, o.n, t0, { summary: `${right} of ${o.n} tables counted exactly`, misses });
  }

  // ---------- 6. true count ----------
  function setupTrue(form) {
    form.append(h('p.muted', { style: { fontSize: '13px' } }, 'Hi-Lo only (REKO is built to skip this step). Decks left is read to the nearest half deck; the true count is truncated toward zero, as in the book\'s simulations.'));
    const len = sel(form, 'tc-len', 'Questions', [[10, '10'], [20, '20']], 10);
    return () => ({ n: Number(len()) });
  }
  async function runTrue(felt, o, token, done) {
    let right = 0; const misses = []; const t0 = Date.now();
    for (let r = 0; r < o.n; r++) {
      if (token.stopped) return;
      const dealtDecks = pick([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5]);
      const left = 8 - dealtDecks;
      const rc = Math.round((Math.random() * 2 - 1) * Math.min(24, 4 + dealtDecks * 3.4));
      const tc = BJ.trueCount(rc, left);
      felt.innerHTML = '';
      const trayH = 150;
      const tray = h('div', { style: { position: 'relative', width: '64px', height: `${trayH + 6}px`, border: '2px solid rgba(243,239,227,.45)', borderTop: '0', borderRadius: '0 0 8px 8px' } },
        h('div', { style: { position: 'absolute', left: '4px', right: '4px', bottom: '3px', height: `${(dealtDecks / 8) * trayH}px`, background: 'repeating-linear-gradient(0deg,#f4efe2 0 1px,#b9b09b 1px 2px)' } }),
        ...Array.from({ length: 9 }, (_, i) => h('div', { style: { position: 'absolute', right: '-14px', width: '10px', bottom: `${3 + (i / 8) * trayH}px`, borderTop: '1px solid rgba(243,239,227,.6)' } })));
      const ans = await new Promise((res) => felt.append(progress(r, o.n), h('div.row', tray, h('div', h('div.eyebrow', { style: { color: 'rgba(243,239,227,.7)' } }, 'Hi-Lo running count'), h('div.big', BJ.signed(rc)), h('div.sub', 'Ticks mark each deck in the tray.'))), h('div.prompt', 'True count?'), numberForm('True count', res, '±0')));
      if (token.stopped) return;
      const ok = Number(ans) === tc; if (ok) right++; else misses.push(`RC ${BJ.signed(rc)}, ${left} left → ${BJ.signed(tc)}`);
      Store.record('count', ok, null, { drill: 'truecount' });
      felt.append(h('div.sub', { style: { color: ok ? '#9ff0bf' : '#ffb3ad', fontWeight: 700 } }, `${dealtDecks} decks played, ${left} left. ${BJ.signed(rc)} ÷ ${left} = ${(rc / left).toFixed(2)} → ${BJ.signed(tc)}`));
      await sleep(ok ? 900 : 2200);
    }
    finish(done, right, o.n, t0, { summary: `${right} of ${o.n} true counts exact`, misses });
  }

  // ---------- 7. bet ramp ----------
  function setupRamp(form) {
    const len = sel(form, 'br-len', 'Questions', [[15, '15'], [30, '30']], 15);
    form.append(h('p.muted', { style: { fontSize: '13px' } }, sysOf() === 'reko' ? 'REKO 8-deck ramp from the book, in dollars.' : 'Your Hi-Lo ramp from Settings, in units.'));
    return () => ({ n: Number(len()) });
  }
  async function runRamp(felt, o, token, done) {
    const sys = sysOf();
    let right = 0; const misses = []; const t0 = Date.now();
    for (let r = 0; r < o.n; r++) {
      if (token.stopped) return;
      const count = sys === 'reko' ? { system: 'reko', rc: Math.floor(Math.random() * 15) - 6 } : { system: 'hilo', tc: Math.floor(Math.random() * 10) - 2 };
      const want = BJ.rampUnits(count, S().hiloRamp);
      const opts = sys === 'reko' ? [5, 10, 20, 25, 50, 75, 100] : [...new Set([1, ...S().hiloRamp.units])].sort((a, b) => a - b);
      const wantShown = sys === 'reko' ? want * 5 : want;
      felt.innerHTML = '';
      const got = await new Promise((res) => {
        const btns = h('div.drill-answers', opts.map((v) => h('button.btn', { type: 'button', on: { click: () => res(v) } }, sys === 'reko' ? `$${v}` : `${v}u`)));
        felt.append(progress(r, o.n), h('div.eyebrow', { style: { color: 'rgba(243,239,227,.7)' } }, sys === 'reko' ? 'REKO running count' : 'Hi-Lo true count'), h('div.big', BJ.signed(sys === 'reko' ? count.rc : count.tc)), h('div.prompt', 'Your bet?'), btns);
      });
      const ok = got === wantShown; if (ok) right++; else misses.push(`${BJ.signed(sys === 'reko' ? count.rc : count.tc)} → ${sys === 'reko' ? '$' + wantShown : wantShown + 'u'}`);
      Store.record('bet', ok, null, { drill: 'ramp' });
      felt.append(h('div.sub', { style: { color: ok ? '#9ff0bf' : '#ffb3ad', fontWeight: 700 } }, ok ? 'Right' : `Bet ${sys === 'reko' ? '$' + wantShown : wantShown + ' units'}`));
      await sleep(ok ? 450 : 1300);
    }
    finish(done, right, o.n, t0, { summary: `${right} of ${o.n} bets right`, misses });
  }

  // ---------- 8. add up hands ----------
  function setupAddup(form) {
    const cards = sel(form, 'au-c', 'Cards', [['2', 'Two'], ['2-5', 'Two to five'], ['4-5', 'Four or five']], '2-5');
    const len = sel(form, 'au-len', 'Hands', [[15, '15'], [30, '30']], 15);
    return () => ({ cards: cards(), n: Number(len()) });
  }
  async function runAddup(felt, o, token, done) {
    const shoe = new BJ.Shoe(8, 7);
    let right = 0; const misses = []; const t0 = Date.now();
    const [lo, hi] = o.cards === '2' ? [2, 2] : o.cards === '4-5' ? [4, 5] : [2, 5];
    for (let r = 0; r < o.n; r++) {
      if (token.stopped) return;
      let cs;
      do { cs = Array.from({ length: lo + Math.floor(Math.random() * (hi - lo + 1)) }, () => shoe.draw()); } while (BJ.evaluate(cs).total > 21 && Math.random() < 0.7);
      const v = BJ.evaluate(cs);
      const want = v.total > 21 ? 'BUST' : v.soft ? `S${v.total}` : String(v.total);
      felt.innerHTML = '';
      const ans = await new Promise((res) => felt.append(progress(r, o.n), h('div.cards.spread.flash', cs.map((c) => cardEl(c, { deal: true }))), h('div.sub', 'Soft hands: S plus the total (S17). Over 21: type bust.'), numberForm('Hand total', res, 'e.g. S17')));
      if (token.stopped) return;
      const norm = ans.toUpperCase().replace(/\s+/g, '');
      const ok = norm === want || (want === 'BUST' && /^BUST|^B$/.test(norm)) || (want === '21' && norm === 'S21');
      if (ok) right++; else misses.push(`${cs.map((c) => c.rank).join(' ')} = ${want}`);
      felt.append(h('div.sub', { style: { color: ok ? '#9ff0bf' : '#ffb3ad', fontWeight: 700 } }, ok ? 'Right' : `It is ${want}`));
      await sleep(ok ? 350 : 1300);
    }
    finish(done, right, o.n, t0, { summary: `${right} of ${o.n} · ${((Date.now() - t0) / o.n / 1000).toFixed(1)}s per hand`, misses });
  }

  BJ.DrillTitles = Object.fromEntries(DRILLS.map((d) => [d.id, d.title]));
  BJ.Drills = { init(el) { rootEl = el; list(); }, list, open, stop, strategyCandidates };
})(typeof globalThis !== 'undefined' ? globalThis : this);
