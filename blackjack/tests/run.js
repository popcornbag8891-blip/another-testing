#!/usr/bin/env node
/* Run: node tests/run.js        (add --sim for the long Monte Carlo checks)
   1. Every cell of the book's basic strategy tables (extracted from the book's HTML colors) vs the engine.
   2. Count system facts from the book.
   3. Optional simulation: basic strategy loses a little; REKO with the book's 8-deck ramp wins. */
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
for (const f of ['cards', 'book', 'strategy', 'game']) require(path.join(root, 'js', f + '.js'));
const BJ = globalThis.BJ;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'book-basic-strategy.json'), 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}
const C = (k) => BJ.makeCard(k === 'T' ? '10' : k);
const hand = (...ks) => ks.map(C);
const COLS = BJ.COLS;
const R = (o) => Object.assign({}, BJ.DEFAULT_RULES, o);

// Two/three-card hands with no pair and no ace, for each hard total.
const HARD2 = { 8: ['5', '3'], 9: ['5', '4'], 10: ['6', '4'], 11: ['6', '5'], 12: ['T', '2'], 13: ['T', '3'], 14: ['T', '4'], 15: ['T', '5'], 16: ['T', '6'], 17: ['T', '7'] };
const HARD3 = { 12: ['5', '4', '3'], 13: ['6', '4', '3'], 14: ['7', '4', '3'], 15: ['7', '5', '3'], 16: ['7', '5', '4'], 17: ['8', '5', '4'] };
const SOFT3 = { 'A,9': ['A', '5', '4'], 'A,8': ['A', '5', '3'], 'A,7': ['A', '4', '3'], 'A,6': ['A', '3', '3'] };

