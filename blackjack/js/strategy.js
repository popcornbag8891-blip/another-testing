/* The decision engine. One function, decide(), grades every play in the trainer and draws every chart,
   so the chart and the coach can never disagree. Decision order follows the book (p.50):
   insurance -> surrender -> split -> double -> hit/stand. */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});
  const { COLS, evaluate, BASIC, WHY, REKO_VARIATIONS, HILO_INDEXES, HILO_INSURANCE } = BJ;

  const DEFAULT_RULES = { decks: 8, s17: true, das: true, ls: true, rsa: true, maxHands: 4, pen: 6.5 };
  const ACTION_NAMES = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender', I: 'Insure', N: 'No insurance' };

  const col = (up) => COLS.indexOf(up);
  const cell = (rowStr, up) => (rowStr ? rowStr[col(up)] : '-');
  const upName = (up) => (up === 'T' ? '10' : up);

  /** Count context: { system: 'none'|'reko'|'hilo', rc, tc, tenSplits } */
  function countValue(count) {
    if (!count || count.system === 'none') return null;
    return count.system === 'reko' ? count.rc : count.tc;
  }

  function hiloIndex(dev, rules) {
    if (!rules.s17 && 'h17' in dev) return dev.h17; // may be null: basic play at every count
    return dev.at;
  }

  /** Find the count rule that governs this (kind, hand, up) situation, if any. */
  function findDeviation(kind, sit, up, rules, count) {
    if (!count || count.system === 'none') return null;
    if (count.system === 'reko') {
      const v = REKO_VARIATIONS.find((d) => d.kind === kind && d.up === up &&
        (d.pair ? sit.pair === d.pair : d.soft ? sit.soft && sit.total === d.soft : !sit.soft && d.total === sit.total && !(kind === 'sur' && sit.pair === '8')));
      if (!v) return null;
      return { system: 'reko', at: BJ.SYSTEMS.reko.pivot, play: kind === 'sur' ? 'R' : kind === 'dbl' ? 'D' : 'S', label: labelFor(kind, sit, up), metric: 'RC' };
    }
    const d = HILO_INDEXES.find((x) => x.kind === kind && x.up === up &&
      (x.pair ? sit.pair === x.pair : !sit.soft && x.total === sit.total && !(kind === 'sur' && sit.pair === '8')));
    if (!d) return null;
    if (d.tenSplit && !count.tenSplits) return null;
    const at = hiloIndex(d, rules);
    if (at === null) return null;
    return { system: 'hilo', id: d.id, at, play: d.play, label: d.label, metric: 'TC' };
  }

  function labelFor(kind, sit, up) {
    const hand = sit.pair ? `${upName(sit.pair)},${upName(sit.pair)}` : sit.soft ? `soft ${sit.total}` : `${sit.total}`;
    const verb = { sur: 'surrender', dbl: 'double', hs: 'stand', split: 'split' }[kind];
    return `${hand} v ${upName(up)}: ${verb}`;
  }

  // ----- the six basic tables -----
  function basicSurrender(sit, up, rules) {
    const t = BASIC.surrender[rules.s17 ? 'S17' : 'H17'];
    if (sit.soft) return false;
    if (sit.pair === '8') return cell(t['8,8'], up) === 'R';
    return cell(t[sit.total], up) === 'R';
  }
  function basicSplit(sit, up, rules) {
    return cell(BASIC.split[rules.das ? 'DAS' : 'nDAS'][sit.pair], up) === 'P';
  }
  function basicDouble(sit, up, rules) {
    const key = rules.s17 ? 'S17' : 'H17';
    if (sit.soft) return cell(BASIC.softDouble[key][sit.total - 11], up) === 'D';
    return cell(BASIC.hardDouble[key][sit.total], up) === 'D';
  }
  function basicHS(sit, up, rules, ctx) {
    if (sit.soft) {
      if (sit.total >= 19) return 'S';
      if (sit.total <= 17) return 'H';
      return cell(BASIC.softHS[18], up);
    }
    if (sit.total >= 17) return 'S';
    if (sit.total <= 11) return 'H';
    // p.56 footnote: with surrender offered, a 16 that reaches this table against a ten stands.
    if (sit.total === 16 && up === 'T' && rules.ls && ctx.reachedTableAfterSurrenderWindow) return 'S';
    return cell(BASIC.hardHS[sit.total], up);
  }

  /** Describe a hand for strategy lookup. */
  function situation(cards) {
    const { total, soft } = evaluate(cards);
    const pair = cards.length === 2 && cards[0].key === cards[1].key ? cards[0].key : null;
    return { total, soft, pair, n: cards.length };
  }

  /**
   * decide(cards, up, opts) -> { action, basic, table, why, deviation }
   * opts: { rules, canDouble, canSplit, canSurrender, fromSplit, count }
   */
  function decide(cards, up, opts) {
    const rules = Object.assign({}, DEFAULT_RULES, opts.rules || {});
    const sit = situation(cards);
    const count = opts.count || null;
    const cv = countValue(count);
    const canDouble = opts.canDouble !== undefined ? opts.canDouble : cards.length === 2;
    const canSplit = opts.canSplit !== undefined ? opts.canSplit : !!sit.pair;
    const canSurrender = opts.canSurrender !== undefined ? opts.canSurrender : rules.ls && cards.length === 2 && !opts.fromSplit;
    const result = (action, basic, table, why, deviation) => ({ action, basic, table, why, deviation: deviation || null, sit });

    // Applies a count rule to a yes/no basic decision. Returns { yes, dev }.
    const withCount = (kind, basicYes) => {
      const dev = findDeviation(kind, sit, up, rules, count);
      if (!dev || cv === null) return { yes: basicYes, dev: null };
      if (count.system === 'reko') {
        // REKO plays basic strategy below +2 and adds the variation at +2 or higher.
        const yes = basicYes || cv >= dev.at;
        return { yes, dev: yes !== basicYes ? Object.assign(dev, { applied: true }) : Object.assign(dev, { applied: false }) };
      }
      const yes = cv >= dev.at;
      return { yes, dev: Object.assign(dev, { applied: yes !== basicYes }) };
    };

    if (sit.total > 21) return result('S', 'S', 'bust', 'Busted.');
    if (sit.total === 21) return result('S', 'S', sit.soft ? 'softHS' : 'hardHS', 'Twenty-one stands.');
    let surDev = null; // set when the count talks us out of a basic-strategy surrender

    // 1. Surrender
    if (canSurrender) {
      const b = basicSurrender(sit, up, rules);
      const { yes, dev } = withCount('sur', b);
      if (yes) return result('R', b ? 'R' : null, 'surrender', WHY.surrender, dev);
      if (dev && dev.applied) surDev = dev;
    }
    // 2. Split
    if (sit.pair && canSplit) {
      const b = basicSplit(sit, up, rules);
      const { yes, dev } = withCount('split', b);
      if (yes) return result('P', b ? 'P' : null, 'split', rules.das ? WHY.split : WHY.splitNoDAS, dev);
    }
    // 3. Double
    if (canDouble) {
      const b = basicDouble(sit, up, rules);
      const { yes, dev } = withCount('dbl', b);
      if (yes) return result('D', b ? 'D' : null, sit.soft ? 'softDouble' : 'hardDouble', (sit.pair === '5' && canSplit ? WHY.noSplit5 + ' ' : '') + (sit.soft ? WHY.softDouble : WHY.hardDouble), dev);
    }
    // 4. Hit / stand
    const ctx = { reachedTableAfterSurrenderWindow: !canSurrender };
    const bHS = basicHS(sit, up, rules, ctx);
    let action = bHS, dev = null;
    if (!sit.soft) {
      const r = withCount('hs', bHS === 'S');
      action = r.yes ? 'S' : 'H';
      dev = r.dev;
    }
    let why = sit.soft ? (sit.total >= 19 ? WHY.softHigh : sit.total <= 17 ? WHY.softLow : WHY.softHS)
      : (sit.total >= 17 ? WHY.hard17 : sit.total <= 11 ? WHY.hardLow : WHY.hardHS);
    if (!sit.soft && sit.total === 16 && up === 'T' && rules.ls && ctx.reachedTableAfterSurrenderWindow) why = WHY.lone16vT;
    if (sit.pair && canSplit) why = (sit.pair === 'T' ? WHY.noSplitT : sit.pair === '5' ? WHY.noSplit5 : WHY.noSplit) + ' ' + why;
    // If the count talked us out of a basic surrender, report that deviation.
    if ((!dev || !dev.applied) && surDev) dev = surDev;
    // Basic answer for this exact situation (to show "basic says X, count says Y").
    let basicAction = bHS;
    if (canSurrender && basicSurrender(sit, up, rules)) basicAction = 'R';
    else if (sit.pair && canSplit && basicSplit(sit, up, rules)) basicAction = 'P';
    else if (canDouble && basicDouble(sit, up, rules)) basicAction = 'D';
    return result(action, basicAction, sit.soft ? 'softHS' : 'hardHS', why, dev);
  }

  /** Insurance decision. */
  function decideInsurance(count) {
    if (!count || count.system === 'none') return { action: 'N', why: WHY.insurance, deviation: null };
    if (count.system === 'reko') {
      const yes = count.rc >= BJ.SYSTEMS.reko.pivot;
      return { action: yes ? 'I' : 'N', why: yes ? 'REKO insures at a running count of +2 or higher: the shoe is rich in tens (p.73).' : 'REKO insures only at a running count of +2 or higher (p.73).', deviation: { system: 'reko', at: 2, metric: 'RC', label: 'Insurance', applied: yes } };
    }
    const yes = count.tc >= HILO_INSURANCE;
    return { action: yes ? 'I' : 'N', why: yes ? 'Hi-Lo insures at a true count of +3 or higher.' : 'Hi-Lo insures only at a true count of +3 or higher.', deviation: { system: 'hilo', at: HILO_INSURANCE, metric: 'TC', label: 'Insurance', applied: yes } };
  }

  /** What to show in a combined chart cell: primary action plus fallback when it is not allowed. */
  function chartCell(cards, up, rules, count) {
    const full = decide(cards, up, { rules, count });
    let code = full.action;
    if (full.action === 'D') {
      const fb = decide(cards, up, { rules, count, canDouble: false, canSurrender: false });
      code = fb.action === 'S' ? 'Ds' : 'Dh';
    } else if (full.action === 'R') {
      const fb = decide(cards, up, { rules, count, canSurrender: false });
      code = 'R' + fb.action.toLowerCase();
    }
    return { code, d: full };
  }

  /** Units to bet. REKO: the book's 8-deck ramp ($5 unit). Hi-Lo: the editable ramp. */
  function rampUnits(count, hiloRamp) {
    if (!count || count.system === 'none') return 1;
    if (count.system === 'reko') {
      const r = BJ.SYSTEMS.reko.ramp8;
      const rc = Math.max(r.counts[0], Math.min(r.counts[r.counts.length - 1], count.rc));
      return r.dollars[r.counts.indexOf(rc)] / 5;
    }
    const r = hiloRamp || BJ.HILO_DEFAULT_RAMP;
    let u = 1;
    for (let i = 0; i < r.counts.length; i++) if (count.tc >= r.counts[i]) u = r.units[i];
    return u;
  }

  function trueCount(rc, decksRemaining) {
    return Math.trunc(rc / Math.max(0.5, decksRemaining));
  }

  Object.assign(BJ, { DEFAULT_RULES, ACTION_NAMES, decide, decideInsurance, chartCell, situation, rampUnits, trueCount, upName });
  if (typeof module !== 'undefined' && module.exports) module.exports = BJ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
