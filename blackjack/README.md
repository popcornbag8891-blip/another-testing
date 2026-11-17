# Eight-Deck Coach

An eight-deck blackjack trainer built on Norm Wattenberger's *Modern Blackjack*
(free at [qfit.com/book](https://www.qfit.com/book/)). It teaches basic strategy, then
card counting with the book's own REKO count or Hi-Lo, and it grades every decision,
every bet and every count against the book.

No server, no build step, no account. Progress is saved in your browser.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

For a single file you can copy anywhere (phone, USB stick, Replit static page):

```bash
node tools/build-single.js
```

That writes `dist/eight-deck-coach.html` with all CSS and JS inlined.

## What is in it

| Section | What it does |
| --- | --- |
| **Table** | An 8-deck shoe with a cut card, a burn card and 0 to 4 other players who play basic strategy. Supports insurance, peeking, late surrender, splits to 4 hands, resplitting aces and DAS. The coach checks every decision and explains it with the book page. You can set it to stop you on a mistake or let your move ride. It grades your bet against the ramp, asks for the count at the end of each shoe, and can deal payout errors for you to catch, as in the book's dealer-error drill. |
| **Drills** | Strategy flashcards, weighted toward the cells you miss. Count plays at counts near each switch point. Running count. Deck countdown, using the book's "name the last card" trick. Full-table sweep. True count read from the discard tray. Bet ramp. Add-up hands. |
| **Chart** | The full strategy chart for your exact rules, drawn by the same engine that grades you. REKO or Hi-Lo badges can be overlaid, and your misses are circled. |
| **Game Scout** | The book's 8-deck tables: SCORE, edge, unit size and win per 100 hands for REKO, FELT and Hi-Lo, across 9 rule sets, 7 penetrations, 3 spreads and 3 bankroll/risk levels. |
| **Progress** | Accuracy by table, weak cells, session history and drill history. Export and import as text. |
| **Playbook** | The book condensed: training path, REKO card, Hi-Lo card, rules glossary, sources. |

Rules are configurable: S17/H17, DAS, late surrender, resplit aces, and penetration from 5.5 to 7 of 8 decks.

## Where the strategy comes from

* **Basic strategy**: the book's tables (Chapter Zero, pp.51-56). `tests/fixtures/book-basic-strategy.json`
  is extracted straight from the cell colors in the book's HTML. The test suite checks the engine
  against every cell, under every rule combination they cover (953 checks).
* **REKO**: tags (2-7 = +1, 8-9 = 0, 10/A = −1), IRC −27 for eight decks, the 8-deck betting ramp,
  insurance and all variations at RC +2, and the 8-deck removal of 12 v 4 (pp.69-74).
* **Hi-Lo**: the book's Hi-Lo results use the "Sweet 16 and Fab 4". The book names that index set
  but does not print its values. The values used here are the widely published multi-deck
  Illustrious 18 / Fab 4 numbers (Schlesinger, *Blackjack Attack*). The Hi-Lo bet ramp is an
  editable starter ramp and is **not** from the book.
* **Game Scout**: `tests/fixtures/tables8.json` is extracted from
  [tables8.htm](https://www.qfit.com/book/tables8.htm). `js/tables8.js` is generated from it
  with `node tools/build-tables8.js`.

## Tests

```bash
node tests/run.js          # strategy vs the book, count rules, data integrity
node tests/run.js --sim    # adds 3M-round simulations per system (about 15s)
```

Sample run (8 decks, S17, DAS, LS, RSA, 6.5/8, 3M rounds each):

* Basic strategy: −0.28% (house edge, about ±0.13% at 95%)
* REKO with the book's 1-20 ramp: +1.26% on money bet. The book lists +1.34% for this game with an optimal ramp.
* Hi-Lo with the starter ramp: +0.74%.

## Compared with blackjack-coach-ai.replit.app

The earlier app's chart matched the book for S17/DAS/LS, but it was fixed to that one rule set and
depended on a server to deal and coach. This version runs entirely in the browser and handles every
rule combination the book covers. It adds REKO and true-count Hi-Lo play with indexes, grades bets
and counts, has eight drills and game ratings from the book's data, and is tested against the
book's tables.
