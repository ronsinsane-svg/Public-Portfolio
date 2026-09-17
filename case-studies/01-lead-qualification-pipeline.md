# Lead Qualification Pipeline

**Internal production system · ~16,700 LOC · React/TypeScript, Supabase, Chrome MV3, Anthropic API**

## The problem

The agency I work for sourced new business from a third-party job-aggregation service.
Qualifying that flow by hand didn't scale: the volume was high, the signal was thin, and
the cost of reading every posting carefully was the reason nobody did. The job was to put
a system between the firehose and a human's attention.

## What I owned

Effectively all of it, with one honest caveat: the initial CRUD dashboard was scaffolded
in bolt.new — `package.json` still reads `vite-react-typescript-starter`. That got me a
working table in a day. The three months after it are the actual work: 20 Supabase edge
functions, 44 migrations, two Chrome MV3 extensions, the auth layer, the pipeline, and a
second product line.

## The hard parts

**Async webhook callbacks.** One enrichment provider isn't request/response — you submit,
it calls you back whenever. That single fact restructures the system: a separate callback
endpoint, queue state to survive the gap, and reconciliation for callbacks that never
arrive. Three providers total, one of them webhook-based, each with a different failure
shape.

**OAuth against a partner GraphQL API**, with token refresh and secrets held in Supabase
Vault. Vendor documentation was insufficient, so I wrote schema-introspection tooling to
discover the API surface directly rather than guessing at it.

**A deliberately single-writer collector.** Exactly one machine runs the scraper; the
dashboard is multi-user. That asymmetry is a decision, not a limitation — concurrent
collectors mean duplicate submissions and duplicate model spend, and coordinating them
costs more than it returns at this scale.

**Event-driven fanout:** `pg_cron` → edge function → Postgres → Supabase Realtime to a
live multi-user dashboard. Plus RLS with role-scoped multi-tenancy, admin policies
alongside a service-role bypass for cron, and a live migration from one model provider to
another without downtime.

**Zero hardcoded secrets**, verified by scan — all config through `Deno.env.get()`, and
cron migrations reading from `vault.decrypted_secrets`.

## The part I'd actually want to talk about

I wrote a tech-debt audit of my own system: 80 files scored by impact, risk, and effort,
documenting real incidents — a cron job that stopped silently for sixteen hours before I
caught it, a pagination limit that silently truncated results, a unix-timestamp handling
bug, and a full-table scan.

Finding #1 in that audit is my own zero test coverage. I'd rather hand someone that
document than claim the system is clean. Instrumenting a system well enough to find a
silent sixteen-hour failure, and then writing down what it cost, is the part of the job
that compounds.

*Architecture and mechanism described here; scoring criteria, vendor identities, and
volume figures omitted.*
