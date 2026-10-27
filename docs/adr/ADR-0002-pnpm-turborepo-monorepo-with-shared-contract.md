# ADR-0002: pnpm + Turborepo monorepo with one shared Zod contract package

- **Status:** accepted
- **Date:** 2026-09-18
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Wally is one product with two deployables, a React single-page app and a Fastify API, that must agree on every request and response shape, every enum value and every constant. One person builds both. How should the code be organised so that the contract is written once and both sides are type-checked against it?

## Decision drivers

- One `make up` must build and start everything from an empty checkout.
- A change to a note's shape must fail the build on whichever side forgot it.
- No publishing step: the project has no package registry and should not need one.

## Considered options

1. **pnpm workspaces + Turborepo, with the contract in a workspace package:** good, because both apps import the same TypeScript source and one lockfile pins everything; bad, because every Docker build needs the repository root as its context.
2. **Two repositories with a published contract package:** good, because each deployable has its own history and CI; bad, because every contract change is two pull requests and a version bump, for a team of one.
3. **One package holding both API and web:** good, because nothing to wire; bad, because server and browser dependencies, TypeScript configs and test environments would share one `package.json`.

## Decision outcome

Chosen option: **pnpm workspaces + Turborepo with `@wally/shared`**, scaffolded in commit `fc0e3638`.

- [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) declares `apps/*` and `packages/*`. [`turbo.json`](../../turbo.json) runs `build`, `test`, `lint` and `typecheck` across them.
- [`packages/shared`](../../packages/shared) holds the Zod schemas, enums, constants and query helpers used by both apps. Its `package.json` points `main` and `exports` at `src/index.ts`, so dev tooling (tsx, Vite, Vitest) consumes the TypeScript source directly with no build step.
- [`packages/config`](../../packages/config) holds the shared ESLint, Prettier and `tsconfig.base.json`.
- New code goes into the matching package; no new top-level folders without a reason (`SETUP.md`, "Monorepo").

### Consequences

- Good: one schema validates the request in the API and types the response in the web app.
- Good: a single `pnpm install --frozen-lockfile` and a single Turbo pipeline serve local dev and CI.
- Bad: shipping raw TypeScript from `@wally/shared` means Node in production cannot load it. The build stage of [`apps/api/Dockerfile`](../../apps/api/Dockerfile) compiles the package and patches the deployed copy's `package.json` to point at `dist/`. That patch is a known wart.
- Bad: both Dockerfiles must be built from the repository root, which is why `gcloud run deploy --source` does not work here (see ADR-0008).
- Neutral: Turbo's `envMode: loose` and the `VITE_*` inputs on the build task are the only caching subtleties so far.

### Confirmation

`pnpm typecheck` runs in CI for every package. The API image build fails if the patched `@wally/shared` does not resolve.

## More information

- Layout and conventions: [`SETUP.md`](../SETUP.md), "Monorepo".
- Code map: [`architecture/overview.md`](../architecture/overview.md), "Repository layout".
