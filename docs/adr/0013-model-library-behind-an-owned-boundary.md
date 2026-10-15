# ADR-0013: The Vercel AI SDK as the model library, behind a boundary Wally owns

- **Status:** proposed
- **Date:** 2026-10-15
- **Deciders:** Milad Rezazadeh
- **Supersedes:** none

## Context and problem statement

The assistant proposal ([`WALLY_AGENT.md`](../rfcs/WALLY_AGENT.md)) needs code that sends
messages and tool definitions to a model, runs the tool-call loop, pauses a write tool until
a person approves it, and normalises each provider's output. The proposal requires that the
model provider is configuration, that a user can bring their own key for several vendors, and
that leaving any provider or library is cheap. The question is which library provides that
loop, and how to keep Wally from depending on it.

## Decision drivers

- Switching provider must be configuration, not code: maintained first-party adapters for
  OpenAI, Anthropic, Google and Vertex.
- The pause-for-approval flow must be the library's documented feature, with the approved
  input guaranteed to be the one the model proposed. Wally must not write its own.
- Each model attempt must be interceptable, so the budget reservation in the proposal can run
  before every call, including steps inside the library's tool loop.
- Local development with any API key and no cloud login.

## Considered options

1. **Vercel AI SDK (`ai`, `@ai-sdk/*`):** good, because it has first-party adapters for all
   four providers and a documented tool-approval flow that never substitutes the approved
   input; bad, because it ships a major version about every six months.
2. **Genkit:** good, because it aligns with Firebase; bad, because its pause feature is
   still Beta and its non-Google providers are secondary.
3. **Google ADK for TypeScript:** good, because it is built for Vertex; bad, because the
   package registers only Google models, which rules out own keys for other vendors.
4. **The providers' own SDKs, with a hand-written loop:** good, because no shared dependency;
   bad, because Wally would own the approval pause, the loop and four normalisations.

## Decision outcome

Chosen option: **1**, the Vercel AI SDK, behind a boundary that Wally owns:

- `ai` and `@ai-sdk/*` are imported only in `apps/api/src/lib/assistant/model/`, enforced
  with ESLint `no-restricted-imports` in the shared config.
- That directory exposes one function: run a turn with messages, tools, approval responses
  and provider configuration, and return the final message, pending approvals, tool calls
  and usage in Wally's own types. It exposes a hook per model attempt for budgeting.
- The library's automatic retries are off; every retry is Wally's and takes its own
  reservation.
- Tools, the stored pending approval, conversations, caps and the eval are Wally's code and
  do not depend on the library.

### Consequences

- Good: a provider or model change is configuration; a library change is one directory,
  proven by the eval before it ships.
- Bad: a major upgrade roughly twice a year, and every upgrade is reviewed against the
  boundary's contract. Accepted because the boundary caps the blast radius.
- Bad: provider-specific reasoning state cannot be replayed across providers, so a
  conversation is pinned to the model it started on.
- Neutral: the first PR that imports the library adds the lint rule and the boundary tests.

### Confirmation

The lint rule fails CI on any import of `ai` or `@ai-sdk/*` outside the boundary directory.
The CI eval runs with model responses recorded at the boundary, in Wally's types, and needs
no credentials. The live eval runs before any model change.

## More information

Vendor facts were checked on 2026-10-12; re-check before an upgrade.

- AI SDK tool approval: `toolApproval` returns a `tool-approval-request`, answered with a
  `tool-approval-response`; the SDK "never replaces the approved input with a different
  value". https://ai-sdk.dev/docs/agents/tool-approvals
- AI SDK providers and `maxRetries: 0`.
  https://ai-sdk.dev/providers/ai-sdk-providers/google-vertex ·
  https://ai-sdk.dev/docs/ai-sdk-core/settings
- Genkit interrupts are "not yet part of Genkit's stable API".
  https://genkit.dev/docs/interrupts/
- `@google/adk` registers only Google models. https://github.com/google/adk-js
- Re-evaluate when a multi-turn workflow needs to be resumable, when a second agent exists
  to delegate to, or when an upgrade costs more than rewriting the boundary.
- Requirements this serves: [`WALLY_AGENT.md`](../rfcs/WALLY_AGENT.md) §3.5.
