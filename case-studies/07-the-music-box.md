# The Music Box

**Web Audio puzzle · one HTML file, no dependencies, no audio files · ~1,140 LOC ·
[full source →](../the-music-box) · [play it →](https://demon-lord-sol.neocities.org/themusicbox)**

## The problem

A puzzle written for one player's character in a tabletop campaign. Among their dead
mother's things is a music box whose pegs have been reset in the wrong order. Fix the
cylinder and the lullaby comes back, and with it a memory the campaign needed them to
have.

The puzzle is the melody: eight plates of six beats, scrambled. The player swaps plates
and plays the cylinder through. Any plate in its correct slot locks for good.

The design problem is that it's a puzzle you solve by listening, and most people can't
hear a wrong note and say what the right one is. It had to be solvable by ear without
being solvable by guessing.

## Feedback that is part of the story

Every piece of feedback is something the box or the memory does, rather than a UI
element:

- **Locking happens during playback.** You don't press "check". You turn the key, and
  each plate locks as the cylinder passes it, with a bell tone. The only way to test an
  arrangement is to listen to it.
- **The harmony comes back as you remember.** The bass line belongs to the *slot*, not
  the plate, and only sounds under locked slots. A half-solved box plays a melody with
  holes in its accompaniment, and the holes show you where you still have work to do.
- **The verse clears line by line.** Each locked slot unblurs its line of the lullaby,
  which carries the campaign's lore.
- **The hidden name is only rendered on a full solve.** The dedication shows a redacted
  name until every plate is in place.

## The hint: close your eyes

The hint button is a press-and-hold: "Close your eyes and remember." The screen goes dark
and you hear the *correct* melody, but buried. It's muffled, full of static, with notes
missing, notes wrong, and whole phrases cutting out. Let go and it's gone.

Every layer of that damage is scaled by how much you've already solved. The low-pass
filter opens from 300 Hz toward 10 kHz, and dropped notes, wrong notes, dropouts,
per-note detuning and tape-wow drift all shrink toward zero. The hint gets clearer as you
earn it, so it can never hand over the answer to someone who hasn't started, and it
never stops helping someone who has.

The static took more work than it sounds. A short looped noise buffer is audible as a
pulse, because you hear the splice. The fix was an eight-second buffer read by two layers
at incommensurate playback rates from random offsets, plus a slow LFO on each read rate,
so the combined texture has no period a listener can catch.

## Synthesis

There are no samples. Each tine is a struck tone built from four sine partials at
inharmonic ratios (1, 2, 3.02, 5.41), with decay that shortens as pitch rises and a
band-passed noise burst for the strike. That runs through a generated convolution
reverb and a compressor. The cylinder on screen is drawn on a canvas in step with the
audio clock: pegs rotate past the comb, and each bar lights as its note sounds.

## Built to hand to a GM

- Everything a GM would edit (the verse, the name, the closing memory, and the melody as
  a table of MIDI notes) is a plain-text block at the top of the file.
- The scramble is a derangement, so no plate starts in its correct slot.
- Progress persists in `localStorage`, and a reset rescrambles.
- A hidden GM panel, opened by typing the name, shows the solution and can reveal
  everything. That matters at a live table when a player is stuck and the session needs
  to move on.
- It's one file with no build step and no network access, so it hosts anywhere.

## Outcome

Hosted on Neocities. The thing I'd point to is that the hint
system is a single parameter, the fraction solved, threaded through every layer of the
degradation. That makes it fair by construction: you get exactly as much clarity as
you've earned, without hand-tuned hint tiers.

*Personal project. Full source in [`the-music-box/`](../the-music-box). The melody is a
transcription of the main theme of Joe Hisaishi's "Merry-Go-Round of Life", used for a
private game.*
