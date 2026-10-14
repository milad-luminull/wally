# Wally over MCP — plan

**Status:** proposal, not yet approved. Blocking decisions are in §8.
**Sequencing:** after the in-app assistant ([`WALLY_AGENT.md`](WALLY_AGENT.md)) reaches its
agentic stage, or in parallel once its M1 has landed, since M1 is the tool set this
proposal serves. Nothing in the assistant plan depends on this document.
**Last revised:** 2026-10-12. Facts were checked on that date (§9); re-check them before
building, since this landscape changes monthly.

Read next to [`WALLY_AGENT.md`](WALLY_AGENT.md), which defines the tools (§4.2 there), the
command layer they call ([ADR-0010](../adr/0010-board-commands-revisions-and-receipts.md))
and the attribution and audit rules. This document adds a transport and a token layer; it
does not define a second tool set.

---

## 1. Outcome

A person adds Wally as a connector in Claude or ChatGPT and works their board from there:
"what is open today?", "move my overdue notes to this week". The host's model does the
thinking, so Wally pays no model tokens. The same tools, role checks, revision checks and
audit events apply as in the in-app assistant.

**What Wally can and cannot guarantee.** The host owns the conversation, and Wally cannot
see whether a person was asked before a tool ran. The MCP spec says hosts SHOULD keep a
human in the loop and that tool annotations are hints a client may ignore; the plan treats
them as exactly that. What Wally guarantees is narrower and enforced server-side:

- a connection is read-only unless the person chose write access on the consent page;
- a write token can never delete;
- every write still goes through the command layer with the caller's role and the note's
  revision, and is attributed to the connection in a transactional, contents-free audit
  record;
- a connection can be revoked from the account menu, and the host's next call gets 401.

---

## 2. What v1 delivers

| Outcome                         | The user can                                                          | Done when                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Work from Claude or ChatGPT** | Add Wally as a connector and say "move my overdue notes to this week" | The connector signs in with the user's Wally account, offers read-only by default and read-write on explicit choice, lists the same tools, and host confirmation behaviour is verified and disclosed. The result is on the board on the next refetch, attributed to the connection in the server audit.                                                             |
| **MCP writes are bounded**      | —                                                                     | The consent page defaults to read-only. A `read` token does not see write tools and gets 403 if it calls one. No token can call `delete_note`; it is not offered over MCP. Writes per token are rate limited. Every write uses the caller's role and a stable action id, with `expectedRevision` except on creation, and commits a connection-specific audit event. |
| **Roles hold**                  | —                                                                     | A VIEW member gets read tools only. Asked to change something, the host is told the connection can only read on this board.                                                                                                                                                                                                                                         |
| **Stale changes are refused**   | —                                                                     | A write whose `expectedRevision` no longer matches fails with `409 STALE_REVISION` inside the command transaction and the tool result says so with the current revision.                                                                                                                                                                                            |
| **Connections can be revoked**  | Open Connected apps and press Revoke                                  | The account menu lists every connected app with its scope and date; after Revoke, the host's next call gets 401.                                                                                                                                                                                                                                                    |
| **It can be switched off**      | —                                                                     | With `ASSISTANT_ENABLED=false`, or the board's own switch off, the MCP route answers 404 for that scope, and `make test` passes.                                                                                                                                                                                                                                    |

**How success is read,** four weeks after launch, from counters per connection: how many
active users connected a host and how many chose write access; tool calls by tool, reads
versus writes, and stale refusals.

### Not in v1

- **No delete over MCP.** Wally cannot confirm a destructive call through a host it does
  not control, so `delete_note` stays panel-only. The MCP spec's elicitation feature is the
  standard way for a server to ask the user directly; clients declare support at
  initialization, and whether it works through the stateless transport in D1 is
  unverified. It is the path to offering delete later (§5).
- **No `search` and `fetch` tools.** ChatGPT needs those two read-only tools only for deep
  research and company knowledge, not for an ordinary connector.
- **No static API keys or bearer headers.** Neither host accepts them for a per-user
  connection, and Claude's header option identifies an organisation, not a person.

---

## 3. Decisions

### D1 — The MCP server runs inside the existing API

The tools from the assistant plan, minus `delete_note`, are served at `POST /mcp` with the
Streamable HTTP transport of the official TypeScript SDK (`@modelcontextprotocol/server`
and `@modelcontextprotocol/node`), in stateless mode, so no session state lives in the
Cloud Run instance. The transport writes to Node's raw response, so the Fastify route calls
`reply.hijack()` and passes the already-parsed body to the transport. The endpoint is
subject to the same `ASSISTANT_ENABLED` switch, the existing rate limit keyed on the user
id, and the command layer's role checks. Nothing thinks on Wally's side: the host's model
does, so an MCP turn costs Wally only Cloud Run and Firestore.

