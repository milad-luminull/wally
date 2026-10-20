# Wally over MCP

**Status:** the first MCP surface is implemented locally; production remains disabled pending release validation.
**Last checked:** 2026-10-20. The API includes MCP routes, OAuth resource discovery and authorization checks.

Provider and delivery proposal: [Auth0 login and first MCP release](AUTH0_MCP_ROLLOUT.md)
and [ADR-0016](../adr/0016-auth0-for-web-and-mcp.md). These define the first release; the coverage
findings below do not imply full app parity in the first release.

The planned production endpoint is `https://api.wally.luminull.com/mcp`, hosted in the
existing API. Its OAuth resource/audience is the same exact URL; see the rollout RFC
for discovery and deployment configuration. This endpoint is implemented behind the MCP deployment switch.

## 1. Outcome

Let a user work with an authorized Wally board from an external AI host such as Claude or
ChatGPT. Reuse the [assistant operations](WALLY_AGENT.md#33-operations), permissions,
revisions, receipts and audit rules. The host runs the model; Wally serves board operations.

## 2. Requirements

- **User identity:** connect through per-user OAuth with discovery, authorization-code flow
  and PKCE. Do not use a shared static credential as the board actor. Validate issuer,
  resource/audience, expiry, scope and revocation on every call.
- **Explicit consent:** default to read-only; write access requires a deliberate choice.
  Name the client and explain that a host with write access may change notes without
  asking inside Wally. Wally cannot guarantee a host's confirmation behavior.
- **Bounded access:** enforce both connection scope and current board permissions. Bind
  every call to an authorized board; a note id alone must not select the scope. Filter
  private notes and related-note references exactly as the app does.
- **Revocation:** list connected apps with name, scope and authorization date. Revoke must
  take effect on the next call, including receipt replay. Do not erase already committed writes.
- **Switches and limits:** honor deployment and board assistant switches. Enforce identity
  and per-connection write rate limits. In-app turn limits do not bound separate MCP calls.
- **No separate write path:** validate inputs and use the existing operation registry and
  command transactions. The model cannot supply actor identity or trusted provenance.

## 3. Tool coverage

The original list copied the in-app assistant registry, which already has a board bound
by the browser. An external host needs to discover and select that board first.

### Board discovery

- Add `list_boards`: return accessible board ids, names and the caller's roles, restricted
  by connection scope. This must work without a previously known board id.
- Add `get_board`: return board metadata, role, revision and assistant availability.
- Each subsequent board/note call names its board explicitly. Switching boards means
  selecting another authorized id; it does not need a stateful `switch_board` tool.
- Recheck access per call. Discovery must not grant access to a board or bypass its switch.

### Existing assistant operations

Reads: `list_notes`, `get_note`, `list_members`.

Writes: `create_note`, `update_note`, `move_note`, `complete_note`, `reopen_note`,
`add_subtask`, `toggle_subtask`, `assign_note`.

`update_note` already supports title, description, dates, tags, custom properties, related
links, visibility and color. `get_note` already returns subtasks, but its adapter strips
note history. Do not add redundant field-edit tools just because those fields are not
named in the tool list. Existing permission and brand rules still apply; color must not become an automatic AI suggestion.

### Other gaps against the app

- **Board management:** `create_board` and `rename_board` have API commands but no assistant
  adapters. Board reads and writes must be added to the shared contract, not invented only
  inside the transport. Board creation has no pre-existing board revision.
- **Duplication:** the app's `note.duplicate` command has no `duplicate_note` operation.
- **Subtask editing:** `toggle_subtask` only changes completion; the API can also change
  text. Add text-edit support, reusing the existing subtask command.
- **History:** the board API returns note history, but `get_note` removes it. A history
  read must be added if external hosts should answer who changed a note and when.
- **Filtering and traversal:** `list_notes` lacks the API's private/shared visibility
  and custom-property filters. It returns at most 100 notes with a truncation flag and no
  continuation, so the host cannot reliably discover all matching notes on a larger board. Add bounded traversal
  and expose the existing property filter contract.
- **Metadata discovery:** the API can list visible board tags; no tool exposes that query.
  Property keys/values can be derived from visible notes but have no dedicated query.
  These are discovery conveniences, not missing tag/property write capabilities.
- **Membership and sharing:** only member listing is covered. Invites, member-role changes,
  removal, share-link inspection/creation/role changes/rotation/revocation and joining by
  link exist in the API but are absent from this draft. Decide which to expose and with
  what consent/scope. A share-link read exposes an access-bearing token; do not treat it as
  an ordinary read-only metadata tool.
- **Deletion and leaving:** board/note/subtask deletion and leaving a board exist in the
  app but are excluded from this initial surface. Destructive access requires its own
  confirmation design; do not silently enable it to claim feature parity.
- **Current user:** there is no `get_me` equivalent for profile identity and language.
  Do not assume the host knows which member id is the caller when assigning a note to me.
- **App settings:** profile language, display preferences and the board assistant switch
  have no MCP tools. Model-backed capture/review/Tidy also remain in-app workflows; an
  external host can perform their underlying note operations without invoking Wally's model.
  Exposing these settings/workflows is not required just to make board access usable.
- **Organizations/billing:** absent from the app itself, so they are not an MCP parity gap.

The gaps above are requirements/coverage findings, not implemented tools or authorization
to expose every administrative action. Resolve access-changing and destructive scope before
adding it. Read-only connections must neither receive nor execute write tools. Tool
annotations describe behavior; they are not access controls.

Every write carries a caller-generated UUID `operationId`, reused with identical input
and revision after a lost response. Existing-resource writes also carry the appropriate
note or board `expectedRevision`. A new intentional action uses a new id, even if the contents match.

Identical retries replay the stored result within the seven-day receipt window;
changed-input id reuse fails. Never deduplicate by note contents. Bind receipts and audit
to trusted connection context and recheck current scope/access before replay. An external
host retrying creation with a new id can create a duplicate; document that limitation.

## 4. Implementation constraints

Use the existing API and command layer without new always-on infrastructure. Support
remote MCP over Streamable HTTP without depending on one API instance's memory.

Choose maintained MCP and OAuth components when implementation begins. The earlier
`oidc-provider` recommendation, package names, registration fallback and one-day spike
were unverified implementation options, not product requirements or approved dependencies.
Verify the target hosts' current discovery, registration and callback requirements then.

Persist authorization state across instances and restarts. Store secrets securely;
rotate signing keys and refresh tokens, match redirect URIs exactly, protect consent
against CSRF, and disable development-only authentication behavior in production.

## 5. Completion criteria

- Verify discovery with zero, one and multiple owned/shared boards, board selection and
  traversal beyond 100 matching notes. Exercise every supported tool, scope and role,
  including private-note filtering,
  wrong-board calls, stale revisions, lost-response retries and connection-bound replay.
- Verify no duplicate write or audit event on replay, distinct intentional creations,
  changed-input id refusal, rate limits, revocation and both kill switches.
- Test discovery, registration, account linking, consent/denial, PKCE, redirect checks,
  invalid/expired tokens, refresh, key rotation and revocation across instances/restarts.
- Verify the deployed flow with MCP Inspector and the intended external hosts. Document
  actual write-confirmation and retry behavior; do not assume identical host behavior.
- Complete a separate security review and document operation/rotation in DEPLOY.md.
- Inventory authorization and connection records, retention and account deletion/export
  in [GDPR.md](../GDPR.md). Explain what a connected host receives in the privacy notice.

## 6. Decisions and remaining validation

Auth0 is the selected provider; the integration and web-login migration follow
[ADR-0016](../adr/0016-auth0-for-web-and-mcp.md). ChatGPT is the first target host.
A board owner must enable external AI access before a member can grant a client access;
each member then selects boards and explicitly allows any writes. Production host validation
and privacy-notice review remain release gates.

Do not add search/fetch, destructive tools or another transport until a concrete use case
requires them. Protocol and host compatibility should be checked against the
[official MCP specification](https://modelcontextprotocol.io/specification/) at that time,
rather than preserving dated vendor claims here.
