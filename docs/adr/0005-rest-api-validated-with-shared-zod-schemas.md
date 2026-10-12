# ADR-0005: Plain REST on Fastify, validated with the shared Zod schemas

- **Status:** accepted
- **Date:** 2026-09-18
- **Deciders:** Milad Rezazadeh

## Context and problem statement

The web app needs to read boards and notes and to perform a handful of verbs on them: move, assign, complete, reopen, duplicate, invite, rotate a share link. ADR-0002 put the request and response schemas in `@wally/shared`. What API style should carry them between the browser and the server?

## Considered options

1. **REST on Fastify, every body and reply validated by the shared Zod schemas:** good, because the API is readable with curl, testable per route, and the schemas are reused as-is; bad, because the client-side calls are written by hand against the routes, with nothing generated.
2. **tRPC:** good, because end-to-end types with no hand-written client; bad, because the API is only callable from the TypeScript client, and a future non-browser caller (an assistant, a script) would need the tRPC runtime.
3. **GraphQL:** good, because the client picks its fields; bad, because a schema layer, resolvers and a client cache on top of a data model with four collections.

## Decision outcome

Chosen option: **REST with Zod**.

- [`apps/api/src/app.ts`](../../apps/api/src/app.ts) installs `fastify-type-provider-zod`, so a route's `schema` is a Zod object from `@wally/shared` and the handler is typed from it.
- Resources are nouns, actions are `POST` verbs on the resource: `POST /notes/:id/move`, `/assign`, `/complete`, `/reopen`, `/duplicate`; `POST /whiteboards/:id/share-link/rotate`.
- Every error has the shape `{ error: CODE, message }`. Messages are English and machine-readable; the web app translates by `error` code, never by message text (ADR-0007).
- The web app calls the API through one fetch wrapper, [`apps/web/src/lib/apiClient.ts`](../../apps/web/src/lib/apiClient.ts), whose `ApiError` classifies the status so hooks can branch on `unauthorized`, `forbidden`, `not_found` and `validation`.
- Rate limiting is per user, 300 requests a minute, with an in-process store. Keying on the IP would put everyone behind Cloud Run's proxy in one bucket; a shared store would mean running Redis, which this stack does not have.

### Consequences

- Good: each route has a curl-able contract and an integration test against the emulator.
- Good: the same schema that validates the request types the response in the browser.
- Bad: the mapping from client call to route is maintained by hand. A renamed route is a runtime error in the browser, not a type error.
- Bad: there is no OpenAPI document, so a non-TypeScript caller would have to read the routes.
- Neutral: the in-process rate limit is per Cloud Run instance, a floor rather than a precise cap.

### Confirmation

Integration tests in `apps/api/test/` and library tests in `apps/api/src/lib/` run against the emulator; [`SETUP.md`](../SETUP.md) sets the target that every route and business rule has one. Zod rejects an invalid body with 400 before the handler runs.

## More information

- The change trigger for a Python backend (heavy data or ML libraries only): [`SETUP.md`](../SETUP.md), "Backend".
- Route list and request lifecycle: [`architecture/overview.md`](../architecture/overview.md).
