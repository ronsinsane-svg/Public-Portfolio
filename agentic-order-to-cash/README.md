# Agentic Order-to-Cash

A working vertical slice of an order-to-cash workflow in which Claude agents do the
reading and the judging, and a deterministic state machine does the deciding.

**The load-bearing property: agents never control the workflow.**

That sentence is the whole design. It is not a disclaimer in a README — it is enforced
structurally, and the structure is small enough to read in one sitting.

All business data is synthetic. Meridian Goods, its retailers, catalog, contracts and
settlements are fictional.

---

## Why this is built the way it is

The common failure mode in agent systems is letting the model own control flow. It reads
well in a demo and is impossible to reason about in production: you cannot enumerate the
states, you cannot audit why a thing happened, and a bad generation is indistinguishable
from a bad decision.

So the split here is explicit:

| Deterministic code owns | Agents own |
|---|---|
| What stage runs next | Reading records via read-only tools |
| Whether a run passes, holds, or fails | Forming a judgment about what they read |
| Every write, without exception | Citing the evidence for that judgment |

An agent's entire output surface is a single `submit_verdict` tool call with a strict
schema (`shared/verdict.ts`). It cannot approve. It cannot write. It cannot choose the
next stage. It does not even receive the state machine. The worst a misbehaving agent can
do is return a wrong verdict — which lands in the exception lane and stops at a human.

## The pieces worth reading

**`shared/engine.ts`** (220 lines) — the orchestrator. Every "what happens next" in the
system lives in this one file as plain deterministic code. It has zero browser and zero
Netlify dependencies, which is the point: in production it moves server-side unchanged.
In the demo it runs client-side so the whole system is stateless and resettable, and so
the scripts can execute it headless under plain Node.

**`netlify/functions/agent-run.mts`** (328 lines) — the only Anthropic-facing endpoint,
streaming SSE. One invocation is exactly **one model round**: a single streamed call plus
any local tool execution it requests. If the round doesn't end in a verdict, the response
closes with a `continue` event carrying the conversation, and the client transport calls
straight back. The server holds no state between rounds.

This was a deliberate trade. Netlify hard-kills a streaming invocation at 30s, so instead
of one long-running agent loop that might get guillotined mid-thought, the loop is turned
inside out: bounded rounds, each comfortably inside the limit, with continuation state on
the wire. It also means a stalled round costs one round, not one run.

**`shared/policy.ts`** (8 lines) — the guardrail constants: per-round timeout, retry
count, round cap. The function enforces these values and the Guardrails panel renders the
same exported object, so the panel is provably the policy rather than a screenshot of it.
Small file, but it's the difference between a real control and a UI that claims one.

**`shared/tools.ts`** — the read-only tool surface. Each agent gets an explicit allowlist
(`AgentDef.tools`); there is no ambient access.

**`shared/templates/*.json`** — the workflow as data. A second purchase-to-payment
template defines its lane and stages with no agents wired to them, which is the honest
version of the claim: the engine loads and renders a workflow it was never written for,
and the remaining work is authoring agents, not touching the orchestrator.

## Details I'd point out in a code review

- **Verdicts travel as a strict tool schema, not parsed prose.** `additionalProperties:
  false` throughout, and `proposed_fix.patch` is deliberately a JSON-encoded *string* —
  strict schemas reject free-form `any`, so it's serialized rather than loosened.
- **Every issue must cite evidence** — source, ref, and a verbatim quote — which makes a
  hallucinated objection visible instead of plausible.
- **Agents are told what they are bad at.** The system prompt forbids computing weekdays
  from dates; weekday facts arrive pre-computed from tool results (`withWeekday`). Cheaper
  to route around a known weakness than to detect it afterward.
- **The intake agent must emit a complete corrected order, never a partial patch**,
  because downstream stages consume the patch as the whole order. That constraint is in
  the prompt because it was a real bug first.
- **Model choice is per-agent and reasoned.** Pipeline stages run Sonnet; the always-live
  chat surface runs Haiku with hard caps, because chat is the one surface a visitor can
  hammer and replay mode can't bound.

## Replay mode

`fixtures/` holds recorded runs keyed by entity id. The app can execute the full pipeline
with no network and no API key, which makes the demo deterministic for presentation and
gives the scripts a fixed baseline to diff against.

```bash
npm install
npm run check-data    # validate the synthetic dataset's internal consistency
npm run scenarios     # run all seven scenarios headless
npm run typecheck
```

For live agent runs, put a personal `ANTHROPIC_API_KEY` in `.env`, then `npm run dev`.

`public/architecture.html` is a standalone diagram of the same structure — client,
functions, orchestrator, scoped tools, human gate, audit log, and where an adapter layer
attaches in production.

## Stack

React 19 · TypeScript · Vite · Netlify Functions · Anthropic SDK (streaming, strict tool
schemas) · ~4,300 LOC
