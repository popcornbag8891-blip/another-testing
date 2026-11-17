/* Everything the trainer "knows", in one place, with where it came from.
   Primary source: Norm Wattenberger, "Modern Blackjack" (2009), free online at www.qfit.com/book/.
   Page numbers below are the book's page numbers (ModernBlackjackPageN.htm). */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});

  // Basic strategy, 8 decks. Columns are dealer 2,3,4,5,6,7,8,9,T,A.
  // Transcribed from the book's colored tables (Chapter Zero, pp. 51-56) and verified cell by cell
  // against the extracted HTML in tests/fixtures/book-basic-strategy.json.
  const BASIC = {
    // p.51 "Surrender 4-8 Decks". 'R' = surrender. Only two-card hands, only as the first decision.
    surrender: {
      S17: { 17: '----------', 16: '-------RRR', 15: '--------R-', 14: '----------', '8,8': '----------' },
      H17: { 17: '---------R', 16: '-------RRR', 15: '--------RR', 14: '----------', '8,8': '---------R' },
    },
    // p.52 "Split DAS" / "Split nDAS". 'P' = split.
    split: {
      DAS:  { A: 'PPPPPPPPPP', T: '----------', 9: 'PPPPP-PP--', 8: 'PPPPPPPPPP', 7: 'PPPPPP----', 6: 'PPPPP-----', 5: '----------', 4: '---PP-----', 3: 'PPPPPP----', 2: 'PPPPPP----' },
      nDAS: { A: 'PPPPPPPPPP', T: '----------', 9: 'PPPPP-PP--', 8: 'PPPPPPPPPP', 7: 'PPPPPP----', 6: '-PPPP-----', 5: '----------', 4: '----------', 3: '--PPPP----', 2: '--PPPP----' },
    },
    // pp.53-54 "Soft Double 2-8 Decks". Keyed by the non-ace card (A,8 = 8). 'D' = double.
    softDouble: {
      S17: { 8: '----------', 7: '-DDDD-----', 6: '-DDDD-----', 5: '--DDD-----', 4: '--DDD-----', 3: '---DD-----', 2: '---DD-----' },
      H17: { 8: '----D-----', 7: 'DDDDD-----', 6: '-DDDD-----', 5: '--DDD-----', 4: '--DDD-----', 3: '---DD-----', 2: '---DD-----' },
    },
    // p.55 "Hard Double 3-8 Decks S17"; footnote: with H17 also double 11 v A.
    hardDouble: {
      S17: { 11: 'DDDDDDDDD-', 10: 'DDDDDDDD--', 9: '-DDDD-----', 8: '----------' },
      H17: { 11: 'DDDDDDDDDD', 10: 'DDDDDDDD--', 9: '-DDDD-----', 8: '----------' },
    },
    // p.56 "Soft Hit/Stand" and "Hard Hit/Stand". 'H' = hit, 'S' = stand.
    softHS: { 19: 'SSSSSSSSSS', 18: 'SSSSSSSHHH', 17: 'HHHHHHHHHH' },
    hardHS: { 17: 'SSSSSSSSSS', 16: 'SSSSSHHHHH', 15: 'SSSSSHHHHH', 14: 'SSSSSHHHHH', 13: 'SSSSSHHHHH', 12: 'HHSSSHHHHH' },
  };

  // Why each table says what it says, in the book's own reasoning (paraphrased, pp.50-58).
  const WHY = {
    insurance: 'Basic strategy never insures. About nine times in thirteen the dealer does not have a ten underneath, and 2:1 is not enough. Even money is the same bet (p.50).',
    surrender: 'Surrender only when you would lose more than half a bet on average by playing the hand. With H17 the dealer has an extra chance to improve a soft hand, so a few more hands surrender against an ace.',
    split: 'Always split aces and 8s: 16 is a terrible hand, and against a ten you are hoping to push. Never split 5s (double the 10) or tens. 9s split except against 7, 10 and A.',
    splitNoDAS: 'Without double after split you split less often, because you lose the chance to double the new hands: no 4s, no 2s/3s against 2 or 3, no 6s against 2.',
    softDouble: 'Soft doubles go against the dealer\'s weakest cards, 3 through 6. The two H17 additions (A,7 v 2 and A,8 v 6) are close plays.',
    hardDouble: 'Double 11 against everything but an ace (H17: the ace too), 10 against 2-9, and 9 against 3-6.',
    softHS: 'Hit soft 18 against 9, 10 and ace: the dealer is likely to beat 18 and you cannot bust.',
    hardHS: 'Hit every stiff (12-16) against 7 through ace because the dealer probably has a made hand. Stand against 2-6 because the dealer is likely to bust, except hit 12 against 2 or 3.',
    lone16vT: 'With surrender offered, a 16 that reaches the hit/stand table against a ten has three or more cards or came from a split, so small cards are depleted: stand. The difference is tiny, about .002%.',
    hard17: 'Hard 17 or more always stands.',
    hardLow: 'Eleven or less cannot bust on one card: hit (when doubling is not the play or not allowed).',
    softHigh: 'Soft 19 and up stands.',
    softLow: 'Soft 17 or less always hits: no single card can bust you, and 17 or less rarely wins.',
    noSplitT: 'Never split tens: 20 already beats most dealer hands.',
    noSplit5: 'Never split 5s: play them as a hard 10.',
    noSplit: 'Not a split against this card, so play the total.',
  };

  // ---------------- Counting systems ----------------
  const SYSTEMS = {
    none: { id: 'none', name: 'Basic strategy only', tags: null },
    reko: {
      id: 'reko',
      name: 'REKO',
      // p.69: 2-7 = +1, 8-9 = 0, 10/A = -1.
      tags: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 0, T: -1, A: -1 },
      // p.71 Initial Running Count by decks.
      irc: { 1: -1, 2: -5, 4: -12, 6: -20, 8: -27 },
      pivot: 2, // p.73: all variations and insurance at a running count of +2 or higher.
      // p.72 "Eight-Deck Betting Ramp" (dollars, $5 unit): RC <=-4,-3,-2,-1,0,1,2,3,4,5,>=6
      ramp8: { counts: [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6], dollars: [5, 10, 20, 25, 25, 50, 50, 50, 75, 75, 100] },
      deckSum: 4, // p.78: the 52 tags sum to +4
    },
    hilo: {
      id: 'hilo',
      name: 'Hi-Lo',
      tags: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, T: -1, A: -1 },
      irc: { 8: 0 },
      deckSum: 0,
    },
  };

  // REKO playing variations at RC >= +2 (p.73, "All Games"), with the eight-deck change on p.74:
  // "We remove the 12v4 variation and just use Basic Strategy for this play."
  const REKO_VARIATIONS = [
    { kind: 'sur', total: 15, up: '9' }, { kind: 'sur', total: 15, up: 'A' }, { kind: 'sur', pair: '8', up: 'T' }, { kind: 'sur', total: 14, up: 'T' },
    { kind: 'dbl', total: 11, up: 'A' }, { kind: 'dbl', total: 10, up: 'A' }, { kind: 'dbl', total: 10, up: 'T' },
    { kind: 'dbl', total: 9, up: '2' }, { kind: 'dbl', total: 9, up: '7' }, { kind: 'dbl', total: 8, up: '5' }, { kind: 'dbl', total: 8, up: '6' },
    { kind: 'dbl', soft: 19, up: '5' }, { kind: 'dbl', soft: 19, up: '6' },
    { kind: 'hs', total: 16, up: 'T' }, { kind: 'hs', total: 15, up: 'T' }, { kind: 'hs', total: 12, up: '2' }, { kind: 'hs', total: 12, up: '3' },
  ];

  // Hi-Lo indexes. The book's Hi-Lo results (including the 8-deck tables) use the
  // "Sweet 16 and Fab 4" (p.189, p.282): Don Schlesinger's Illustrious 18 minus the two ten-splits,
  // plus the four surrender indexes, as published in Blackjack Attack. The values are not printed in
  // Modern Blackjack itself; these are the widely published multi-deck values. True count, truncated.
  // at = take the play at TC >= at. Where H17 differs, h17 gives the H17 index (null = basic play at every count).
  const HILO_INDEXES = [
    { id: '16vT', kind: 'hs', total: 16, up: 'T', at: 0, play: 'S', label: '16 v 10: stand' },
    { id: '15vT', kind: 'hs', total: 15, up: 'T', at: 4, play: 'S', label: '15 v 10: stand' },
    { id: '10vT', kind: 'dbl', total: 10, up: 'T', at: 4, play: 'D', label: '10 v 10: double' },
    { id: '12v3', kind: 'hs', total: 12, up: '3', at: 2, play: 'S', label: '12 v 3: stand' },
    { id: '12v2', kind: 'hs', total: 12, up: '2', at: 3, play: 'S', label: '12 v 2: stand' },
    { id: '11vA', kind: 'dbl', total: 11, up: 'A', at: 1, h17: null, play: 'D', label: '11 v A: double' },
    { id: '9v2', kind: 'dbl', total: 9, up: '2', at: 1, play: 'D', label: '9 v 2: double' },
    { id: '10vA', kind: 'dbl', total: 10, up: 'A', at: 4, h17: 3, play: 'D', label: '10 v A: double' },
    { id: '9v7', kind: 'dbl', total: 9, up: '7', at: 3, play: 'D', label: '9 v 7: double' },
    { id: '16v9', kind: 'hs', total: 16, up: '9', at: 5, play: 'S', label: '16 v 9: stand' },
    { id: '13v2', kind: 'hs', total: 13, up: '2', at: -1, play: 'S', label: '13 v 2: stand' },
    { id: '12v4', kind: 'hs', total: 12, up: '4', at: 0, play: 'S', label: '12 v 4: stand' },
    { id: '12v5', kind: 'hs', total: 12, up: '5', at: -2, play: 'S', label: '12 v 5: stand' },
    { id: '12v6', kind: 'hs', total: 12, up: '6', at: -1, play: 'S', label: '12 v 6: stand' },
    { id: '13v3', kind: 'hs', total: 13, up: '3', at: -2, play: 'S', label: '13 v 3: stand' },
    // Fab 4 (late surrender)
    { id: 'R14vT', kind: 'sur', total: 14, up: 'T', at: 3, play: 'R', label: '14 v 10: surrender', fab4: true },
    { id: 'R15vT', kind: 'sur', total: 15, up: 'T', at: 0, play: 'R', label: '15 v 10: surrender', fab4: true },
    { id: 'R15v9', kind: 'sur', total: 15, up: '9', at: 2, play: 'R', label: '15 v 9: surrender', fab4: true },
    { id: 'R15vA', kind: 'sur', total: 15, up: 'A', at: 1, h17: -1, play: 'R', label: '15 v A: surrender', fab4: true },
    // The two ten-splits from the full Illustrious 18. Off by default; the book leaves them out (p.189).
    { id: 'TTv5', kind: 'split', pair: 'T', up: '5', at: 5, play: 'P', label: '10,10 v 5: split', tenSplit: true },
    { id: 'TTv6', kind: 'split', pair: 'T', up: '6', at: 4, play: 'P', label: '10,10 v 6: split', tenSplit: true },
  ];
  const HILO_INSURANCE = 3;

  // A starter Hi-Lo ramp. NOT from the book: the book's Hi-Lo numbers use optimal ramps computed
  // by its simulator. This is a common "units grow with true count" schedule; edit it in Settings.
  const HILO_DEFAULT_RAMP = { counts: [1, 2, 3, 4, 5, 6], units: [1, 2, 4, 6, 8, 12] };

  // CODE colors from p.282: Red 0-20, Amber 20.01-30, Blue 30.01-50, Green above 50.
  function codeFor(score) {
    if (score > 50) return 'green';
    if (score > 30) return 'blue';
    if (score > 20) return 'amber';
    return 'red';
  }

  const SOURCES = [
    { label: 'Modern Blackjack, Norm Wattenberger (2009), full text', url: 'https://www.qfit.com/book/' },
    { label: 'Eight-Deck tables (SCORE / EV / win rates)', url: 'https://www.qfit.com/book/tables8.htm' },
    { label: 'Chapter Zero: Basic Strategy (pp.49-66)', url: 'https://www.qfit.com/book/ModernBlackjackPage49.htm' },
    { label: 'Chapter +1: REKO card counting (pp.67-84)', url: 'https://www.qfit.com/book/ModernBlackjackPage67.htm' },
    { label: 'Chapter +13: Tables of Tables, how to read them (pp.281-283)', url: 'https://www.qfit.com/book/ModernBlackjackPage281.htm' },
  ];

  Object.assign(BJ, { BASIC, WHY, SYSTEMS, REKO_VARIATIONS, HILO_INDEXES, HILO_INSURANCE, HILO_DEFAULT_RAMP, codeFor, SOURCES });
  if (typeof module !== 'undefined' && module.exports) module.exports = BJ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