const T = fixture.tables;
// --- Surrender (red = surrender) ---
for (const [title, s17] of [['Surrender 4-8 Decks S17', true], ['Surrender 4-8 Decks H17', false]]) {
  for (const [row, cells] of Object.entries(T[title].rows)) {
    cells.forEach((c, i) => {
      const cards = row === '8,8' ? hand('8', '8') : hand(...HARD2[row]);
      const d = BJ.decide(cards, COLS[i], { rules: R({ s17, ls: true }) });
      check(`${title} ${row} v ${COLS[i]}`, (d.action === 'R') === (c === 'R'), `engine=${d.action} book=${c}`);
    });
  }
}
// --- Split (green = split). LS off so surrender cannot pre-empt. ---
for (const [title, das] of [['Split DAS', true], ['Split nDAS', false]]) {
  for (const [row, cells] of Object.entries(T[title].rows)) {
    const k = row.split(',')[0];
    cells.forEach((c, i) => {
      for (const s17 of [true, false]) {
        const d = BJ.decide(hand(k, k), COLS[i], { rules: R({ das, ls: false, s17 }) });
        check(`${title} ${row} v ${COLS[i]} ${s17 ? 'S17' : 'H17'}`, (d.action === 'P') === (c === 'G'), `engine=${d.action} book=${c}`);
      }
    });
  }
}
// --- Soft double (green = double) ---
for (const [title, s17] of [['Soft Double 2-8 Decks S17', true], ['Soft Double 2-8 Decks H17', false]]) {
  for (const [row, cells] of Object.entries(T[title].rows)) {
    const k = row.split(',')[1];
    cells.forEach((c, i) => {
      const d = BJ.decide(hand('A', k), COLS[i], { rules: R({ s17, ls: false }) });
      check(`${title} ${row} v ${COLS[i]}`, (d.action === 'D') === (c === 'G'), `engine=${d.action} book=${c}`);
    });
  }
}
// --- Hard double S17 (green = double); footnote: H17 also doubles 11 v A ---
for (const [row, cells] of Object.entries(T['Hard Double 3-8 Decks S17'].rows)) {
  cells.forEach((c, i) => {
    const s17 = BJ.decide(hand(...HARD2[row]), COLS[i], { rules: R({ s17: true, ls: false }) });
    check(`Hard Double S17 ${row} v ${COLS[i]}`, (s17.action === 'D') === (c === 'G'), `engine=${s17.action} book=${c}`);
    const h17 = BJ.decide(hand(...HARD2[row]), COLS[i], { rules: R({ s17: false, ls: false }) });
    const want = c === 'G' || (row === '11' && COLS[i] === 'A');
    check(`Hard Double H17 ${row} v ${COLS[i]}`, (h17.action === 'D') === want, `engine=${h17.action}`);
  });
}
// --- Soft hit/stand (green = hit), three-card hands so doubling is not available ---
for (const [row, cells] of Object.entries(T['Soft Hit/Stand'].rows)) {
  cells.forEach((c, i) => {
    for (const s17 of [true, false]) {
      const d = BJ.decide(hand(...SOFT3[row]), COLS[i], { rules: R({ s17 }) });
      check(`Soft H/S ${row} v ${COLS[i]}`, (d.action === 'H') === (c === 'G'), `engine=${d.action} book=${c}`);
    }
  });
}
// --- Hard hit/stand (green = hit). 16 v 10 footnote: with surrender, stand. ---
for (const [row, cells] of Object.entries(T['Hard Hit/Stand'].rows)) {
  cells.forEach((c, i) => {
    const noLS = BJ.decide(hand(...HARD3[row]), COLS[i], { rules: R({ ls: false }) });
    check(`Hard H/S ${row} v ${COLS[i]} (no LS)`, (noLS.action === 'H') === (c === 'G'), `engine=${noLS.action} book=${c}`);
    const ls = BJ.decide(hand(...HARD3[row]), COLS[i], { rules: R({ ls: true }) });
    const want = row === '16' && COLS[i] === 'T' ? false : c === 'G';
    check(`Hard H/S ${row} v ${COLS[i]} (LS, 3 cards)`, (ls.action === 'H') === want, `engine=${ls.action}`);
  });
}
// --- Things the tables imply ---
check('Never insure without a count', BJ.decideInsurance({ system: 'none' }).action === 'N');
check('A,A splits v A', BJ.decide(hand('A', 'A'), 'A', { rules: R() }).action === 'P');
check('5,5 doubles v 9 (treated as 10)', BJ.decide(hand('5', '5'), '9', { rules: R() }).action === 'D');
check('T,T stands v 6', BJ.decide(hand('T', 'T'), '6', { rules: R() }).action === 'S');
check('A,7 v 3 when doubling not allowed stands', BJ.decide(hand('A', '4', '3'), '3', { rules: R() }).action === 'S');
check('8,8 v A H17+LS surrenders', BJ.decide(hand('8', '8'), 'A', { rules: R({ s17: false, ls: true }) }).action === 'R');
check('8,8 v A S17+LS splits', BJ.decide(hand('8', '8'), 'A', { rules: R({ s17: true, ls: true }) }).action === 'P');

