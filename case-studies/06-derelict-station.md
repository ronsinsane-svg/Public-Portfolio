# Derelict Station

**Browser puzzle game · WebGL, vanilla JS, an AI art pipeline · ~1,560 LOC ·
[full source →](../derelict-station) · [play it →](https://demon-lord-sol.neocities.org/derelict-station/)**

## The problem

A puzzle for a tabletop campaign, played alone online at the player's own pace, on a
phone or a laptop. The player scans a dark room on a dead space station, finds the
failing systems, and repairs each one with a circuit puzzle. Getting every system running
is the win.

There were three constraints. It had to be static files a GM can drop on Neocities, so
there's no backend and no build step. It had to be pixel art that stays pixel art at every
screen size. And all the art came from a generative model, which meant I had to work out
which parts of the art could be left to the model and which had to be guaranteed by code.

## The scanner: one shader, and data instead of a second image

The obvious way to build "hidden things show up under a lens" is to author a second
image, a thermal view of the room, and reveal it under the cursor. I didn't. The hidden
layer is computed in the fragment shader from data: each system in `scenario.json` is
a source `[x, y, halfWidth, halfHeight, intensity]`, and the heat at a pixel is the
sum of their falloffs plus a little of the scene's own brightness. A system's state
(fault, online) changes its pulse, so the scan itself shows your progress.

That choice paid off in three places:

- **Retuning is editing numbers.** Moving a hotspot or making it harder to find doesn't
  mean redrawing anything.
- **Hit-testing matches the visuals exactly.** Picking runs the same falloff formula in
  JavaScript on the same array, with no GPU read-back. A system is precisely as
  selectable as it looks, so there's never a hotspot you can see but can't click.
- **Multitouch is free.** The lens is a uniform array that the shader loops over.

The rules that make it feel like pixel art rather than a filter over pixel art:

- The 320×240 scene is shown only at whole-number scales, with nearest-neighbour
  sampling.
- Lens coverage and heat are snapped to the scene's pixel grid.
- The heat ramp is a seven-colour palette with 4×4 Bayer dithering between stops.
- The lens position is written raw every frame, never eased. Easing makes it feel like
  it's lagging behind your hand.
- On touch, the lens sits above the finger so the finger doesn't cover what you're
  looking for.

## The circuit panels

Rotate conduit tiles until power runs from the port to the lock. Each puzzle is a
**seeded spanning tree** over the grid, so every tile is on the intended route and every
player gets the same puzzle. Each tile is then turned a random amount. Power is a
breadth-first trace from the port, which gives every tile its distance and entry side.
Those two values drive the fill animation: generated clips play outward from where
power entered, staggered by distance, and drain backwards when power is cut.

Difficulty comes from rules, not board size. The first panel only needs power to reach
the lock. Later ones need every tile powered with no leaks. Boards stay 5×5 with 32px
tiles because anything larger forces uneven 1.5× pixels on a phone. Narrow screens get
the same puzzle drawn rotated a quarter turn, not a different puzzle.

Powered conduit ends that lead nowhere throw sparks, so leaks read at a glance. Only the
powered network sparks, so a spark never points at something the player hasn't reached.

## The cube

The finale is the same puzzle wrapped around the six faces of a cube: 54 tiles, port on
the front face, lock on the back. The interesting part is that `cube.js` contains **no
special cases for edges.** Each face is described by its outward normal and the two
directions that are right and down when you look at it from outside. Tile neighbours,
including the ones across a cube edge, fall out of that geometry, and the spanning-tree
generator from the flat panels runs unchanged on the resulting graph.

Faces are drawn with the flat panels' tile pack into one texture atlas, so fills, power
states and sparks all carry over. Plain WebGL renders the cube at 256px and scales it up
with square pixels. Taps are ray-cast into the cube to find the tile. Sparks live on the
cube's surface and fold over edges onto the next face.

**Hints.** Playtesting found the cube a little too hard, so it got a pity system. A Hint
button appears only after 30 turns or two minutes stuck, then again after another 20
turns or 90 seconds. Players who keep making progress never see it. A hint doesn't just
pick a random wrong tile. It grows the port's *correctly placed* network along the
solution, takes the nearest wrong tile on its edge, spins the cube to show that face, and
turns the tile into place and pins it. So a hint always extends what the player has
already built, rather than fixing something on the far side of the cube that they can't
connect to yet. The thresholds live in `scenario.json`.

## The art pipeline: test the model before trusting it

All the art came from PixelLab, a generative pixel-art API. Before building on it I ran
it as an evaluation: about 290 generations over nine logged rounds, each a table of
method, count and result, with the puzzle's tile geometry kept in code so every
generated tile could be graded against it automatically.

What that settled:

- **Geometry belongs in code, style belongs to the model.** Asking for a conduit layout
  in words failed. Masking and inpainting the wire channel failed. The road-autotile
  endpoint produced a complete connectable set in one consistent style, and a grader
  confirmed every edge of every tile lined up to the pixel.
- **My own fix was the bug.** Boards showed 1px jogs at some junctions. I'd built an
  alignment step that measured each wire's bright core, but the core's shading is
  uneven, so it "corrected" tiles that were already right. Measuring the whole wire
  profile instead showed the raw set was consistent all along. Alignment is opt-in now,
  and the finding is written down so nobody repeats it.
- **Ask for a state change, not a loop.** Fill animations requested as loops came back as
  empty-then-refill. Requesting a one-shot transition from the unpowered tile to the lit
  one worked. A full set is 32 clips, one per tile shape and entry side. A grader dropped
  a recurring bad frame automatically, and the two clips that filled from the wrong edge
  were regenerated with the direction named in the prompt.
- **Use structure as the init image.** The finished room was generated from a code-drawn
  placeholder layout. At one strength the model kept every position and restyled the
  room. At a lower strength it changed the perspective and signed someone else's name in
  the corner, which is something to check low-strength results for.

Power states (off, powered, fault) are recolours in code rather than more generations,
and fill clips ship as one sprite strip per clip: 32 files instead of 288.

## Outcome

A complete, playable game: four systems in order, each repair with its own animation in
the scene, saved progress, keyboard and touch controls, and reduced-motion support. It
deploys as a static folder. The asset pipeline is reproducible, and every generation and
its cost is logged.

The decision I'd defend: **keep what has to be correct in code, and give the model only
the parts where variation is fine.** The tile geometry, the puzzle graph, the hotspots
and the power states are all deterministic and checked. The model supplies texture,
lighting and motion. When it gets those slightly wrong, a grader catches it, rather than
a player finding a puzzle that can't be solved.

*Personal project. Full game source in [`derelict-station/`](../derelict-station);
the generation and grading tools are in a private repo.*
