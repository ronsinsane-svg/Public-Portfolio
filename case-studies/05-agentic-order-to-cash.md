# Agentic Order-to-Cash

**~4,300 LOC · React 19, TypeScript, Vite, Netlify Functions, Anthropic SDK**
**→ Source: [`agentic-order-to-cash/`](../agentic-order-to-cash)**

## The problem

Show an agentic workflow that an engineer would actually trust in a system that handles
contracts and money. The demo constraint was a real one: it had to run live, in front of
people who would ask to see the code.

## The thesis

**A deterministic state machine owns the workflow. Claude agents act within it. Agents
never control the workflow.**

The common failure mode in agent systems is handing control flow to the model. It demos
beautifully and is unreasonable in production — you can't enumerate the states, you can't
audit why something happened, and a bad generation is indistinguishable from a bad
decision.

So the split is structural, not advisory:

| Deterministic code owns | Agents own |
|---|---|
| Which stage runs next | Reading records via read-only tools |
| Pass, hold, or fail | Forming a judgment about what they read |
| Every write | Citing the evidence for it |

An agent's entire output surface is one `submit_verdict` tool call against a strict
schema. It cannot approve, cannot write, cannot pick the next stage, and never sees the
state machine. The worst a misbehaving agent can do is return a wrong verdict — which
lands in the exception lane and stops at a human.

## The engineering worth reading

**The round-trip inversion.** Netlify hard-kills a streaming invocation at 30 seconds. So
rather than one long agent loop at risk of being cut off mid-thought, one invocation is
exactly one model round; if it doesn't end in a verdict, the response closes with a
`continue` event carrying the conversation and the client calls straight back. The server
holds no state between rounds, and a stalled round costs a round instead of a run.

**Guardrails that are the policy, not a picture of it.** The timeout, retry, and round-cap
constants live in one 8-line module. The function enforces those values and the Guardrails
panel renders the same exported object — so the UI can't drift into claiming a control
that isn't wired up.

**Evidence as a schema requirement.** Every issue an agent raises must carry a source, a
ref, and a verbatim quote, which makes a hallucinated objection visible rather than
merely plausible.

**Routing around known weaknesses.** Agents are forbidden from computing weekdays from
dates; weekday facts arrive pre-computed from tool results. Cheaper to design around a
reliable failure than to detect it afterward.

## Outcome

Seven scenarios passing, replayable from recorded fixtures with no network and no API key.
This is the one project here with fully readable public source — synthetic data, fictional
company, and the architecture is the deliverable.
