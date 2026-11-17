/* Cards, shoe and hand math. Classic script: attaches to globalThis.BJ (works in a browser,
   from file://, and under Node for the tests). */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const COLS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A']; // dealer upcard columns, book order

  /** Strategy key of a rank: '2'..'9', 'T' for any ten-value card, 'A'. */
  function keyOf(rank) {
    if (rank === 'A') return 'A';
    if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 'T';
    return rank;
  }
  function valueOf(rank) {
    const k = keyOf(rank);
    return k === 'A' ? 11 : k === 'T' ? 10 : Number(k);
  }
  function makeCard(rank, suit) {
    return { rank, suit: suit || SUITS[0], key: keyOf(rank), v: valueOf(rank) };
  }
  /** Card from a strategy key, with a random face for tens and a random suit. */
  function cardFromKey(k, rng) {
    rng = rng || Math.random;
    let rank = k;
    if (k === 'T') rank = ['10', 'J', 'Q', 'K'][Math.floor(rng() * 4)];
    return makeCard(rank, SUITS[Math.floor(rng() * 4)]);
  }

  /** Hand total. soft = an ace is still counted as 11. */
  function evaluate(cards) {
    let total = 0, aces = 0;
    for (const c of cards) { total += c.key === 'A' ? 1 : c.v; if (c.key === 'A') aces++; }
    let soft = false;
    if (aces && total + 10 <= 21) { total += 10; soft = true; }
    return { total, soft };
  }
  function isBlackjack(cards, fromSplit) {
    return !fromSplit && cards.length === 2 && evaluate(cards).total === 21;
  }
  function isPair(cards) { return cards.length === 2 && cards[0].key === cards[1].key; }

  /** Seeded RNG (mulberry32) so drills and tests can be reproducible. */
  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Multi-deck shoe with a cut card. Penetration is given in decks dealt (e.g. 6.5 of 8). */
  class Shoe {
    constructor(decks, penDecks, rng) {
      this.decks = decks; this.penDecks = penDecks; this.rng = rng || Math.random;
      this.shuffle();
    }
    shuffle() {
      const cards = [];
      for (let d = 0; d < this.decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push(makeCard(r, s));
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      this.cards = cards; this.pos = 0;
      // Cut card placement varies a little from shoe to shoe, like a real dealer's cut.
      const jitter = Math.round((this.rng() - 0.5) * 26);
      this.cutAt = Math.min(cards.length - 30, Math.max(52, Math.round(this.penDecks * 52) + jitter));
      this.burned = this.draw(); // burn card: dealt face down, never seen by the player
      this.needsShuffle = false;
    }
    draw() {
      if (this.pos >= this.cards.length) { this.shuffle(); }
      const c = this.cards[this.pos++];
      if (this.pos >= this.cutAt) this.needsShuffle = true;
      return c;
    }
    get remaining() { return this.cards.length - this.pos; }
    get dealt() { return this.pos; }
    /** Decks remaining rounded to the nearest half deck (min 0.5), the resolution counters use. */
    get decksRemainingHalf() { return Math.max(0.5, Math.round((this.remaining / 52) * 2) / 2); }
  }

  Object.assign(BJ, { RANKS, SUITS, COLS, keyOf, valueOf, makeCard, cardFromKey, evaluate, isBlackjack, isPair, rngFrom, Shoe });
  if (typeof module !== 'undefined' && module.exports) module.exports = BJ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
