# ADR-0015: Cloudflare DNS for Wally custom domains

- **Status:** superseded by [ADR-0022](0022-cloudflare-pages-and-api-proxy.md)
- **Date:** 2026-10-19
- **Deciders:** Milad Rezazadeh

## Context and problem statement

`luminull.com` is managed in Cloudflare. Wally needs branded web and API addresses while retaining Firebase Hosting and Cloud Run, as chosen in [ADR-0008](0008-tag-triggered-release-to-hosting-and-cloud-run.md).

## Considered options

1. Keep the provider-generated addresses as the public addresses.
2. Add custom domains through Cloudflare DNS, retaining the existing hosts.
3. Move hosting to Cloudflare.

## Decision outcome

Use **Cloudflare for DNS**, with DNS-only records pointing to the existing Google services. TLS certificates are managed by the destination services. This records the setup performed on 2026-10-19; it does not adopt a hosting migration.

- Connected `wally.luminull.com` to Firebase Hosting; HTTPS was verified working.
- Created a Cloud Run domain mapping from `api.wally.luminull.com` to `wally-api` in `europe-west1`, with the Cloudflare CNAME `api.wally` pointing to `ghs.googlehosted.com`.
- Updated the live API's `CORS_ORIGIN` to `https://wally.luminull.com`; health and CORS preflight checks passed.
- Updated the GitHub repository variable `WEB_ORIGIN` to the same web origin so subsequent releases retain it.

### Consequences and remaining work

- Good: branded addresses without moving the application or changing the release platform.
- Bad: DNS, hosting and certificate provisioning span Cloudflare and Google.
- At the last setup check, the API domain certificate was still provisioning. API HTTPS readiness remains unverified.
- The deployed web bundle still calls the existing `run.app` API URL. Switching it requires verifying API HTTPS, updating `API_BASE_URL`, rebuilding the web, and adapting the release workflow's check that currently requires the provider URL. DNS alone does not change browser API calls.
- Direct Cloud Run domain mapping is Preview; production ingress remains a separate decision.

## More information

- Deployment guide: [DEPLOY.md](../DEPLOY.md).
- Release configuration: [release.yml](../../.github/workflows/release.yml).
