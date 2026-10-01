# Derelict station: design

An online puzzle, played alone and at the player's own pace on phone or
desktop. The player scans a dark room on a derelict sci-fi station, finds
failing systems, and repairs each one with a circuit puzzle. Getting every
system running is the win.

## The loop

1. **Scan.** A scanner lens sweeps a pixel-art scene. Hidden systems show up
   only under the lens, as a heat reading drawn over the scene.
2. **Open.** Selecting a revealed system opens its circuit panel over the
   scene.
3. **Repair.** Solving the panel plays that system's outcome in the scene
   (animated) and makes the next system reachable.

Systems flow into each other in a fixed order. Solving one gives access to
the next; it never hints at how to solve it.

| Order | System | Panel | Outcome in the scene | What it opens up |
|---|---|---|---|---|
| 1 | Lights | Circuit, lock needs power | The room lights up | The door lock can be found and reached |
| 2 | Door lock | Circuit, every tile powered, no leaks | The door slides open | The gravity controls behind it |
| 3 | Gravity | Circuit, every tile powered, no leaks | Gravity cuts out; loose objects float | A cube floats free into reach |
| 4 | Cube | Circuit on the faces of a 3D cube | The cube locks in; the station powers up | The win |

The cube is milestone 3 and optional. Until it exists, step 4 is the win
screen after gravity.

## Scene: the scanner

One full-screen WebGL quad with one fragment shader and no library. Every
pixel runs three steps:

1. **Lens coverage**: loop over a uniform array of pointers,
   `m = (1 - smoothstep(r * 0.8, r, distance(p, lens.xy))) * lens.strength`.
2. **Hidden layer**: generated at runtime from data, not authored as a
   second image: the sum of falloffs from an array of sources
   `[x, y, halfWidth, halfHeight, intensity]`, plus the scene's luminance.
3. **Blend**: `mix(scene, ramp(heat), m)`.

The rules that make it feel right:

- Multitouch comes free: the lens is a uniform array and a loop.
- Never ease the lens toward the pointer. Write the raw position into the
  uniform every frame.
- Work in normalised 0-1 space with an aspect correction on x, so the scene
  is resolution independent.
- Text and panels are DOM over the canvas inside the same scaled stage, so
  type stays crisp.

For pixel art:

- The scene is 320x240 (4:3) and is shown only at whole-number scales
  (1x on a 360px phone, 3x on a laptop). Sampling is nearest-neighbour.
- Lens coverage and heat are snapped to the scene's pixel grid, and the heat
  ramp is a small palette with ordered (Bayer) dithering, so the reveal looks
  like pixel art rather than a filter over it.
- On touch, the lens sits a fixed distance above the finger so the finger
  doesn't hide it. Drag moves the lens; a tap opens a revealed system. With a
  mouse the lens follows the cursor and a click opens.

The scanner only appears over the ship view, never over a circuit panel.

Selecting is hit-tested in JavaScript with the same falloff maths on the same
data array (no GPU read-back), so a system is exactly as selectable as it
looks.

## Data

One scenario file drives everything, so retuning is editing numbers:

```json
{
  "scene": { "image": "scene.png", "size": [320, 240] },
  "systems": [
    {
      "id": "lights",
      "name": "Lighting relay",
      "source": [0.18, 0.42, 0.05, 0.08, 1.0],
      "requires": [],
      "puzzle": { "size": 5, "seed": 48213, "rule": "lock" },
      "outcome": { "type": "lights" }
    }
  ]
}
```

- `source` is the hidden-layer entry: x, y, half-width, half-height (0-1
  scene space) and intensity.
- `requires` lists the systems that must be running first; a system that
  isn't reachable yet has no hotspot.
- `puzzle` is a circuit code plus rule. Seeds are fixed, so every player gets
  the same puzzle.
- A system's state (`fault`, `open`, `running`) changes its heat colour, so
  the scan shows progress.

## Panels: the circuit puzzle

The prototype's puzzle becomes a module: config in, `solved` event out.

- Boards are 5x5 with 32px tiles. On a phone the panel scales to 2x (320px);
  larger boards would force uneven 1.5x pixels. Difficulty comes from rules,
  not size.
- Narrow screens put the lock core above the board instead of beside it.
- Power states and flow are drawn in code from the tile pack; fill clips play
  as power reaches each tile (see the case study for how those are generated).
- Powered conduits that lead nowhere spit sparks (code-drawn pixels, on the
  flat panels and the cube), so leaks read at a glance. Only the powered
  network sparks, so they never point at anything the player hasn't reached.

## Outcomes

The scene is a background plus separate object sprites at known positions
(the lamps, the door, loose cargo). Each outcome is a one-shot clip of that
object going from its before state to its after state:

1. Crop the object from the scene.
2. Make its after state with `/edit-image-pixen` (keeps it the same object).
3. Animate before to after with `/animate-pixminimax`.

Lights are mostly a lighting term in the shader ramping up, so they cost
almost nothing.

## Progress and hosting

- Progress (which systems are running) is saved per player in
  `localStorage`, so a player can leave and come back.
- Static files only, no build step: GitHub Pages first, and the same folder
  uploads to the Neocities TTRPG hub unchanged.

## Milestones

1. **M1, playable loop.** Scanner scene with a placeholder scene image,
   scenario file, systems in order, circuit panels, simple placeholder
   outcomes, saved progress, win screen. No generations needed. Done.
2. **M2, art and outcomes.** Generated 320x240 scene and object sprites,
   outcome clips, fill clips for the tile pack, phone layout polish. Done
   for 40 generations: 33 for the fill set, 7 for the scene, door and
   sprites. (Covered tiles revealed by a scanner on the panel were tried and
   dropped: the scanner belongs to the ship view only.)
3. **M3, cube (optional).** Circuit puzzle on the faces of a low-poly cube:
   the puzzle graph wraps across faces, faces are drawn with the 2D board code
   into a texture atlas, and tiles are picked by ray-casting. Done, no
   generations: a 3x3 board per face (54 tiles), port on the front face,
   lock on the back, strict rule. Rendered in WebGL at 256px and scaled up
   with square pixels. Drag spins the cube, a tap or click turns a tile;
   arrow keys give quarter turns, W A S D and Enter work tiles.
4. **Cube hints.** Playtesting found the cube a little too hard, so it gets
   a pity system: a Hint button is earned by being stuck, the first after 30
   turns or 2 minutes on the cube, each later one after another 20 turns or
   90 seconds. A hint fixes and pins one wrong tile, the one nearest the
   port's correct network, so it always extends the player's progress. The
   thresholds live in `scenario.json`. The flat panels have no hints.

## Open questions

- **Gravity panel difficulty.** Since covered tiles were dropped, it uses the
  same strict rule as the door lock. The cube played too hard rather than too
  easy (hence its hints), so this stays pinned. If it ever needs more, revisit:
  covers that lift when power reaches them, or hatches mapped by lingering on
  the gravity console with the ship scanner (no ring on the panel either way).