// --- REKO (pp.69-74) ---
const reko = BJ.SYSTEMS.reko;
check('REKO tags sum to +4 per deck (p.78)', ['A','2','3','4','5','6','7','8','9','T','T','T','T'].reduce((s, k) => s + reko.tags[k], 0) * 4 === 4);
check('REKO 8-deck IRC is -27 (p.71)', reko.irc[8] === -27);
check('Hi-Lo tags sum to 0', ['A','2','3','4','5','6','7','8','9','T','T','T','T'].reduce((s, k) => s + BJ.SYSTEMS.hilo.tags[k], 0) === 0);
const rk = (rc) => ({ system: 'reko', rc });
check('REKO: 16 v T hits at +1, stands at +2 (no LS)', BJ.decide(hand('T', '6'), 'T', { rules: R({ ls: false }), count: rk(1) }).action === 'H' && BJ.decide(hand('T', '6'), 'T', { rules: R({ ls: false }), count: rk(2) }).action === 'S');
check('REKO: 12 v 4 is basic (stand) at any count, 8-deck change (p.74)', BJ.decide(hand('T', '2'), '4', { rules: R(), count: rk(-10) }).action === 'S');
check('REKO: 12 v 3 stands at +2', BJ.decide(hand('T', '2'), '3', { rules: R(), count: rk(2) }).action === 'S');
check('REKO: 11 v A doubles at +2 (S17)', BJ.decide(hand('6', '5'), 'A', { rules: R(), count: rk(2) }).action === 'D' && BJ.decide(hand('6', '5'), 'A', { rules: R(), count: rk(1) }).action === 'H');
check('REKO: A,8 v 6 doubles at +2 (S17)', BJ.decide(hand('A', '8'), '6', { rules: R(), count: rk(2) }).action === 'D');
check('REKO: 8,8 v T surrenders at +2', BJ.decide(hand('8', '8'), 'T', { rules: R(), count: rk(2) }).action === 'R' && BJ.decide(hand('8', '8'), 'T', { rules: R(), count: rk(1) }).action === 'P');
check('REKO: 14 v T surrenders at +2', BJ.decide(hand('T', '4'), 'T', { rules: R(), count: rk(2) }).action === 'R');
check('REKO: insure at +2', BJ.decideInsurance(rk(2)).action === 'I' && BJ.decideInsurance(rk(1)).action === 'N');
check('REKO ramp: RC -4 -> $5 (1u), 0 -> $25 (5u), +6 -> $100 (20u) (p.72)', BJ.rampUnits(rk(-9)) === 1 && BJ.rampUnits(rk(0)) === 5 && BJ.rampUnits(rk(12)) === 20);

// --- Hi-Lo Sweet 16 + Fab 4 ---
const hl = (tc) => ({ system: 'hilo', rc: tc * 4, tc });
check('Hi-Lo: 16 v T stands at TC 0, hits at -1 (no LS)', BJ.decide(hand('T', '6'), 'T', { rules: R({ ls: false }), count: hl(0) }).action === 'S' && BJ.decide(hand('T', '6'), 'T', { rules: R({ ls: false }), count: hl(-1) }).action === 'H');
check('Hi-Lo: 15 v T surrender at 0, not at -1 (LS)', BJ.decide(hand('T', '5'), 'T', { rules: R(), count: hl(0) }).action === 'R' && BJ.decide(hand('T', '5'), 'T', { rules: R(), count: hl(-1) }).action === 'H');
check('Hi-Lo: 12 v 4 hits below 0', BJ.decide(hand('T', '2'), '4', { rules: R(), count: hl(-1) }).action === 'H');
check('Hi-Lo: 10 v A doubles at +4 S17 / +3 H17', BJ.decide(hand('6', '4'), 'A', { rules: R(), count: hl(4) }).action === 'D' && BJ.decide(hand('6', '4'), 'A', { rules: R(), count: hl(3) }).action === 'H' && BJ.decide(hand('6', '4'), 'A', { rules: R({ s17: false }), count: hl(3) }).action === 'D');
check('Hi-Lo: 11 v A H17 doubles at any count (basic)', BJ.decide(hand('6', '5'), 'A', { rules: R({ s17: false }), count: hl(-5) }).action === 'D');
check('Hi-Lo: 15 v A surrender S17 at +1 only; H17 at -1', BJ.decide(hand('T', '5'), 'A', { rules: R(), count: hl(1) }).action === 'R' && BJ.decide(hand('T', '5'), 'A', { rules: R(), count: hl(0) }).action === 'H' && BJ.decide(hand('T', '5'), 'A', { rules: R({ s17: false }), count: hl(-1) }).action === 'R' && BJ.decide(hand('T', '5'), 'A', { rules: R({ s17: false }), count: hl(-2) }).action === 'H');
check('Hi-Lo: insure at +3', BJ.decideInsurance(hl(3)).action === 'I' && BJ.decideInsurance(hl(2)).action === 'N');
check('Hi-Lo: ten-splits off unless enabled', BJ.decide(hand('T', 'T'), '6', { rules: R(), count: hl(6) }).action === 'S' && BJ.decide(hand('T', 'T'), '6', { rules: R(), count: Object.assign(hl(6), { tenSplits: true }) }).action === 'P');
check('True count truncates toward zero', BJ.trueCount(7, 2) === 3 && BJ.trueCount(-7, 2) === -3);