**There is no "turn" over MCP.** Stateless means each `tools/call` is its own request, so
the assistant's per-turn limits do not apply. What applies instead: the identity rate
limit, a second limit on writes per token per minute (a starting number: 30), the token's
scope, and the command layer's revision check on every write.

**Operation ids over MCP.** Every write tool requires a caller-supplied UUID `operationId`
in addition to its business input. The caller creates it once per intended action and
reuses it, with identical input and expected revision, after a timeout or lost response.
The adapter passes it unchanged to the command layer; it never generates a new id for a
retry and never substitutes the JSON-RPC request id. A fresh intentional action uses a
fresh UUID, even when its contents match an earlier action. Tool descriptions state this
contract.

The command receipt, not the revision alone, prevents duplicate creation: `create_note`
has no prior revision. Identical retries replay the committed result; changed-input reuse
fails with `IDEMPOTENCY_KEY_REUSED`. Current token scope, connection status, board access
and the board's assistant switch are checked before replay. The supported retry window is
seven days from the first attempt. No deduplication by note contents is permitted.

**Decided: writes are enabled without a host compatibility gate.** The `operationId`
contract above is required in the tool schema and explained in every write tool's
description, so a host that preserves it gets exact-once creation. A host that re-calls
`create_note` with a fresh id after a lost response can create a visible duplicate, which
the person sees on the board and can delete in the app; every write to an existing note
stays protected by the revision check regardless. MC2 records, per host, whether the id was
reused in its connector test, as information for the user, not as a gate.

### D2 — Authorization: the MCP endpoint is a resource server; the token layer is a library

Claude and ChatGPT connect from their cloud to a public URL and require OAuth 2.1 with
PKCE `S256`, discovery through RFC 9728 protected resource metadata and RFC 8414 or OIDC
authorization server metadata, and a client registration method: the 2026-07-28 MCP
specification prefers Client ID Metadata Documents and keeps dynamic client registration
as deprecated compatibility. ChatGPT does not accept a custom static API key. Claude offers
static headers to some organisations in beta, but those identify the organisation, not the
person, so they do not satisfy Wally's actor model.

The MCP endpoint is the **resource server**. The SDK's `requireBearerAuth` takes a verifier
Wally supplies and an explicit expected resource; the verifier validates issuer, audience,
expiry, scopes and the connection's current revocation state on every call. The middleware
does not supply an authorization server, and Firebase Authentication is not one: it
answers who the user is, but it cannot register Claude or ChatGPT as clients, issue tokens
bound to `/mcp` with Wally's scopes, or revoke one connection.

Google sign-in stays the user-facing login in every option below. The decision is only
who issues and manages the tokens behind the consent screen.

| Option                                                | For                                                                                                                                                                                                                                                          | Against                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In-process, on `node-oidc-provider` — recommended** | No new vendor or processor; zero idle cost; a certified, maintained OAuth 2.0 and OIDC server that lists RFC 8414, RFC 7591, PKCE, RFC 8707, RFC 9207, RFC 7009 and refresh rotation, mounts in Fastify 5 through middie, and stores through a small adapter | Client ID Metadata Documents not confirmed in the library; a Koa-based app mounted inside Fastify; Wally owns the adapter, the login and consent interaction and the registration policy |
| A hosted identity provider                            | Maintained end to end; OpenAI and the MCP SDK docs recommend one; CIMD support where verified                                                                                                                                                                | A new vendor and processor in GDPR.md §3 with a DPA, account linking to the Firebase user, a second login screen, and a price tier for a handful of users                                |
| Hand-written authorization server                     | Smallest dependency footprint                                                                                                                                                                                                                                | Security-sensitive protocol code and continuing maintenance; the SDK's own helpers for this are frozen in a legacy package and its docs steer away from it                               |

**Why the library.** Both vendors' advice amounts to "do not hand-roll OAuth". A certified
library in the same process meets that intent without a vendor, which is what the
project's constraints ask for: no new processor, nothing running idle, no lock-in, and glue
code rather than protocol code on Wally's side. The protocol the hosts speak is the open
standard either way, so a later move to a hosted provider changes the issuer, not the
clients' expectations.

