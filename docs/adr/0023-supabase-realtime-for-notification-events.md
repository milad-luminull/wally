# ADR-0023: Supabase Realtime for small, recipient-only notification events

- **Status:** accepted
- **Date:** 2026-10-26
- **Deciders:** Milad Rezazadeh
- **Supersedes:** the "no real-time channel" rule in
  [ADR-0006](0006-server-state-in-tanstack-query-no-realtime.md). Its TanStack Query
  rules stay in force.

## Context and problem statement

ADR-0006 keeps all server data in TanStack Query. It allows no WebSocket, SSE or polling,
and names SSE from the API as the path if live updates are ever needed.

Planned reminders and in-app notifications must reach a user who already has Wally open.
The owner chose to keep notifications in PostgreSQL and broadcast small events through
Supabase Realtime, with HTTP streaming from Fastify kept for interactive AI only
([tech stack brief](../researches/2026-10-26-tech-stack-and-architecture.md)).

The question: how does the browser learn about a new notification, and what may that
channel carry?

## Considered options

1. **Realtime Broadcast on private per-user channels, followed by a refetch:**
   - Good: no socket server to run, and it fits the Free plan.
   - Bad: a socket from the browser to Supabase, and one authorization rule that lives
     in the database.
2. **SSE from Fastify:**
   - Good: all authorization stays in one place.
   - Bad: each open stream keeps a Cloud Run instance busy, and the stream must pass
     through the Worker proxy.
3. **Polling:**
   - Good: trivial.
   - Bad: latency and wasted requests.

## Decision outcome

Chosen option: **option 1**.

- **The row comes first.** The API or the background service writes the notification to
  PostgreSQL before sending any event. The row is the truth.
- **Events are signals only.** They carry an identifier and a type, never note content.
  The browser then reads through the API with TanStack Query, and refetches unread
  notifications after every reconnect.
- **Channels are private and keyed by the recipient's Supabase user ID (`auth.uid()`).**
  - The server finds that ID through Wally's identity mapping before it sends.
  - The policy on `realtime.messages` only compares the channel topic with `auth.uid()`.
    It never reads application tables, so ADR-0020's "no permissive policies on
    application tables" still holds.
  - Public access is switched off in Realtime settings
    ([Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)).
- **Board data does not use this channel.** Another member's edit still appears on the
  next refetch, as ADR-0006 describes.
- **AI responses stay plain HTTP requests to Fastify.** They are not streamed today. If
  streaming is added, it uses HTTP, not Realtime.

### Consequences

- Good: notifications arrive within seconds, with no socket server or polling.
- Good: a lost or duplicated event does no harm, because the browser always re-reads
  from the API.
- Bad:
  - The web bundle gains the Realtime client, and the browser holds a connection to
    Supabase.
  - Authorization is split between Fastify and one database policy.
- Bad: Free quotas cap the feature at 200 peak connections and 2 million messages a
  month (owner brief, citing
  [Realtime limits](https://supabase.com/docs/guides/realtime/limits)).
- Neutral: running Realtime private channels with the Data API off (ADR-0020) is
  _unverified_. It is proven on a free project before this ships.

### Confirmation

Tests prove that:

- a user cannot join another user's channel;
- an event never carries note text;
- a reconnect recovers missed notifications through the API.

## More information

- [Platform migration](../rfcs/0011-platform-migration.md), workstream 5.
- The in-flight reminder and notification drafts must be reconciled with this decision
  (platform migration, section 9).
