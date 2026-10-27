# Expanded note details

> **Status:** executed in PR #61.

## Goal

Match the side-panel and expanded-note presentations in `../wally-design/Wally Paper Wall v3.dc.html` while keeping every current note field and action.

## Architecture

One mounted editor serves both presentations. The desktop panel overlays the workspace (without shifting board lanes); expansion fills the entire app viewport, including the sidebar area, as clarified by the user. Covered board content becomes inert. Mobile keeps its existing sheet. Expansion is transient UI state and never changes stored note data.

## Constraints

Use palette tokens in light and dark appearances, including Minimal. Preserve autosave, drafts, permissions, pending reviews, links, custom fields, tags, history, duplicate and delete/undo. Do not add reference-only scheduling, focus, estimates, or a separate Notes field. Do not change the bind-mounted live checkout or emulator data.

## Tasks

1. Add regression tests for expand/collapse, Escape, typing shortcuts, draft/editor identity and read-only/mobile behavior. Run them red, implement the presentation state and workspace integration, run them green.
2. Apply the reference geometry: 360px drawer, 52px quiet header, 22px drawer title; expanded 56px header, centered 680px article, 38px title, compact metadata, 17px description, roomy circular checklist. Retain property editors below the content; resize textareas after width changes. Check existing editor tests.
3. Verify frontend typecheck, lint, full unit suite, production build, and desktop/mobile light/dark visual states. Review the complete diff and resolve actionable findings. Provide a preview and update GitHub with a fresh follow-up PR because #60 is merged.

## Review focus

No draft loss on presentation changes; no hidden board focus while expanded; dropdown Escape must not collapse the editor; mobile and read-only behavior; palette contrast; no additional data or permission changes.

## Follow-up scope from the user

Match the reference card's hover toolbar: direct full-screen opening and a More menu with Duplicate and Delete. Keep the controls reachable from the keyboard, preserve existing delete/Undo, and omit edit actions on read-only notes. Apply to Priority, This Week and Whiteboard cards; keep drag and suggestion review interactions intact.

## Additional UI refinements

Add Open, completion/reopen and Make private to the card menu using existing mutations and creator/edit permissions. Collapse the sidebar to the reference's 52px icon rail while preserving keyboard focus and navigation. Keep the public root visible for signed-in users, replacing authentication calls to action with Open Wally links to their boards. Verify these together against the real backend in a browser regression. The sample preview's read-only colour failure is confined to its local adapter; enable session-only sample edits separately from production code.

The open note must remain clearly selected behind the side panel. Use the palette selection token directly for a persistent inset outline, and expose the current note on both cards and list rows. Remove the selection when the detail panel closes.