// --- Chart codes ---
check('Chart: soft 18 v 3 S17 = Ds', BJ.chartCell(hand('A', '7'), '3', R()).code === 'Ds');
check('Chart: 11 v 6 = Dh', BJ.chartCell(hand('6', '5'), '6', R()).code === 'Dh');
check('Chart: 16 v T LS = Rs (book p.56 footnote)', BJ.chartCell(hand('T', '6'), 'T', R()).code === 'Rs');
check('Chart: 15 v T LS = Rh', BJ.chartCell(hand('T', '5'), 'T', R()).code === 'Rh');

// --- tables8 data ---
const t8 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tables8.json'), 'utf8'));
global.window = globalThis; require(path.join(root, 'js', 'tables8.js'));
check('tables8.js matches extracted page (27 tables x 21 rows)', BJ.TABLES8.tables.length === 27 && BJ.TABLES8.tables.every((t, i) => t.rows.length === 21 && t.rows.every((r, j) => {
  const o = t8.tables[i].rows[j];
  return r[0] === o.score && r[1] === o.pen && r[2] === o.spread && r[3] === o.ev && r[4] === o.r20_5k.unit && r[9] === o.r025_100k.win100;
})));

// --- Simulation ---
if (process.argv.includes('--sim')) {
  const rules = R({ s17: true, das: true, ls: true, rsa: true, pen: 6.5 });
  function sim(system, rounds, seed) {
    const rng = BJ.rngFrom(seed);
    const shoe = new BJ.Shoe(8, rules.pen, rng);
    const counter = new BJ.Counter(8);
    let net = 0, wagered = 0;
    for (let r = 0; r < rounds; r++) {
      if (shoe.needsShuffle) { shoe.shuffle(); counter.reset(); }
      const ctx = counter.context(system, shoe);
      const bet = BJ.rampUnits(ctx);
      wagered += bet;
      const policy = (seat, h, up, o) => BJ.decide(h.cards, up, Object.assign({ rules, count: counter.context(system, shoe), fromSplit: h.fromSplit }, o)).action;
      net += BJ.playRoundHeadless(shoe, counter, rules, bet, policy, () => BJ.decideInsurance(counter.context(system, shoe)).action === 'I');
    }
    return { net, wagered, edge: net / wagered };
  }
  const N = Number((process.argv.find((a) => a.startsWith('--rounds=')) || '--rounds=3000000').split('=')[1]);
  const t0 = Date.now();
  const bs = sim('none', N, 1);
  console.log(`basic strategy, ${N.toLocaleString()} rounds: edge ${(bs.edge * 100).toFixed(3)}%  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check('Basic strategy edge is a small house edge (-0.75% .. -0.15%)', bs.edge < -0.0015 && bs.edge > -0.0075, (bs.edge * 100).toFixed(3) + '%');
  const t1 = Date.now();
  const rk8 = sim('reko', N, 2);
  console.log(`REKO + book 8D ramp (1-20), ${N.toLocaleString()} rounds: return on money bet ${(rk8.edge * 100).toFixed(3)}%  (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  check('REKO with the book ramp beats the game', rk8.edge > 0, (rk8.edge * 100).toFixed(3) + '%');
  const hl8 = sim('hilo', N, 3);
  console.log(`Hi-Lo + starter ramp (1-12), ${N.toLocaleString()} rounds: return on money bet ${(hl8.edge * 100).toFixed(3)}%`);
  check('Hi-Lo with the starter ramp beats the game', hl8.edge > 0, (hl8.edge * 100).toFixed(3) + '%');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.slice(0, 40).join('\n')); process.exit(1); }