**What Wally writes:** a Firestore adapter for the library's storage interface; the login
and consent interaction, which reuses the Firebase Google sign-in and preselects read-only;
the two scopes `read` and `read write`; the client registration policy; the protected
resource metadata for `/mcp` with the library as its authorization server; and the token
verifier for `requireBearerAuth`. Tokens are bound to the canonical `/mcp` resource URL
(RFC 8707). Refresh tokens rotate, redirect URIs match exactly, and revocation from
Connected apps takes effect on the next call. Codes and token hashes live in Firestore
through the adapter.

**Production operation is Wally's, and the library says so.** Its documentation leaves to
the application: a persistent adapter, since the default is in-memory and for development
only; the `jwks` signing keys and the `cookies.keys` cookie-signing keys, which default to
nothing usable; their rotation, in the documented order of append, reload, promote, reload;
and disabling `features.devInteractions`, which is on by default and "accepts arbitrary
credentials". So MC2 requires: both key sets loaded from Secret Manager and shared by every
Cloud Run instance, a written rotation procedure in DEPLOY.md, development interactions off
in production builds and asserted at boot like the emulator guard in `env.ts`, and the
token-layer tests run with two API processes sharing the emulator and across a restart, so
login, refresh, replay and revocation survive instance changes. One successful Inspector
login in MC1 proves the flow, not production readiness.

**Registration today, CIMD tomorrow.** Dynamic client registration works with both hosts
today. If the library does not support Client ID Metadata Documents, Wally adds a client
lookup hook that fetches an HTTPS `client_id` URL, validates the document and its redirect
URIs, blocks private and loopback addresses, and limits the response size, as other
servers that implement the draft do. That hook is a known shape, not new protocol design.

**A one-day spike before MC2 commits.** Mount the library on a branch, register a client
from the MCP Inspector, complete sign-in and consent with a Google account, and call `/mcp`
with the resulting token through `requireBearerAuth`. If that works end to end, MC2 starts.
If it does not, the hosted provider is the fallback and the day is the whole cost.

**Consent and account linking are tested end to end:** the host discovers the resource
metadata and the authorization server, which validates the client, redirect, PKCE and
requested resource. Sign-in resolves to the existing Wally account without trusting an
email or actor id supplied by a tool. Consent shows the verified client identity and the
scope in plain words, with read-only preselected and one sentence that a host with write
access may change notes without asking. Test state and CSRF protection, account switching,
denial, replay, refresh and revocation. MC2 includes an independent security review
against the current MCP authorization requirements; a checklist is not a substitute for
that review.

### D3 — Attribution and provenance are the assistant plan's, with a connection id

The adapter supplies `via: mcp` and the `connectionId` as trusted execution context, never
as model-controlled arguments. Receipts bind the operation to that context, so a different
connection cannot replay another connection's result. The audit event defined in the
assistant plan (§4.2 there) is written in the same command transaction, with the
connection id in place of the conversation and approval ids.

---

## 4. How it works

### 4.1 Shape

```
Claude · ChatGPT · Claude Code ─▶ Cloud Run: apps/api (Fastify)
              ├── POST /mcp ◀── requireBearerAuth, stateless Streamable HTTP
              ├── /.well-known/oauth-protected-resource ── points at the issuer below
              ├── /oauth/* ── node-oidc-provider mounted through middie (D2)
              │     └── login and consent: the web app's Firebase Google sign-in
              └── lib/commands: executeBoardCommand ── the same tools as the panel
                    └── Firestore: notes · receipts · audit · OAuth clients, codes, token hashes
```

### 4.2 Tools over MCP

The table in the assistant plan is authoritative. Over MCP:

| Tool                                                                                                                      | Scope   | Offered |
| ------------------------------------------------------------------------------------------------------------------------- | ------- | ------- |
| `list_notes`, `get_note`, `list_members`                                                                                  | `read`  | yes     |
| `create_note`, `update_note`, `move_note`, `complete_note`, `reopen_note`, `add_subtask`, `toggle_subtask`, `assign_note` | `write` | yes     |
| `delete_note`                                                                                                             | —       | no      |

- **Identity comes from the token.** The actor is the user behind the OAuth token; the
  command layer resolves the role inside the transaction.
- **Board context is explicit.** Each call is bound to an authorized board; `boardId` goes
  to note commands and `expectedBoardId` to `getNote`; the effective assistant switch and
  the connection's current scope are enforced on reads, writes and receipt replay. The
  current board is never inferred solely from a model-supplied note id.
