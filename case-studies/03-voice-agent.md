# Real-Time Voice Agent

**~1,000 LOC · React 19, Vite, Anthropic SDK, ElevenLabs (Scribe STT + TTS), Netlify Functions**

## The problem

Build an inbound receptionist agent that holds a real spoken conversation and comes out
the other side with structured data — a booking — rather than a transcript. Complete
voice loops are uncommon in a portfolio because the interesting failures are all at the
seams between services, not inside any one of them.

## The loop

Hold-to-talk capture via `MediaRecorder` → server-side speech-to-text → Claude →
text-to-speech → audio playback, with a booking card rendered live from the model's
structured output. The model's job is to converse *and* fill a schema; the card is the
schema becoming visible as it fills.

## The decisions worth defending

**A shared handler core, two runtimes.** `src/server/handler.mjs` holds the entire
request-handling implementation. Local development mounts it as Vite middleware; the
deployed site mounts it as a Netlify Function. One implementation, two entry points.

The reason is credentials. The Anthropic and ElevenLabs keys stay server-side and never
reach the browser — and because dev and production run the *same* handler, there's no
path where a convenient local shortcut quietly ships as a production key leak. The
architecture makes the secure version also the easy version, which is the only kind of
security discipline that survives a deadline.

**Server-side STT instead of the Web Speech API.** The browser ships a free speech
engine. I didn't use it. It behaves differently across browsers and degrades in ways you
can't see from your own machine — the code comments call the chosen approach
"browser-proof." A free built-in that's inconsistent everywhere is more expensive than a
paid service that's consistent, once you count the support burden of "it doesn't work on
my phone."

**Model and voice IDs are environment-configured**, not hardcoded. Swapping a voice or a
model is a config change, not a deploy of new logic.

## Outcome

A working end-to-end voice loop, deployed. The thing I'd point at in review is the
handler-core split: it's a small structural decision that eliminates an entire category
of credential mistake rather than relying on anyone remembering not to make it.

*This is the generic, sanitized build. Source is not currently published.*
