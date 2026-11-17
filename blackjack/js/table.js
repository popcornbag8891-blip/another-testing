/* The practice table. */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});
  const { h, cardEl, chipStack, evaluate, isBlackjack, Store } = BJ;

  const SPEED = { slow: 650, normal: 360, fast: 130 };
  let uid = 0;

  const T = {
    shoe: null, counter: null, phase: 'bet', seats: [], dealer: { cards: [], holeHidden: true },
    userIdx: 0, active: null, betUnits: 1, bank: 0, insured: false,
    verdict: null, log: [], error: null, countPrompt: null, peek: false, banner: null,
    session: { id: 'S' + Date.now(), decisions: 0, correct: 0, hands: 0, net: 0, streak: 0, best: 0 },
    animated: new Set(), busy: false, root: null,
  };
  BJ.TableState = T;

  const S = () => Store.settings;
  const rules = () => S().rules;
  const delay = () => BJ.sleep(SPEED[S().speed] || 360);
  const ctx = () => T.counter.context(S().system, T.shoe, S().tenSplits);
  const user = () => T.seats[T.userIdx];

  function newShoe() {
    T.shoe = new BJ.Shoe(8, rules().pen);
    T.counter = new BJ.Counter(8);
    T.animated.clear();
    T.banner = { title: 'Fresh shoe', text: `8 decks shuffled · cut card at about ${rules().pen} decks · burn card dealt face down` };
  }
  function draw(seen) {
    const c = T.shoe.draw();
    c.uid = ++uid;
    if (seen !== false) T.counter.see(c);
    return c;
  }
  function seatSetup() {
    const n = S().bots + 1;
    T.userIdx = Math.floor(n / 2);
    T.seats = Array.from({ length: n }, (_, i) => ({ isUser: i === T.userIdx, name: i === T.userIdx ? 'You' : i === 0 ? 'First base' : i === n - 1 ? 'Third base' : 'Player', hands: [], betUnits: 1 }));
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    if (!T.root) return;
    const r = T.root;
    r.innerHTML = '';
    const layout = h('div.table-layout');
    layout.append(h('div.felt-wrap', renderFelt(), renderControls()), renderSide());
    r.append(layout);
    updateRampHint();
  }

  function renderFelt() {
    const R = rules();
    const felt = h('div.felt');
    // shoe + dealer + tray
    const total = 8 * 52;
    const fill = (T.shoe.remaining / total) * 40;
    const cutFromBottom = ((total - T.shoe.cutAt) / total) * 40;
    const dealtFrac = T.shoe.dealt / total;
    const tray = h('div.tray-box', h('div.tray-fill', { style: { height: `${dealtFrac * 70}px` } }),
      h('div.tray-ticks', Array.from({ length: 9 }, (_, i) => h('i', { style: { bottom: `${3 + (i / 8) * 70}px` } }))));
    const dealerCards = h('div.cards');
    T.dealer.cards.forEach((c, i) => {
      const hidden = i === 1 && T.dealer.holeHidden;
      const key = hidden ? 'hole' + c.uid : c.uid;
      dealerCards.append(cardEl(c, { back: hidden, deal: !T.animated.has(key) }));
      T.animated.add(key);
    });
    const dv = T.dealer.cards.length ? (T.dealer.holeHidden ? evaluate([T.dealer.cards[0]]) : evaluate(T.dealer.cards)) : null;
    let hud = null;
    if (S().showCount || T.peek) {
      const c = ctx();
      if (c.system !== 'none') hud = h('div.count-hud', h('span', 'RC ', h('b', BJ.signed(c.rc))), c.system === 'hilo' ? h('span', 'TC ', h('b', BJ.signed(c.tc))) : h('span', 'pivot ', h('b', '+2')), c.system === 'hilo' ? h('span', `${c.decksLeft} dk left`) : null);
    }
    felt.append(h('div.felt-top',
      h('div.shoe', { title: `${T.shoe.remaining} cards left in the shoe` }, h('div.shoe-box', h('div.shoe-fill', { style: { height: `${fill}px` } }), h('div.shoe-cut', { style: { bottom: `${6 + cutFromBottom}px` } })), h('span', 'Shoe'), hud),
      h('div.dealer-zone', h('div.zone-label', 'Dealer'), h('div.cards', { style: { minHeight: 'calc(var(--card-w) * 1.4)' } }, dealerCards), h('div.total-pill', dv ? (dv.soft && dv.total < 21 ? `soft ${dv.total}` : String(dv.total)) : '')),
      h('div.tray', { title: `Discard tray: about ${(T.shoe.dealt / 52).toFixed(1)} decks played. Ticks mark each deck.` }, tray, h('span', 'Discards'))));
    felt.append(h('div.felt-print',
      h('div', 'Blackjack pays 3 to 2'),
      h('div.arc', R.s17 ? 'Dealer must stand on all 17s' : 'Dealer must hit soft 17'),
      h('div.small', ['Insurance pays 2 to 1', R.ls ? 'Late surrender' : null, R.das ? 'Double after split' : null, R.rsa ? 'Resplit aces' : null].filter(Boolean).join(' · '))));
    felt.append(h('div'));
    const seats = h('div.seats');
    T.seats.forEach((seat, si) => seats.append(renderSeat(seat, si)));
    felt.append(seats);
    if (T.banner) felt.append(h('div.felt-banner', h('strong', T.banner.title), h('div', T.banner.text)));
    return felt;
  }

  function renderSeat(seat, si) {
    const turn = T.active && T.active.seat === si;
    const el = h(`div.seat${seat.isUser ? '.user' : '.bot'}${turn ? '.turn' : ''}`);
    const hands = h('div.seat-hands');
    seat.hands.forEach((hand, hi) => {
      const cards = h('div.cards');
      hand.cards.forEach((c) => { cards.append(cardEl(c, { deal: !T.animated.has(c.uid) })); T.animated.add(c.uid); });
      const v = evaluate(hand.cards);
      const isActive = turn && T.active.hand === hi && T.phase === 'player';
      const res = hand.shownResult || hand.result;
      const label = res ? ({ win: 'WIN', lose: 'LOSE', push: 'PUSH', bust: 'BUST', blackjack: 'BLACKJACK', surrender: 'SURRENDER' }[res]) : '';
      hands.append(h(`div.hand${isActive ? '.active' : ''}`, cards,
        h('div.total-pill', hand.cards.length ? (isBlackjack(hand.cards, hand.fromSplit) ? 'BJ' : v.soft && v.total < 21 ? `soft ${v.total}` : String(v.total)) + (hand.doubled ? ' ×2' : '') : ''),
        res ? h(`div.result.${res}`, label) : null));
    });
    el.append(hands);
    const betDollars = (seat.isUser ? T.betUnits : seat.betUnits) * S().unit;
    el.append(h('div.betting-circle', chipStack(seat.hands.length || seat.isUser ? betDollars : 0)));
    el.append(h('div.seat-name', seat.isUser && T.insured ? 'You · insured' : seat.name));
    return el;
  }

  function renderControls() {
    const wrap = h('div.controls');
    const u = user();
    const hand = T.active && T.active.seat === T.userIdx ? u.hands[T.active.hand] : null;
    const R = rules();
    const can = {
      H: T.phase === 'player' && !!hand,
      S: T.phase === 'player' && !!hand,
      D: T.phase === 'player' && hand && BJ.canDouble(u, hand, R),
      P: T.phase === 'player' && hand && BJ.canSplit(u, hand, R),
      R: T.phase === 'player' && hand && BJ.canSurrender(u, hand, R),
    };
    if (T.phase === 'insurance') {
      wrap.append(h('div.insurance-row', h('strong', 'Dealer shows an ace. Insurance?'),
        h('button.btn', { type: 'button', on: { click: () => insurance(true) } }, 'Insure ', h('span.kbd', 'Y')),
        h('button.btn', { type: 'button', on: { click: () => insurance(false) } }, 'No thanks ', h('span.kbd', 'N'))));
    }
    if (T.countPrompt) wrap.append(renderCountPrompt());
    const row = h('div.action-row');
    [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double'], ['P', 'Split'], ['R', 'Surrender']].forEach(([k, name]) =>
      row.append(h(`button.btn.act-${k}`, { type: 'button', disabled: !can[k], on: { click: () => act(k) } }, name, h('span.kbd', k))));
    wrap.append(row);

    const betting = T.phase === 'bet' || T.phase === 'done';
    const betCtl = h('div.bet-ctl',
      h('button.btn.small', { type: 'button', 'aria-label': 'Lower bet', disabled: !betting || T.betUnits <= 1, on: { click: () => setBet(T.betUnits - 1) } }, '−'),
      h('div', h('div.bet-amount', `$${T.betUnits * S().unit}`), h('div.eyebrow', { style: { textAlign: 'center' } }, `${T.betUnits} unit${T.betUnits > 1 ? 's' : ''}`)),
      h('button.btn.small', { type: 'button', 'aria-label': 'Raise bet', disabled: !betting || T.betUnits >= 40, on: { click: () => setBet(T.betUnits + 1) } }, '+'),
      h('span.bet-hint#ramp-hint'));
    const right = h('div.bet-ctl',
      T.phase === 'done' && S().dealerErrors ? h('button.btn', { type: 'button', on: { click: callDealerError } }, 'Dealer error! ', h('span.kbd', 'F')) : null,
      h('button.btn.primary', { type: 'button', disabled: !betting || !!T.countPrompt, on: { click: deal } }, T.phase === 'done' ? 'Next hand' : 'Deal', h('span.kbd', 'Space')));
    wrap.append(h('div.bet-row', betCtl, right));
    return wrap;
  }

  function renderCountPrompt() {
    const p = T.countPrompt;
    const sys = S().system;
    const form = h('form.countcheck', { on: { submit: (e) => { e.preventDefault(); answerCount(form); } } },
      h('div', h('strong', p.reason), h('div.muted', { style: { fontSize: '13px' } }, sys === 'reko' ? 'Running count, counting from −27 at the shuffle.' : 'Running count, then true count (truncate; decks left by the discard tray).')),
      h('div.field', h('label', { for: 'cc-rc' }, 'Running count'), h('input.input.num#cc-rc', { inputmode: 'numeric', autocomplete: 'off', required: true })),
      sys === 'hilo' ? h('div.field', h('label', { for: 'cc-tc' }, 'True count'), h('input.input.num#cc-tc', { inputmode: 'numeric', autocomplete: 'off', required: true })) : null,
      h('button.btn.primary', { type: 'submit' }, 'Check'),
      h('button.btn.ghost', { type: 'button', on: { click: () => { finishCountPrompt(); } } }, 'Skip'));
    setTimeout(() => { const i = document.getElementById('cc-rc'); if (i) i.focus(); }, 30);
    return form;
  }

  function renderSide() {
    const side = h('aside.side');
    side.append(T.verdict || h('div.verdict.info', h('div.v-head', h('div.v-mark', 'i'), h('div', h('div.v-title', 'Your coach'), h('div.v-sit', 'Every decision is checked against the book.'))),
      h('div.v-why', S().system === 'none' ? 'Playing basic strategy. Pick REKO or Hi-Lo in the rules menu to train counting.' : S().system === 'reko'
        ? 'Counting REKO: 2-7 are +1, tens and aces −1. Start at −27. Bet by the book\'s 8-deck ramp, and make every variation at +2 or higher.'
        : 'Counting Hi-Lo: 2-6 are +1, tens and aces −1. Divide by decks left (see the discard tray) for the true count.'),
      h('div.v-why.muted', 'Keys: H S D P R to act, Space to deal, ↑ ↓ to bet, C to peek at the count.')));
    const s = T.session;
    side.append(h('div.panel',
      h('div.panel-title', h('h3', 'This session'), h('button.btn.small.ghost', { type: 'button', on: { click: resetSession } }, 'Reset')),
      h('div.stat-grid',
        h('div.stat', h('div.k', 'Accuracy'), h('div.v', s.decisions ? `${BJ.pct(s.correct, s.decisions)}%` : '—')),
        h('div.stat', h('div.k', 'Decisions'), h('div.v', s.decisions)),
        h('div.stat', h('div.k', 'Streak'), h('div.v', s.streak)),
        h('div.stat', h('div.k', 'Hands'), h('div.v', s.hands)),
        h('div.stat', h('div.k', 'Net'), h('div.v', { style: { color: s.net >= 0 ? 'var(--good)' : 'var(--bad)' } }, `${s.net < 0 ? '−' : ''}$${Math.abs(s.net)}`)),
        h('div.stat', h('div.k', 'Best run'), h('div.v', s.best))),
      h('p.muted', { style: { fontSize: '12.5px', marginTop: '10px' } }, 'Ignore the net. The book: "Whether or not you win is meaningless when practicing. What matters is your accuracy rate." (p.64)')));
    const c = ctx();
    if (S().system !== 'none') {
      side.append(h('div.panel', h('div.panel-title', h('h3', 'Count'), h('button.btn.small', { type: 'button', on: { click: togglePeek } }, T.peek || S().showCount ? 'Hide' : 'Peek', ' ', h('span.kbd', 'C'))),
        T.peek || S().showCount
          ? h('div.stat-grid', h('div.stat', h('div.k', 'Running'), h('div.v', BJ.signed(c.rc))),
            c.system === 'hilo' ? h('div.stat', h('div.k', 'True'), h('div.v', BJ.signed(c.tc))) : h('div.stat', h('div.k', 'Pivot'), h('div.v', '+2')),
            h('div.stat', h('div.k', 'Decks left'), h('div.v', String(c.decksLeft))))
          : h('p.muted', 'Hidden. Keep it in your head; the coach will ask.')));
    }
    if (T.log.length) {
      side.append(h('div.panel', h('div.panel-title', h('h3', 'Recent decisions')),
        h('div.log', T.log.slice(-14).reverse().map((l) => h('div.log-row', h('span', { class: l.ok ? 'ok' : 'no' }, l.ok ? '✓' : '✕'), h('span', l.text), h('span.tag', l.tag))))));
    }
    return side;
  }

  function updateRampHint() {
    const el = document.getElementById('ramp-hint');
    if (!el) return;
    const sys = S().system;
    if (sys === 'none') { el.textContent = 'Flat bet: basic strategy has no betting strategy (p.50).'; return; }
    if (S().showCount || T.peek) {
      const u = BJ.rampUnits(ctx(), S().hiloRamp);
      el.innerHTML = '';
      el.append('Ramp at this count: ', h('b', `${u} unit${u > 1 ? 's' : ''}`));
    } else el.textContent = S().gradeBets ? 'Your bet is graded against the ramp.' : '';
  }

  // ---------------------------------------------------------------- flow
  function setVerdict(v) { T.verdict = v; }
  function pushLog(ok, text, tag) { T.log.push({ ok, text, tag }); if (T.log.length > 60) T.log.shift(); }
  function bump(ok) {
    const s = T.session;
    s.decisions++; if (ok) { s.correct++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
    Store.recordSession({ id: s.id, decisions: s.decisions, correct: s.correct, hands: s.hands, net: s.net, system: S().system });
  }

  function setBet(u) { T.betUnits = BJ.clamp(u, 1, 40); render(); }

  async function deal() {
    if (T.busy || !(T.phase === 'bet' || T.phase === 'done') || T.countPrompt) return;
    if (T.error && !T.error.resolved) resolveMissedError();
    T.busy = true;
    T.banner = null;
    // Bet grading happens before any card is dealt, at the count you walked up to.
    const c = ctx();
    if (c.system !== 'none' && S().gradeBets) {
      const want = BJ.rampUnits(c, S().hiloRamp);
      const ok = T.betUnits === want;
      Store.record('bet', ok, null, { want, got: T.betUnits });
      bump(ok);
      pushLog(ok, `Bet ${T.betUnits}u at ${c.system === 'reko' ? 'RC' : 'TC'} ${BJ.signed(c.system === 'reko' ? c.rc : c.tc)}`, ok ? 'bet' : `ramp ${want}u`);
      if (!ok) setVerdict(betVerdict(c, want));
    }
    T.insured = false; T.active = null; T.error = null;
    T.dealer = { cards: [], holeHidden: true };
    T.seats.forEach((s) => { s.hands = [BJ.newHand([], s.isUser ? T.betUnits : s.betUnits)]; s.insured = false; });
    T.phase = 'dealing';
    render();
    for (let round = 0; round < 2; round++) {
      for (const seat of T.seats) { seat.hands[0].cards.push(draw()); render(); await delay(); }
      if (round === 0) { T.dealer.cards.push(draw()); }
      else { T.dealer.cards.push(draw(false)); }
      render(); await delay();
    }
    T.busy = false;
    if (T.dealer.cards[0].key === 'A') { T.phase = 'insurance'; render(); return; }
    afterInsurance();
  }

  function betVerdict(c, want) {
    const sys = c.system;
    const why = sys === 'reko'
      ? `The book's 8-deck REKO ramp (p.72): RC ≤ −4 $5, −3 $10, −2 $20, −1 and 0 $25, +1 to +3 $50, +4 and +5 $75, +6 or more $100. In $5 units that is ${want} at RC ${BJ.signed(c.rc)}.`
      : `Your Hi-Lo ramp (Settings) says ${want} unit${want > 1 ? 's' : ''} at TC ${BJ.signed(c.tc)}. Bet with the true count, not the running count.`;
    return BJ.verdictEl({ tone: 'bad', title: `Bet ${want} unit${want > 1 ? 's' : ''}`, why });
  }

  function insurance(yes) {
    if (T.phase !== 'insurance') return;
    const c = ctx();
    const d = BJ.decideInsurance(c);
    const ok = (d.action === 'I') === yes;
    T.insured = yes;
    Store.record('insurance', ok, null);
    bump(ok);
    pushLog(ok, yes ? 'Took insurance' : 'Declined insurance', ok ? 'insurance' : `book: ${d.action === 'I' ? 'insure' : 'decline'}`);
    const el = BJ.verdictEl({ tone: ok ? 'good' : 'bad', title: ok ? (yes ? 'Correct: insure' : 'Correct: no insurance') : d.action === 'I' ? 'Book says insure' : 'Book says no insurance', why: d.why });
    if (d.deviation && c.system !== 'none') el.append(h('div.v-dev', `${c.system === 'reko' ? 'RC' : 'TC'} is ${BJ.signed(c.system === 'reko' ? c.rc : c.tc)}; insure at ${BJ.signed(d.deviation.at)} or higher.`));
    setVerdict(el);
    T.phase = 'peek';
    afterInsurance();
  }

  async function afterInsurance() {
    const up = T.dealer.cards[0];
    if ((up.key === 'A' || up.key === 'T') && isBlackjack(T.dealer.cards)) {
      T.busy = true;
      await delay();
      revealHole();
      T.banner = { title: 'Dealer blackjack', text: up.key === 'A' ? 'The dealer peeked and turned it over.' : 'The dealer peeked under the ten.' };
      render(); await delay();
      settle();
      return;
    }
    if (up.key === 'A' || up.key === 'T') { T.banner = null; }
    T.phase = 'playing';
    playFrom(0);
  }

  function revealHole() {
    if (!T.dealer.holeHidden) return;
    T.dealer.holeHidden = false;
    T.counter.see(T.dealer.cards[1]);
  }

  async function playFrom(si) {
    T.busy = true;
    for (let i = si; i < T.seats.length; i++) {
      const seat = T.seats[i];
      if (seat.isUser) {
        T.active = { seat: i, hand: 0 };
        T.busy = false;
        if (prepareUserHand()) return; // waiting for the player
        T.busy = true;
        continue;
      }
      T.active = { seat: i, hand: 0 };
      await botPlay(seat, i);
    }
    T.active = null;
    await dealerTurn();
  }

  /** Make the active user hand ready. Returns true when the player must act. */
  function prepareUserHand() {
    const seat = user();
    while (T.active.hand < seat.hands.length) {
      const hand = seat.hands[T.active.hand];
      if (hand.cards.length === 1) { hand.cards.push(draw()); }
      const v = evaluate(hand.cards).total;
      if (!hand.done && (v >= 21 || (hand.splitAces && !BJ.canSplit(seat, hand, rules())))) hand.done = true;
      if (!hand.done) { T.phase = 'player'; render(); return true; }
      T.active.hand++;
    }
    return false;
  }

  async function botPlay(seat, si) {
    for (let hi = 0; hi < seat.hands.length; hi++) {
      T.active = { seat: si, hand: hi };
      const hand = seat.hands[hi];
      if (hand.cards.length === 1) { hand.cards.push(draw()); render(); await delay(); }
      while (!hand.done) {
        const v = evaluate(hand.cards).total;
        if (v >= 21 || (hand.splitAces && !BJ.canSplit(seat, hand, rules()))) { hand.done = true; break; }
        const d = BJ.decide(hand.cards, T.dealer.cards[0].key, {
          rules: rules(), fromSplit: hand.fromSplit,
          canDouble: BJ.canDouble(seat, hand, rules()), canSplit: BJ.canSplit(seat, hand, rules()), canSurrender: BJ.canSurrender(seat, hand, rules()),
        });
        applyAction(seat, hi, d.action);
        render(); await delay();
      }
    }
  }

  function applyAction(seat, hi, a) {
    const hand = seat.hands[hi];
    if (a === 'R') { hand.surrendered = true; hand.done = true; }
    else if (a === 'S') hand.done = true;
    else if (a === 'H') { hand.cards.push(draw()); if (evaluate(hand.cards).total >= 21) hand.done = true; }
    else if (a === 'D') { hand.doubled = true; hand.cards.push(draw()); hand.done = true; }
    else if (a === 'P') {
      const aces = hand.cards[0].key === 'A';
      const second = BJ.newHand([hand.cards.pop()], hand.bet, { fromSplit: true, splitAces: aces });
      hand.fromSplit = true; hand.splitAces = aces;
      hand.cards.push(draw());
      seat.hands.splice(hi + 1, 0, second);
      if (evaluate(hand.cards).total >= 21 || (aces && !BJ.canSplit(seat, hand, rules()))) hand.done = true;
    }
  }

  /** The player's action: grade, maybe take back, then apply. */
  function act(a, force) {
    if (T.phase !== 'player' || T.busy) return;
    const seat = user();
    const hand = seat.hands[T.active.hand];
    const R = rules();
    const opts = { canDouble: BJ.canDouble(seat, hand, R), canSplit: BJ.canSplit(seat, hand, R), canSurrender: BJ.canSurrender(seat, hand, R) };
    if ((a === 'D' && !opts.canDouble) || (a === 'P' && !opts.canSplit) || (a === 'R' && !opts.canSurrender)) return;
    const c = ctx();
    const up = T.dealer.cards[0].key;
    const d = BJ.decide(hand.cards, up, Object.assign({ rules: R, count: c, fromSplit: hand.fromSplit }, opts));
    const ok = d.action === a;
    const gradeKey = `${T.active.hand}:${hand.cards.length}:${seat.hands.length}`;
    if (hand.gradedKey !== gradeKey) {
      hand.gradedKey = gradeKey;
      const cat = d.deviation && d.deviation.applied ? 'deviation' : d.table;
      Store.record(cat, ok, BJ.cellKey(d.sit, up), { table: d.table });
      if (cat === 'deviation') Store.record(d.table, ok, null);
      bump(ok);
      pushLog(ok, `${BJ.handLabel(d.sit)} v ${BJ.upName(up)}: ${BJ.ACTION_NAMES[a]}`, ok ? (cat === 'deviation' ? 'count play' : BJ.CAT_LABEL[d.table] || '') : `book: ${BJ.ACTION_NAMES[d.action]}`);
      const actions = [];
      if (!ok && S().mistakes === 'takeback') actions.push(h('button.btn.small', { type: 'button', on: { click: () => act(a, true) } }, `Play ${BJ.ACTION_NAMES[a]} anyway`));
      setVerdict(BJ.verdictEl({ ok, you: a, book: d.action, sit: d.sit, up, d, why: d.why, count: c, actions }));
    }
    if (!ok && S().mistakes === 'takeback' && !force) { render(); return; }
    applyAction(seat, T.active.hand, a);
    if (seat.hands[T.active.hand].done) T.active.hand++;
    if (prepareUserHand()) return;
    T.phase = 'playing'; render(); playFrom(T.userIdx + 1);
  }

  async function dealerTurn() {
    T.phase = 'dealer';
    T.busy = true;
    revealHole();
    render(); await delay();
    const live = T.seats.some((s) => s.hands.some((hd) => !hd.surrendered && evaluate(hd.cards).total <= 21 && !isBlackjack(hd.cards, hd.fromSplit)));
    if (live) while (BJ.dealerShouldHit(T.dealer.cards, rules())) { T.dealer.cards.push(draw()); render(); await delay(); }
    settle();
  }

  function settle() {
    const u = user();
    let netUnits = 0;
    for (const seat of T.seats) for (const hand of seat.hands) { const n = BJ.settleHand(hand, T.dealer.cards); if (seat.isUser) netUnits += n; }
    if (T.insured) netUnits += isBlackjack(T.dealer.cards) ? T.betUnits : -T.betUnits / 2;
    let netDollars = netUnits * S().unit;
    // The book's dealer-error drill (p.65): now and then the dealer gets the payout wrong.
    if (S().dealerErrors && Math.random() < 0.14) {
      const cands = [];
      u.hands.forEach((hd, i) => {
        if (hd.result === 'win') cands.push({ i, kind: 'notpaid', shown: 'lose', desc: 'The dealer took a winning hand.' });
        if (hd.result === 'push') cands.push({ i, kind: 'pushtaken', shown: 'lose', desc: 'The dealer took your bet on a push.' });
        if (hd.result === 'blackjack') cands.push({ i, kind: 'bj1to1', shown: 'win', desc: 'The dealer paid your blackjack 1:1 instead of 3:2.' });
      });
      if (cands.length) {
        const e = BJ.pick(cands);
        const hd = u.hands[e.i];
        const stake = hd.bet * (hd.doubled ? 2 : 1);
        const shownNet = e.kind === 'bj1to1' ? hd.bet : -stake;
        const diff = (hd.net - shownNet) * S().unit;
        hd.shownResult = e.shown;
        T.error = Object.assign(e, { diff, resolved: false });
        netDollars -= diff;
      }
    }
    T.session.net += netDollars;
    T.session.hands++;
    Store.recordSession({ id: T.session.id, decisions: T.session.decisions, correct: T.session.correct, hands: T.session.hands, net: T.session.net, system: S().system });
    T.phase = 'done';
    T.busy = false;
    T.active = null;
    endOfRoundChecks();
    render();
  }

  function endOfRoundChecks() {
    const sys = S().system;
    if (T.shoe.needsShuffle) {
      if (sys !== 'none' && S().countChecks !== 'off') { T.countPrompt = { reason: 'Cut card is out. Before the shuffle: what is the count?', shuffleAfter: true }; return; }
      shuffleNow();
      return;
    }
    if (sys !== 'none' && S().countChecks === 'often' && Math.random() < 0.18) T.countPrompt = { reason: 'Count check: what is the count right now?' };
  }
  function shuffleNow() {
    T.shoe.shuffle(); T.counter.reset(); T.animated.clear();
    T.banner = { title: 'Shuffle', text: `New shoe. ${S().system === 'reko' ? 'Reset your count to −27.' : S().system === 'hilo' ? 'Reset your count to 0.' : 'Cut card placed, burn card dealt.'}` };
  }

  function answerCount(form) {
    const c = ctx();
    const rc = Number(form.querySelector('#cc-rc').value);
    const tcEl = form.querySelector('#cc-tc');
    const tc = tcEl ? Number(tcEl.value) : null;
    const okRC = rc === c.rc;
    const okTC = tcEl ? tc === c.tc : true;
    const ok = okRC && okTC;
    Store.record('count', ok, null, { want: c.rc, got: rc });
    bump(ok);
    pushLog(ok, `Count check: RC ${BJ.signed(rc)}${tcEl ? `, TC ${BJ.signed(tc)}` : ''}`, ok ? 'count' : `was ${BJ.signed(c.rc)}${tcEl ? ` / ${BJ.signed(c.tc)}` : ''}`);
    const why = ok ? 'Locked in.' : `Running count was ${BJ.signed(c.rc)}${tcEl ? `, true count ${BJ.signed(c.tc)} (${BJ.signed(c.rc)} ÷ ${c.decksLeft} decks left, truncated)` : ''}. ${!okRC ? 'Tip from the book: count the first two cards of each hand as a pair so high-low pairs cancel (p.77).' : ''}`;
    setVerdict(BJ.verdictEl({ tone: ok ? 'good' : 'bad', title: ok ? 'Count is right' : 'Count was off', why }));
    finishCountPrompt();
  }
  function finishCountPrompt() {
    const p = T.countPrompt;
    T.countPrompt = null;
    if (p && p.shuffleAfter) shuffleNow();
    render();
  }

  function callDealerError() {
    if (T.phase !== 'done') return;
    if (T.error && !T.error.resolved) {
      T.error.resolved = true;
      T.session.net += T.error.diff;
      user().hands[T.error.i].shownResult = null;
      Store.record('dealerError', true, null);
      bump(true);
      pushLog(true, 'Caught a dealer error', 'dealer');
      setVerdict(BJ.verdictEl({ tone: 'good', title: 'Good catch', why: `${T.error.desc} Corrected: +$${T.error.diff}.` }));
    } else if (!T.error) {
      T.error = { resolved: true, none: true };
      Store.record('dealerError', false, null);
      bump(false);
      pushLog(false, 'Called a dealer error', 'no error');
      setVerdict(BJ.verdictEl({ tone: 'bad', title: 'No error that hand', why: 'The payouts were right. Check each hand against the dealer total before you call it.' }));
    }
    render();
  }
  function resolveMissedError() {
    const e = T.error;
    e.resolved = true;
    T.session.net += e.diff;
    Store.record('dealerError', false, null);
    bump(false);
    pushLog(false, 'Missed a dealer error', 'dealer');
    setVerdict(BJ.verdictEl({ tone: 'bad', title: 'You missed a dealer error', why: `${e.desc} That cost $${e.diff}; it has been put back. Watch every payout before the next deal (p.65).` }));
  }

  function togglePeek() { T.peek = !T.peek; render(); }
  function resetSession() {
    T.session = { id: 'S' + Date.now(), decisions: 0, correct: 0, hands: 0, net: 0, streak: 0, best: 0 };
    T.log = []; T.verdict = null; render();
  }

  // ---------------------------------------------------------------- lifecycle
  function onKey(e) {
    if (document.getElementById('view-table').hidden) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const map = { h: 'H', s: 'S', d: 'D', p: 'P', r: 'R' };
    if (map[k] && T.phase === 'player') { e.preventDefault(); act(map[k]); }
    else if ((k === 'y' || k === 'i') && T.phase === 'insurance') insurance(true);
    else if (k === 'n' && T.phase === 'insurance') insurance(false);
    else if ((k === ' ' || k === 'enter') && (T.phase === 'bet' || T.phase === 'done')) { e.preventDefault(); deal(); }
    else if (k === 'arrowup' && (T.phase === 'bet' || T.phase === 'done')) { e.preventDefault(); setBet(T.betUnits + 1); }
    else if (k === 'arrowdown' && (T.phase === 'bet' || T.phase === 'done')) { e.preventDefault(); setBet(T.betUnits - 1); }
    else if (k === 'c') togglePeek();
    else if (k === 'f' && S().dealerErrors) callDealerError();
  }

  function init(rootEl) {
    T.root = rootEl;
    newShoe();
    seatSetup();
    render();
    document.addEventListener('keydown', onKey);
  }
  /** Called when settings change. Rules or seats changing means a new shoe. */
  function onSettings(changed) {
    if (T.phase !== 'bet' && T.phase !== 'done') { render(); return; }
    if (changed && (changed.rules || changed.seats)) {
      newShoe(); seatSetup(); T.dealer = { cards: [], holeHidden: true }; T.phase = 'bet'; T.countPrompt = null; T.error = null;
    }
    render();
  }

  BJ.Table = { init, render, onSettings };
})(typeof globalThis !== 'undefined' ? globalThis : this);
