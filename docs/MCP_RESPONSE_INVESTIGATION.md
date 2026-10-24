# MCP response investigation

## Repository and test constraints

- Work only on `codex/auth0-mcp` in the PR worktree. Preserve the original dirty checkout.
- Never recreate/remove original `wally-api-1` or inspect/export its private migration data.
- No production requests, credentials, writes, deployment, merge, or Auth0 configuration changes.
- Run tests inside `wally-mcp-local-api-1`, against its isolated Firestore emulator.
- Automated data resets are confined to `wally-mcp-http`; retain manual `wally-mcp-local` fixtures.
- Synthetic verifier injection is confined to existing automated test construction. It is not real OAuth evidence.
- Keep JWT, scope, board permission, consent, revision and operation-ID checks unchanged.
- No new dependencies. No speculative server changes to compensate for a browser error.

## Checklist and safe local strategy

- [x] Read registration, shared input schemas, serializer, errors, transport and command receipts.
- [x] Consult current official MCP tools/transport and OpenAI plugin reference documentation.
- [x] Start with text-only SDK transport result, then structured content, then metadata.
- [x] Validate actual Wally results with the official SDK client and result schemas.
- [x] Exercise all 13 tools, including create/update/list/get, with synthetic data.
- [x] Check malformed requests, HTTP content type/status, notifications and auth denials.
- [x] Verify identical replay, changed-input operation-ID rejection, revision conflicts and revoked replay.
- [x] Run focused suites, lint, typecheck and review the final diff.
- [x] Document findings without claiming an unverified ChatGPT root cause or fix.

## Evidence boundary

The previous fresh ChatGPT no-tool control (`CONTROL_OK`) reproduced the same rendering
fallback. Its DOM had `data-dil-render-failed`. This establishes a failure independent
of Wally, but does not identify the underlying ChatGPT/browser cause. All manual Wally
grants were left revoked. Automated transport tests do not prove ChatGPT rendering.

Sources:

- https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://developers.openai.com/plugins/reference

The installed SDK is v1.32.1 and the tested wire version is 2025-11-25. Current MCP
material also describes the newer 2026-07-28 protocol; this audit does not silently
upgrade the negotiated version. In 2025-11-25 an output schema is optional; OpenAI's
current reference recommends declaring one for structured content. Missing declarations
are an interoperability/documentation gap, not established causation of this failure.

## Results (2026-10-21)

**No Wally root cause established.** The same saved ChatGPT conversation fails to render
in the original Chrome session and renders successfully in a separately signed-in
in-app browser with the same account. No response was regenerated and no MCP operation
was repeated for this comparison. The working view displays the created note ID and
revision, identical replay result, and denied-board error. The separate no-tool
`CONTROL_OK` conversation also renders correctly in the clean browser and had failed
in Chrome. This isolates a browser/session-dependent ChatGPT rendering problem; it does
not establish whether cached assets, an extension, session state, or a ChatGPT rollout
caused it. Those explanations remain hypotheses.

Comparison conversations:

- MCP: https://chatgpt.com/c/6ad891dd-c544-83ed-b561-c12e7ec2710e
- No-tool control: https://chatgpt.com/c/6ad8ac03-5424-83eb-bbd3-f3647da6647b

Only regression tests and this report were added. Runtime serialization, authentication,
authorization, idempotency and dependencies are unchanged. The safe next remedy is to
use the verified working browser, then troubleshoot the affected Chrome session without
regenerating write requests. Clearing site data or changing extensions requires a
separate, explicit decision; neither was done here.

### Automated validation

- 27 tests passed across `mcp.test.ts` (17), `mcp-grants.test.ts` (5), and
  `mcp-response-formats.test.ts` (5).
- All 13 Wally tools round-trip through the official SDK Streamable HTTP client.
- Text-only, structured content, metadata, execution errors and a deliberate declared
  output-schema mismatch were checked with SDK result validation.
- Replay, conflicting operation IDs, stale revisions, denied access, revoked replay,
  malformed JSON and notification status/body checks pass.
- API typecheck, focused ESLint, Prettier and tracked diff whitespace checks pass.

Commands run from the host against the existing isolated local container:

```sh
docker exec -w /app -e AUTH0_ENABLED=false -e ASSISTANT_ENABLED=false -e MCP_ENABLED=false -e MCP_WRITES_ENABLED=false wally-mcp-local-api-1 env -u MCP_LOCAL_URL pnpm --filter @wally/api exec vitest run test/mcp-response-formats.test.ts test/mcp.test.ts test/mcp-grants.test.ts --maxWorkers=1
docker exec -w /app wally-mcp-local-api-1 pnpm --filter @wally/api typecheck
docker exec -w /app wally-mcp-local-api-1 pnpm --filter @wally/api exec eslint test/mcp.test.ts test/mcp-response-formats.test.ts
docker exec -w /app wally-mcp-local-api-1 pnpm exec prettier --check apps/api/test/mcp.test.ts apps/api/test/mcp-response-formats.test.ts docs/MCP_RESPONSE_INVESTIGATION.md
```

These automated tests use synthetic authentication. Prior real Auth0/ChatGPT manual
execution is separate evidence, and the browser comparison above verifies rendering of
those saved results. Neither automated success nor Inspector synthetic success proves
new end-to-end OAuth sessions work. At the end of that diagnostic comparison, manual grants were revoked; the later
manual-testing continuity entry in `MCP_LOCAL_VALIDATION.md` supersedes that state. No production writes
or real user data changes occurred during this diagnostic comparison.