- **Writes carry `expectedRevision` and `operationId`** as D1 describes.

### 4.3 UI

- **Consent page:** the client's name, the scope as two choices with read-only preselected
  ("read your boards" or "read and change your boards"), the one-sentence warning, and
  Allow and Deny.
- **Connected apps** in the account menu: each authorised client with its name, scope and
  date, and Revoke.
- **Switches:** the board owner's per-board switch and the deployment switch from the
  assistant plan apply unchanged.

### 4.4 Tests

In CI on every PR, the MCP endpoint is exercised with the SDK's client over an in-memory
transport against the Fastify app and the Firestore emulator: tool listing per scope and
role, `delete_note` absent, annotations, every tool's happy path with the revision it
returns, the `409 STALE_REVISION` path including a subtask change in between, the
retry-after-lost-response path including creation, changed-payload key reuse, separate
intentional identical creations, the write rate limit, and 401/403 on bad, expired and
under-scoped tokens. Test connection-bound replay, no duplicate audit event on replay,
board binding, and revocation and kill-switch checks. Test the token layer's discovery,
registration, exact redirect matching, PKCE failures, account linking, refresh and
revocation, and the read-only default. Run the token-layer tests again with two API
processes sharing the emulator and after a restart, so login, refresh, replay and
revocation survive instance changes. Before MC2
closes, the deployed endpoint is checked
by hand with the MCP Inspector and with one Claude and one ChatGPT connector.

### 4.5 Cost

| Cost         | Shape                                             | Stop                                                                       |
| ------------ | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Model tokens | None for Wally                                    | —                                                                          |
| Cloud Run    | Milliseconds per tool call                        | Scale to zero stays; the identity rate limit and the per-token write limit |
| Firestore    | A few reads per call, a few writes per write tool | Inside the free daily allowance at this scale                              |

Nothing runs idle. The token layer is routes in the same service and documents in the same
database.

---

## 5. Milestones

Each milestone is one PR and leaves `make test` and `make lint` green. M1 of the assistant
plan (the tool set, provenance and audit events) is the prerequisite.

| #   | Outcome                           | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MC1 | The token layer is proven         | The one-day spike from D2: the library mounted on a branch, a client registered from the MCP Inspector, sign-in and consent with a Google account, and a `/mcp` call accepted through `requireBearerAuth`. Outcome recorded here, and decision 2 in §8, the token layer, taken on it.                                                                                                                                                                                                                                                                                                   |
| MC2 | **Works from Claude and ChatGPT** | `POST /mcp` as a resource server without `delete_note`, stable action ids, the per-token write limit, the token layer with PKCE, registration, scopes, account linking and exact redirect matching, the consent page with read-only preselected, Connected apps with Revoke, the CI tests from §4.4, an independent security review, the GDPR.md entries from §6, both key sets from Secret Manager with development interactions off and the rotation procedure written, the two-process and restart tests from §4.4, and a verified connection from a Claude and a ChatGPT connector. |

**After launch,** each behind its own flag:

- **Delete over MCP through elicitation,** once it is verified to work through the
  stateless transport with both hosts.
- **Client ID Metadata Documents** through the lookup hook, if the library has not added
  them by then.
- **`search` and `fetch`** for ChatGPT deep research over a board.

---

## 6. Data protection checklist (part of MC2)

- [ ] GDPR.md §2: inventory OAuth clients, authorization codes, token hashes and
      connected-app records, all deleted with the account (GAP-01). If a hosted provider is
      chosen instead, inventory its account-link data and add it as a processor in §3.
- [ ] GDPR.md §3: record that over MCP, note text goes to the AI host the user connected,
      on the user's own account, and how shared boards are handled (§8, decision 3).
- [ ] ORG-04: the privacy notice names the MCP connection, the two scopes, and what a
      connected host can read and change.
- [ ] The audit events' inventory, retention and GAP-08 review from the assistant plan's
      M1 are complete before MCP writes launch.

---

## 7. Risks

| Risk                                                  | Mitigation                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The token layer has a flaw                            | A certified library for the protocol; the MCP authorization spec's MUSTs as the review checklist; short-lived tokens; exact redirect matching; CI tests for the failure cases; one reviewer who did not write it |
| A host writes without asking the person               | Read-only is the default scope; write access is an explicit choice with a plain warning; no delete over MCP; the per-token write limit; revision checks; connection-specific audit events                        |
| A host retries a lost response with a fresh id        | Existing notes are protected by `expectedRevision`; creation may duplicate visibly, as D1 decides; the person sees it on the board                                                                               |
| The library lacks Client ID Metadata Documents        | Dynamic registration works with both hosts today; the lookup hook is a known shape; a hosted provider remains the fallback                                                                                       |
| Another member's note text reaches the user's AI host | Decision 3 in §8 is the controller's; the consent page and notice disclose it                                                                                                                                    |

