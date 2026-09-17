# CRM MCP Server

**Model Context Protocol server · TypeScript, Supabase**

## The problem

Expose an internal CRM to Claude as a set of tools, so that reading and updating records
could happen in conversation instead of through the web UI. Short project. The interesting
part is a single decision about identity.

## The obvious implementation, and why I didn't ship it

The path of least resistance for a service like this is a service-role key: one
high-privilege credential that can read and write anything, provisioned once, held by the
server. Every MCP example does it that way. It works immediately.

It also means the tool server becomes the most dangerous credential in the system. It sits
outside the permission model rather than inside it, every action it takes is
indistinguishable from every other action in the audit log, and revoking one user's access
does nothing to what the server can do on their behalf.

## What I built instead

The server **signs in as a normal user**. It holds no privileged credential. Every query
and every write inherits that user's existing row-level security policies, their
permissions, and their identity in the audit trail. If a user can't see a record in the
web UI, the MCP server can't see it for them either — not because I wrote a check, but
because the database already enforces it.

Two consequences follow, and both are the point:

**Nothing has to be provisioned.** There's no shared secret to mint, rotate, or store, and
no admin has to grant the tool server anything. The permission model that already exists
is the permission model the tools get.

**Writes route through the existing Edge Functions** rather than going straight to tables.
That preserves business logic, database triggers, and activity logging — an update made
through Claude is the same update, with the same side effects and the same audit record,
as one made through the UI. The integration adds a surface, not a second code path that
can drift from the first.

## Outcome

A working MCP server against a real production CRM, where the security story is "it
inherits everything" rather than "it bypasses everything."

The general principle I'd argue for: when you connect a new kind of client to an existing
system, the win is making it a *citizen* of the existing permission model, not an
exception to it. Exceptions are how audit trails stop being true.

*Internal tooling, connected to live infrastructure. Described at architecture level;
source not published.*
