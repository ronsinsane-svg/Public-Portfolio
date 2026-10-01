# Derelict Station

A browser puzzle game for a tabletop campaign. Sweep a dead station with a scanner, find
the failing systems, and bring each back online with a circuit panel. The last one is a
circuit wrapped around the six faces of a cube.

Live: <https://demon-lord-sol.neocities.org/derelict-station/>.
Case study: [`../case-studies/06-derelict-station.md`](../case-studies/06-derelict-station.md).
Design doc: [`DESIGN.md`](DESIGN.md).

```bash
cd derelict-station
python3 -m http.server     # then open http://localhost:8000
```

Static files only. No build step, no libraries, no dependencies. It needs to be served
over HTTP because it fetches `scenario.json` and the asset manifests, and it deploys
as-is to GitHub Pages or Neocities.

## Files

- `scenario.json`: the whole encounter. Scene image and sprites, and each system's
  hidden-layer source `[x, y, halfWidth, halfHeight, intensity]`, prerequisites, puzzle
  (`size`, `seed`, `rule`) and outcome. You retune the game by editing this file.
- `scanner.js`: the WebGL scene. One quad, one fragment shader: lens coverage from a
  uniform array of pointers, a hidden layer summed from the sources, and a blend,
  snapped to the scene's pixel grid with dithered edges.
- `circuit.js`: the circuit panel as a module (`createCircuit` with a puzzle config,
  `onChange` and `onSolved`). Narrow screens show the same puzzle rotated a quarter
  turn. Tiles fill with generated clips as power reaches them and drain when it's cut.
- `cube.js`: the cube panel (`createCube`, same interface as `createCircuit`). Tiles and
  cross-edge neighbours are built from each face's normal and axes, the puzzle is a
  seeded spanning tree over that graph, faces are drawn with the tile pack into one
  texture, and plain WebGL renders it at 256px, scaled up with square pixels. Taps are
  ray-cast into the cube to find the tile.
  - Hints you earn by being stuck: a Hint button appears after a set number of turns or
    seconds on the cube. A hint grows the port's correctly placed network along the
    solution, takes the nearest wrong tile on its edge, spins the cube to show that
    face, then turns the tile into place and pins it. Players who keep making progress
    never see the button.
- `sparks.js`: leak sparks, shared by both panels. Every powered conduit end that leads
  nowhere fires a burst of pixel sparks. On the cube they live on the surface and fold
  over edges onto the next face. They're off when the device asks for reduced motion.
- `main.js`: the loop. Scene composition, the lens (on touch it sits above the finger),
  systems in order, outcome animations, progress in `localStorage`, and the win.
- `assets/`: the PixelLab-generated art, already built: the tile pack (one image per
  edge mask per power state), fill clips as sprite strips, lock core frames, and the
  scene and its sprites. The generation and grading tools live in a private repo; the
  case study describes that pipeline.

Progress is stored under the `derelict-station-v1` key. "Start over" on the win screen
clears it.
