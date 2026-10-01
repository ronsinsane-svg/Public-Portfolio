# The Music Box

A one-page audio puzzle for a tabletop campaign: reorder the eight plates of a music box's
cylinder until a half-forgotten lullaby plays right. Each plate that lands in place locks,
clears a line of the verse, and brings back its bass line.

Live: <https://demon-lord-sol.neocities.org/themusicbox>.
Case study: [`../case-studies/07-the-music-box.md`](../case-studies/07-the-music-box.md).

```bash
cd the-music-box
python3 -m http.server     # then open http://localhost:8000
```

It's a single file with no dependencies. Opening `index.html` directly works too. All
sound is synthesised with the Web Audio API, so there are no audio files.

Everything you'd want to edit is in the plain-text block at the top of the script: the
verse, the hidden name, the closing memory, and the melody as eight plates of six beats.
The page doubles as its own answer key, so don't hand players the source.

GM tools: type `namela` anywhere on the page to open the solution panel, which can also
reveal everything at once. Progress is saved in `localStorage`.
