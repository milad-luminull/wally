# Project setup

## Monorepo

- pnpm workspaces + Turborepo. One `package.json` at the root, one per package.
- Layout:

  ```
  apps/api          backend
  apps/web          frontend
  packages/shared   types, Zod schemas, constants used by both apps
  packages/config   shared eslint, tsconfig, prettier
  ```

- New code goes into the matching package. Do not create top-level folders without asking.

## Backend (TypeScript)

- Node 22, Fastify, Cloud Firestore (Firebase Admin SDK).
- Zod schemas live in `packages/shared` and are reused for API validation.
- Change trigger: use Python (FastAPI, SQLAlchemy, Pydantic) only if the app needs heavy data or ML libraries. Keep the same folder layout and share types via an OpenAPI spec.
- Change trigger: move to a relational database only if the data outgrows what Firestore answers cheaply — cross-board reporting, aggregates over all notes, or joins that can't be a denormalized field. Firestore was chosen so the app has no idle database cost.
- Firestore has no schema and no migrations. Document shapes are declared in `apps/api/src/lib/db/types.ts`, and composite indexes in `firestore.indexes.json` at the repo root. Both are hand-maintained; nothing enforces them at write time.

## Frontend (React)

- Vite, React 19, TypeScript, React Router, TanStack Query.
- UI: shadcn/ui on Tailwind CSS. Use its components as the base for every screen. Do not hand-write components that shadcn already provides.
- Change trigger: switch to MUI only if the client requires Material Design.
- i18n: react-i18next. Message catalogues live in `apps/web/src/i18n/` (`de.ts` is the key
  authority, `en.ts` is held to its key set by `resources.test.ts`). Keys are English and name
  the string's role (`.label`, `.aria`, `.body`), never its content. No user-facing string
  belongs in a component — `noHardcodedCopy.test.ts` fails the build if one does. Anything
  held in React state is stored as a KEY and translated at render, or it goes stale on a
  language switch. `packages/shared` keeps the enum VALUES; their labels are web-only.

## Commands

All commands run inside Docker. The host needs only Docker and `make`.

| Command        | Purpose                                      |
| -------------- | -------------------------------------------- |
| `make up`      | Build and start the whole stack              |
| `make down`    | Stop and remove containers                   |
| `make logs`    | Follow logs of all services                  |
| `make test`    | Run all tests                                |
| `make lint`    | Run lint and type checks                     |
| `make seed`    | Load development seed data                   |

`make up` is the only command a new developer needs.

## Docker

- One `docker-compose.yml` at the root. Services: `api`, `web`, `firestore` (the Firebase emulator, built from `infra/firebase-emulator.Dockerfile`), plus any other dependency (redis, mailpit, etc.).
- All dependencies live in compose. Never ask the developer to install or run anything outside it.
- One `Dockerfile` per app, multi-stage: `dev` target with hot reload, `prod` target minimal.
- `.env.example` lists every variable. Compose reads `.env`. Never commit `.env` or write real secret values into the repo.

## Tests

- Backend: Vitest. Unit tests for business logic and validation. Integration tests for each API route against the Firestore emulator in compose. Each test file declares its own emulator project id so files stay isolated and can run in parallel.
- Frontend: Vitest + React Testing Library for components with logic (forms, state, conditional rendering). No tests for pure layout components.
- End-to-end: Playwright. One happy-path test per main user flow. No more.
- Test behaviour, not implementation. No snapshot tests. No tests that only check a mock was called.
- Target: every route and every business rule has a test. Do not chase a coverage percentage.

## Working rules

1. **Work in cycles, not one pass.** Plan → build → test → review → fix. Repeat until every requirement is done. At the end of each cycle, list what is done, what is open, and what you will do next. Do not stop while any item is open.

2. **Adapt the workflow to the task.** Do not follow a fixed script. Re-plan when you learn something new. If a requirement is unclear, ask before you build. If you find a gap or conflict, report it; do not fill it with an assumption.

3. **No skipped requirements, no shortcuts.** Before you build, write the full requirement list as a checklist. Every item must be implemented, tested, and marked done before you report completion. A stub, TODO, placeholder, or "can be added later" is not done. Do not remove or narrow a requirement to make it easier.

4. **Design and UX quality is a top priority, equal to correctness.** For every screen and flow: clear hierarchy, consistent spacing and typography, sensible defaults, loading, empty, and error states, keyboard and screen-reader access, responsive layout. Review each UI change as a designer would before you mark it done. If a design decision is not specified, choose the option a strong product designer would choose and explain why.

5. **Verify before you claim.** Run the app, run the tests, and check the UI. Report only what you have verified. If something does not work, say so.

## Git

- Branch names: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Small commits. Never commit directly to `main`. Never force-push.

## Ask before you do

- Delete files or folders.
- Change the stored document shapes or add a composite index.
- Add or upgrade a dependency.
- Touch authentication, authorization, or payments.
- Change scope or drop a requirement.

## Definition of done

- `make up` starts clean from an empty checkout.
- `make test` and `make lint` pass.
- Types check with no errors.
- No console errors in the browser.
- All requirements from the checklist are implemented and verified in the running app.