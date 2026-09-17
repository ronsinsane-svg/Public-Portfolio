# Five Star Fleet — Booking & Payments

**Shipped production · React/TypeScript/Vite, Node/Express, Stripe, WordPress, Docker**

## The problem

A luxury transport company had a stalled build and a booking flow that didn't work. I
joined mid-project and took the booking funnel and admin backend end to end. This is the
only system I've shipped that moves real money, which changes what "done" means: a bug
here is a double charge, not a re-render.

## What I owned

**The booking funnel** — service type → trip details → date and time → confirm and pay.
A multi-step flow with the state coordinated in a `useBooking` hook, roughly 490 lines in
`BookingPage.tsx` and a dedicated confirm-and-pay step. Multi-step forms are where
requirements go to hide: every back-navigation, refresh, and abandoned session is a state
question, and most of the work was making those transitions boring.

**Stripe payments**, with three properties that mattered more than the happy path:

- *Idempotent confirmation*, so a double-submit or a retried request cannot produce two
  charges for one trip.
- *Webhook backfill*, because the browser is not a reliable narrator. If the user closes
  the tab between payment and confirmation, Stripe's webhook still lands the booking. The
  client is an optimization; the webhook is the source of truth.
- *Anti-tamper on price*, because the amount charged is computed server-side from the
  trip, never accepted from the client. A quoted price arriving in a request body is a
  suggestion, not a fact.

**The backend** (~946 LOC in `server/index.ts`): database layer, transactional email,
auth, and WordPress media integration so the marketing site and the application shared
one source of images.

**The admin panel**: vehicle CRUD with image upload, driver roster, and a list/calendar
toggle for bookings.

**Test coverage** in `server/__tests__/` — the money paths are the ones I wanted pinned
down.

## Outcome

Shipped and running in production, taking live bookings and live payments.

The narrative I'd lead with in an interview is the rescue, not the greenfield. Joining a
build that's already stuck means reading someone else's half-finished decisions, deciding
what to keep, and shipping anyway. That's most real engineering work, and it's harder to
demonstrate than starting from an empty directory.

*Source is client IP and not published. Live production URL available on request.*
