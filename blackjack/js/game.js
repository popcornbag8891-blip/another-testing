/* Round engine shared by the live table and the headless simulator used in the tests.
   US rules: dealer takes a hole card and peeks for blackjack with an ace or ten up. */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});
  const { evaluate, isBlackjack, SYSTEMS } = BJ;

  /** Running counts for both systems at once; the UI shows whichever is selected. */
  class Counter {
    constructor(decks) { this.decks = decks; this.reset(); }
    reset() {
      this.rc = { reko: SYSTEMS.reko.irc[this.decks] ?? 0, hilo: 0 };
      this.seen = 0;
      this.tens = 0; this.aces = 0;
    }
    see(card) {
      this.rc.reko += SYSTEMS.reko.tags[card.key];
      this.rc.hilo += SYSTEMS.hilo.tags[card.key];
      this.seen++;
      if (card.key === 'T') this.tens++;
      if (card.key === 'A') this.aces++;
    }
    /** Count context for decide(): { system, rc, tc } */
    context(system, shoe, tenSplits) {
      if (system === 'none') return { system: 'none' };
      const rc = this.rc[system];
      const decksLeft = shoe ? shoe.decksRemainingHalf : this.decks;
      return { system, rc, tc: BJ.trueCount(rc, decksLeft), decksLeft, tenSplits: !!tenSplits };
    }
  }

  function newHand(cards, bet, extra) {
    return Object.assign({ cards, bet, doubled: false, fromSplit: false, splitAces: false, done: false, surrendered: false, result: null, net: 0 }, extra || {});
  }

  function canDouble(seat, hand, rules) {
    if (hand.done || hand.cards.length !== 2 || hand.splitAces) return false;
    if (hand.fromSplit && !rules.das) return false;
    return evaluate(hand.cards).total < 21;
  }
  function canSplit(seat, hand, rules) {
    if (hand.done || hand.cards.length !== 2 || hand.cards[0].key !== hand.cards[1].key) return false;
    if (seat.hands.length >= rules.maxHands) return false;
    if (hand.splitAces && !rules.rsa) return false;
    return true;
  }
  function canSurrender(seat, hand, rules) {
    return !!rules.ls && seat.hands.length === 1 && hand.cards.length === 2 && !hand.fromSplit && !hand.done;
  }

  /** Dealer draws to 17; hits soft 17 when the rules say H17. */
  function dealerShouldHit(cards, rules) {
    const { total, soft } = evaluate(cards);
    return total < 17 || (total === 17 && soft && !rules.s17);
  }

  /** Settle one hand against the dealer. Returns net in bets (e.g. +1.5, -2). */
  function settleHand(hand, dealerCards) {
    const p = evaluate(hand.cards), d = evaluate(dealerCards);
    const stake = hand.bet * (hand.doubled ? 2 : 1);
    const dealerBJ = isBlackjack(dealerCards, false);
    const playerBJ = isBlackjack(hand.cards, hand.fromSplit);
    let result, net;
    if (hand.surrendered) { result = 'surrender'; net = -hand.bet / 2; }
    else if (p.total > 21) { result = 'bust'; net = -stake; }
    else if (playerBJ && !dealerBJ) { result = 'blackjack'; net = hand.bet * 1.5; }
    else if (dealerBJ && playerBJ) { result = 'push'; net = 0; }
    else if (dealerBJ) { result = 'lose'; net = -stake; }
    else if (d.total > 21) { result = 'win'; net = stake; }
    else if (p.total > d.total) { result = 'win'; net = stake; }
    else if (p.total < d.total) { result = 'lose'; net = -stake; }
    else { result = 'push'; net = 0; }
    hand.result = result; hand.net = net;
    return net;
  }

  /**
   * Headless round for simulation/testing. policy(seat, hand, dealerUp, opts) -> 'H'|'S'|'D'|'P'|'R'.
   * insurancePolicy() -> boolean. Returns total net in units for the seat.
   */
  function playRoundHeadless(shoe, counter, rules, bet, policy, insurancePolicy) {
    const see = (c) => { counter.see(c); return c; };
    const seat = { hands: [] };
    const p1 = see(shoe.draw()), up = see(shoe.draw()), p2 = see(shoe.draw()), hole = shoe.draw();
    const dealer = [up, hole];
    seat.hands.push(newHand([p1, p2], bet));
    let net = 0;
    if (up.key === 'A' && insurancePolicy && insurancePolicy()) {
      net += isBlackjack(dealer) ? bet : -bet / 2; // insurance costs half the bet, pays 2:1
    }
    if ((up.key === 'A' || up.key === 'T') && isBlackjack(dealer)) {
      see(hole);
      return net + settleHand(seat.hands[0], dealer);
    }
    for (let i = 0; i < seat.hands.length; i++) {
      const hand = seat.hands[i];
      if (hand.fromSplit && hand.cards.length === 1) hand.cards.push(see(shoe.draw()));
      while (!hand.done) {
        const v = evaluate(hand.cards).total;
        if (v >= 21 || (hand.splitAces && !(canSplit(seat, hand, rules)))) { hand.done = true; break; }
        const a = policy(seat, hand, up.key, {
          canDouble: canDouble(seat, hand, rules), canSplit: canSplit(seat, hand, rules), canSurrender: canSurrender(seat, hand, rules),
        });
        if (a === 'R') { hand.surrendered = true; hand.done = true; }
        else if (a === 'S') hand.done = true;
        else if (a === 'H') hand.cards.push(see(shoe.draw()));
        else if (a === 'D') { hand.doubled = true; hand.cards.push(see(shoe.draw())); hand.done = true; }
        else if (a === 'P') {
          const aces = hand.cards[0].key === 'A';
          const second = newHand([hand.cards.pop()], hand.bet, { fromSplit: true, splitAces: aces });
          hand.fromSplit = true; hand.splitAces = aces;
          hand.cards.push(see(shoe.draw()));
          seat.hands.splice(i + 1, 0, second);
          if (aces && !(rules.rsa && hand.cards[1].key === 'A')) { hand.done = true; }
        }
      }
    }
    see(hole);
    const live = seat.hands.some((h) => !h.surrendered && evaluate(h.cards).total <= 21);
    if (live) while (dealerShouldHit(dealer, rules)) dealer.push(see(shoe.draw()));
    for (const h of seat.hands) net += settleHand(h, dealer);
    return net;
  }

  Object.assign(BJ, { Counter, newHand, canDouble, canSplit, canSurrender, dealerShouldHit, settleHand, playRoundHeadless });
  if (typeof module !== 'undefined' && module.exports) module.exports = BJ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
