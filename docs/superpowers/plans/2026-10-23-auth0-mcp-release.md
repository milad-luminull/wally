# Auth0 and full MCP release execution

> **Status:** executed. Released in v0.8.1 and later. Self-service export and deletion were removed again on 2026-10-26.

Approved user plan: one release with Auth0 login/signup, MCP reads+writes, card/list UI,
self-service account export/deletion. Preserve every existing user's identity/data.

## Checklist

- [ ] 1. Versioned no-store export API using existing visibility rules, tests.
- [ ] 2. Recent-auth deletion, immediate denial, durable cleanup and exact provider deletion;
      retries, races, tombstones, operator CLI and scheduled worker; tests.
- [ ] 3. English/German account controls and privacy notice; browser and unit tests.
- [ ] 4. Independent review and complete final CI; resolve concrete blockers.
- [ ] 5. Fresh source inventory; prepare exact Google-subject mappings for next-login migration; verify imported password identities without email linking.
- [x] 6. Separate real-inbox password recovery fixture; owner enters passwords; verify delivery/replay.
- [ ] 7. Owner approves finished privacy notice/provider arrangements.
- [ ] 8. Merge, exact-main CI, next patch tag, production environment approval; both MCP flags true.
- [ ] 9. Production disposable acceptance fixtures, OAuth and CSP widgets, export/deletion, rollback pair.
- [ ] 10. Observe for 30 minutes and record release evidence.

## Constraints and interfaces

No production activation until account continuity and privacy gates pass. Preserve original
checkout and wally-api-1. Tests use isolated emulator projects, never manual/production data.
GET /me/export returns a versioned JSON download. DELETE /me requires recent authentication
and confirmation; returns accepted pending cleanup, never premature success. Cleanup shares
an immediate account-denial fence with REST, MCP, signup and all transactional commands.
Owned boards are deleted for all members; shared contributions elsewhere are anonymized;
private contributions elsewhere are deleted. Keep user content until explicit deletion.
Provider failures keep the job pending. Never remove revocation protection prematurely.

## Execution record

- Baseline 428c84fe: all PR checks green; prior API 699 tests passed.
- Tasks 1–3 share auth identity, account routes, localized UI and data visibility.
- Tasks 2 and 8 share cleanup worker credentials/schedule; deployment must configure them.
- User authorization includes merge/migration/release/fixture writes after the plan gates.

- Owner correction, 2026-10-23: existing Google users migrate at their next normal sign-in;
  do not require advance authentication or user outreach. Prepare mappings from fresh
  Firebase provider IDs; signed Auth0 proof is still required at login.
- Owner confirms privacy@luminull.com receives mail; EN/DE privacy and deletion contact updated.
