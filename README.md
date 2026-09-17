# Ronald Diener — Selected Work

Backend and full-stack engineering, with a recent concentration in production systems
built around LLM agents.

Most of what I work on is internal tooling or client software whose source I can't
publish. So this repository is written to be useful without it: each case study describes
the mechanism, the decisions, and the tradeoffs in enough detail to be argued with. One
project ships with complete readable source.

---

## Case studies

**[Lead Qualification Pipeline](case-studies/01-lead-qualification-pipeline.md)** ·
*~16,700 LOC, production*
An event-driven qualification system: `pg_cron` → edge function → Postgres → Realtime
fanout to a live multi-user dashboard. OAuth with token refresh against a partner GraphQL
API, async webhook-callback handling for an enrichment provider that isn't
request/response, RLS multi-tenancy, two Chrome MV3 extensions, and a live model-provider
migration. Includes a tech-debt audit I wrote about my own system.

**[Five Star Fleet — Booking & Payments](case-studies/02-five-star-fleet.md)** ·
*shipped, real payments*
Joined a stalled build and owned the booking funnel and admin backend end to end. Stripe
with idempotent confirmation, webhook backfill, and server-side price computation. The
only system here that moves real money.

**[Real-Time Voice Agent](case-studies/03-voice-agent.md)** · *~1,000 LOC*
A complete voice loop — capture → server-side STT → Claude → TTS → a booking card
rendered from structured output. One shared handler core backs both the local dev
middleware and the deployed function, so provider keys never reach the browser.

**[CRM MCP Server](case-studies/04-crm-mcp-server.md)** · *MCP, TypeScript*
A Model Context Protocol server that declined the service-role key and signs in as a
normal user instead, so every action inherits existing RLS, permissions, and audit trail.

**[Agentic Order-to-Cash](case-studies/05-agentic-order-to-cash.md)** ·
*~4,300 LOC · [full source →](agentic-order-to-cash)*
A deterministic state machine owns the workflow; Claude agents act within it and never
control it. Streaming SSE, strict tool schemas, evidence-citing verdicts, and seven
scenarios replayable offline from recorded fixtures.

---

## A through-line

Three of these projects made the same call about credential boundaries, independently and
for different reasons:

- **Lead Qualification Pipeline** — zero hardcoded secrets; all config via
  `Deno.env.get()`, with cron reading from `vault.decrypted_secrets`.
- **CRM MCP Server** — declined the service-role key; inherits the caller's identity and
  RLS instead.
- **Voice Agent** — one shared server-side handler so provider keys never reach the
  browser, in development or production.

The pattern I'd name: *the secure path should also be the convenient one.* Credential
discipline that depends on remembering to be careful doesn't survive contact with a
deadline. Every one of these makes the safe version structurally easier than the unsafe
version — which is why it held.

---

## Reading the code

[`agentic-order-to-cash/`](agentic-order-to-cash) is the one project with complete public
source. It runs with no network and no API key:

```bash
cd agentic-order-to-cash
npm install
npm run check-data    # validate the synthetic dataset's internal consistency
npm run scenarios -- --transport replay    # all seven scenarios, offline
npm run typecheck
```

Its [README](agentic-order-to-cash/README.md) is the best single read here — it argues a
position about where determinism belongs in agent systems and then shows the code that
enforces it.
