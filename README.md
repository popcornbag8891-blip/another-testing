# Sigil

Cast spells with your hands. Pinch thumb and index finger, draw a glyph in the
air, release. Your shaky stroke snaps into a perfect rune and the spell fires.

Everything runs in the browser: hand tracking (MediaPipe), rendering (three.js),
and every sound (Web Audio synthesis). Video never leaves the page.

## Run

getUserMedia needs a secure context, and `http://localhost` counts:

```bash
npx serve .
```

Then open the printed `http://localhost:3000`. Any static server works
(`python3 -m http.server` too). No build step; dependencies load from jsDelivr
at pinned versions (three 0.187.0, @mediapipe/tasks-vision 1.2.3).

## Glyphs

| Key | Glyph | Spell | Effect |
|---|---|---|---|
| 1 | Circle | **Lux** | Dawn floods the void; runestones light from within |
| 2 | Lightning ⚡ | **Fulgur** | Forked lightning strikes the runestones |
| 3 | Triangle | **Ignis** | A ring of fire roars up, heat haze, embers |
| 4 | Spiral | **Vortex** | Runestones spiral and re-form: arc → circle → grid → tower |
| 5 | Five-point star | **Astra** | Fog clears to stars, constellations, meteors |
| 6 | Wave | **Aria** | Generative ambient music; the world pulses to it. Cast again to stop |

Any direction works. Cast two spells within 4 s for a combo.

## Controls

- **Hand:** pinch to draw, release to cast. Fist while drawing cancels.
  Hold an open palm for 0.6 s to dispel everything.
  Hover the wand tip over a grimoire glyph or a runestone and pinch to cast it.
- **Mouse / touch:** press and drag to draw (automatic when no camera).
- **Keys:** `1`–`6` cast directly · `G` shows the next glyph's ghost · `Esc` dispels.

## Files

`main.js` loop and state machine · `hands.js` MediaPipe, pinch, One Euro filter ·
`recognizer.js` $1 recognizer and glyphs · `spells.js` spell registry ·
`fx/` world, trail, GPGPU particles, post · `audio.js` synthesis · `ui.js` interface.

`node tools/test-recognizer.mjs` stress-tests the recognizer with synthetic
noisy, rotated, reversed strokes.
