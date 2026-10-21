# MCP card views

Approved scope: display-only single card and list of cards inside ChatGPT, with Wally
Paper Wall styling, Open in Wally links, and text fallbacks. No inline writes.

## Implementation checklist

- [x] Add `show_card` and `show_cards` read-only tools with explicit output schemas.
- [x] Reload authorized server data; never render model-supplied titles or arbitrary URLs.
- [x] Serve a versioned self-contained MCP Apps resource behind existing authentication.
- [x] Render title, description, status, priority, due date, assignee and tags; hide IDs/revisions in Details.
- [x] Support light/dark, narrow screens, keyboard focus, empty/loading/error states and partial lists.
- [x] Preserve existing 13 tools, write receipts and permissions.
- [x] Test resource discovery, schema, denied access, safe text rendering and host bridge.
- [x] Verify local visual rendering and ChatGPT card/list rendering separately.
- [x] Preserve manual grants, tunnel and synthetic fixtures; document and push changes.

Design: two display tools use existing get/list queries and board metadata, returning
a compact card projection. Only those tools declare UI metadata. A static HTML/CSS/JS
resource uses the MCP Apps bridge, with no external scripts, fonts, requests or credentials.
Links are derived from configured Wally web origin and encoded IDs. Cards are snapshots;
Open in Wally opens the live note. Lists show returned count/total and pagination notice.

Sources: https://developers.openai.com/plugins/build/chatgpt-ui and
https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

## Verified behavior

- `show_card` displays a freshly authorized note; `show_cards` accepts the same filters,
  limit and cursor as `list_notes`. The original 13 data/write tools remain unchanged.
- Lists of five or more returned cards automatically use compact rows. Descriptions and
  tags stay available under Details. Smaller lists use full cards. Lists scroll within
  a bounded region; an explicit next-page notice appears when a cursor exists.
- Resources use a content-hashed URI to prevent stale HTML after refreshing tools.
- No external scripts, fonts, images or API requests are needed by the widget. Note data
  uses textContent, links are restricted to the configured Wally web origin, and only
  messages from the embedding parent are accepted. No credentials enter the UI.
- Standard MCP Apps initialization, result/context notifications, resize, opening links
  and teardown are handled. The text result remains usable in clients without UI.

## Validation record (2026-10-21)

The complete API suite passed: 698 tests in 66 files. The final web suite passed:
852 tests in 101 files, including five widget DOM tests. Existing React act() and
Vitest deprecation warnings appeared in unrelated web tests; there were no failures. API typecheck/build and focused
lint passed. The new HTTP test verifies discovery/resource reads, output schemas,
card/list data, denied-board access, and refusal after revocation in the isolated
`wally-mcp-http` test project. All 15 tools round-trip via the official SDK client.

The widget's exact shipped script is exercised in the existing web DOM test environment:
text escaping, safe links, foreign-frame rejection, host initialization/theme changes,
compact rows, empty/paginated lists, errors clearing stale data and teardown.
A local browser preview separately verified light/dark, narrow layouts and compact rows.

Real Auth0 / ChatGPT verification used the existing active write-validation plugin and
only read the five synthetic notes. Conversation:
https://chatgpt.com/c/6ad8c131-f6a8-83ed-a26e-d25fc987048e

- `show_card` rendered the owner's existing Dummy card.
- `show_cards` rendered all five existing notes.
- No notes were created or edited and no grant was revoked.
- ChatGPT's developer UI displayed “CSP off” during this check. That existing host
  setting was not changed. The server declares an empty network/resource CSP allowlist,
  but this run does not prove host enforcement of it. Verify with CSP enforcement on
  before considering the UI ready for production publication.

## Manual testing

Keep the existing local services, tunnel and manual consent active. Use the installed
**Wally local MCP write validation** plugin. After code changes affecting tools/resources,
use its Manage → Refresh tools action (no disconnect/reconnect or grant revocation).
Ask “Show the Dummy card on mcp-local-owner” or “Show my cards on mcp-local-owner”.
For a mutation, perform the normal tool operation once, then call show_card with the
returned note ID; displaying the card never repeats the write. Local links point to
localhost:5174; deployment uses the configured CORS_ORIGIN for Wally links.

A separate read-only code review found no important correctness or security issues.
The final content-hashed resource was refreshed in the existing ChatGPT plugin;
manual consent was retained. No new packages were added.

Final browser checks also confirmed Details expansion and Open in Wally: ChatGPT
showed its external-link confirmation and opened the correct localhost board/note URL.
The final refreshed compact list rendered all five existing notes in the same test
conversation. These were read-only checks; consent and fixtures remained intact.