---

## 8. Open decisions

**Blocking MC1:**

1. **The spike.** Approve the one-day spike from D2 on a branch, with `oidc-provider`,
   `@fastify/middie`, `@modelcontextprotocol/server` and `@modelcontextprotocol/node`
   installed for that branch only. _Engineering._

**Blocking MC2:**

2. **Token layer.** In-process on `node-oidc-provider` as recommended, a hosted identity
   provider, or a hand-written server with its own design? Decided on the spike's outcome.
   _Engineering / Controller._
3. **Other members' notes through a member's own AI host.** Allow it on all boards, only on
   boards the user owns, or only with the owner's consent? _Controller._
4. **Dependencies on `main`.** Approve the packages the chosen token layer needs, plus the
   two MCP packages. SETUP.md ("Ask before you do") requires asking. _Engineering._

---

## 9. Evidence (checked 2026-10-12)

- **MCP authorization spec (2026-07-28):** the MCP server is an OAuth 2.1 resource server
  that MUST serve RFC 9728 protected resource metadata and validate token audience (RFC
  8707); authorization servers MUST provide RFC 8414 metadata or OpenID Connect Discovery;
  authorization servers and clients SHOULD support Client ID Metadata Documents and MAY
  support dynamic client registration, which "is deprecated and retained for backwards
  compatibility"; clients validate the RFC 9207 `iss` parameter.
  https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- **MCP tools spec:** "there SHOULD always be a human in the loop with the ability to deny
  tool invocations"; "clients MUST consider tool annotations to be untrusted unless they
  come from trusted servers"; servers MUST validate inputs, implement access controls and
  rate limit tool invocations.
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- **MCP elicitation:** a server sends `elicitation/create` and the client answers accept,
  decline or cancel; clients that support it "MUST declare the `elicitation` capability
  during initialization".
  https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
- **MCP TypeScript SDK:** Streamable HTTP in stateless mode through
  `NodeStreamableHTTPServerTransport`, `requireBearerAuth` with a supplied verifier and an
  explicit expected resource, and a client with an in-memory transport for tests. The
  authorization-server helpers are frozen in `@modelcontextprotocol/server-legacy`, and the
  docs recommend "a dedicated identity provider".
  https://github.com/modelcontextprotocol/typescript-sdk ·
  https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization
- **`node-oidc-provider`:** its README lists RFC 8414, OIDC Discovery, RFC 7591 and RFC 7592
  registration, RFC 7009 revocation, PKCE, RFC 8707 resource indicators, RFC 9207, refresh
  token rotation and custom adapters, and its docs show mounting in Fastify 5 through
  `@fastify/middie` with `provider.callback()`.
  https://github.com/panva/node-oidc-provider
- **Claude custom connectors:** remote servers reachable from Anthropic's cloud; per-user
  OAuth with CIMD or DCR, or a manually entered client id and secret; organisation-wide
  static headers are a limited beta; callback `https://claude.ai/api/mcp/auth_callback`,
  and `https://claude.com/api/mcp/auth_callback` to be allowlisted as well.
  https://support.claude.com/en/articles/11503834 ·
  https://claude.com/docs/connectors/building/authentication
- **ChatGPT connectors:** "We strongly recommend that you use an existing established
  identity provider"; OAuth with CIMD preferred and DCR supported; authorization-code flow
  with PKCE `S256` required; no API keys or client-credentials grants; the resource server
  must verify signature, issuer, audience and scopes itself; redirect
  `https://chatgpt.com/connector_platform_oauth_redirect` or a callback-specific URI;
  manual confirmation is required before write actions; `search` and `fetch` are required
  only "to work with ChatGPT deep research and company knowledge".
  https://developers.openai.com/plugins/build/auth ·
  https://developers.openai.com/api/docs/mcp
- **MCP Inspector** for checking the endpoint by hand.
  https://github.com/modelcontextprotocol/inspector

**Not verified first-hand:** Client ID Metadata Document support in `node-oidc-provider`;
whether elicitation works through the stateless Streamable HTTP transport and which hosts
support it; whether either host reuses a tool-call operation id after a lost response.
