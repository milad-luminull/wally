# EU platform and durable AI workers

- **Status:** superseded on 2026-10-26 by [Platform migration](0011-platform-migration.md).
- **Date:** 2026-10-19
- **Research:** [Provider comparison and costs](../researches/2026-10-19-provider-strategy.md)

This overview picked Supabase for data and files, and Auth0 for identity, with Firebase
Hosting kept and a ceiling of €30/month excluding AI. On 2026-10-26 the owner replaced
those choices:

- **Identity and MCP:** Supabase Auth (Auth0 is decommissioned).
- **Web app:** Cloudflare Pages.
- **API domain:** a Cloudflare Worker proxy.
- **Notification events:** Supabase Realtime.
- **Budget:** a target of $0/month in development and under $50/month for the initial
  release.

The workstream RFCs it linked are still current, with their identity references updated:

- [Firestore → Supabase](0008-firestore-to-supabase.md): persistence migration and cutover.
- [Identity and MCP on Supabase Auth](0012-supabase-auth-and-mcp.md): replaces the provider
  choice in [Auth0 login and MCP](0006-auth0-mcp-rollout.md).
- [Private uploads and retrieval](0009-uploads-and-retrieval.md): files and document search.
- [Durable AI workers](0010-durable-ai-workers.md): background agents, queues and jobs.
