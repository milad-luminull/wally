# MCP card views

`show_card` and `show_cards` are read-only MCP tools that render Wally cards inside
ChatGPT. They show cards with Paper Wall styling, an Open in Wally link and a text
fallback. They cannot edit anything.

## Behavior

- **Fresh data only.**
  - `show_card` re-reads and re-authorizes the note.
  - `show_cards` takes the same filters, limit and cursor as `list_notes`.
  - The widget never renders model-supplied titles or URLs.
- **Layout.**
  - Five or more cards switch to compact rows; smaller lists show full cards.
  - Descriptions and tags sit under Details.
  - Lists scroll in a bounded region and say when another page exists.
- **The widget is self-contained.**
  - It loads no external scripts, fonts, images or requests.
  - Note data is set with `textContent`.
  - Links go only to the configured Wally web origin (`CORS_ORIGIN`).
  - Only messages from the embedding parent are accepted, and no credentials enter the UI.
  - The server declares an empty network and resource CSP allowlist.
- **No stale HTML.** The resource URI carries a content hash, so refreshing tools never
  serves stale markup.
- **Protocol.** The widget handles MCP Apps initialization, result and context
  notifications, resize, link opening and teardown. The text result stays usable in hosts
  without UI support.

## Open check

Card and list rendering were verified in ChatGPT with its CSP enforcement switched off.
Repeat the check with enforcement on before treating the widget as production-ready.

Sources: [ChatGPT UI](https://developers.openai.com/plugins/build/chatgpt-ui),
[MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).
