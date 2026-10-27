#!/usr/bin/env bash
#
# One-time Google Cloud setup for keyless GitHub Actions deploys.
#
# Run it once, from anywhere, as a human with admin on the project:
#     ./scripts/bootstrap-gcp-cicd.sh
#
# It is idempotent — every create is guarded, and IAM bindings are naturally idempotent —
# so re-running after a partial failure is safe.
#
# Why Workload Identity Federation rather than a service-account key: the organization
# enforces iam.disableServiceAccountKeyCreation, so a key cannot be created at all. WIF is
# not a preference here, it is the only mechanism available. See docs/DEPLOY.md.
set -euo pipefail

# ─── configuration ───────────────────────────────────────────────────────────────────
PROJECT_ID="luminull-wally"
PROJECT_NUMBER="128432325938"
REGION="europe-west1"

AR_REPO="wally"
RUN_SERVICE="wally-api"
RUNTIME_SA="wally-api@${PROJECT_ID}.iam.gserviceaccount.com"

DEPLOY_SA_ID="github-deployer"
DEPLOY_SA="${DEPLOY_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

POOL_ID="github"
PROVIDER_ID="wally-prod"

GH_REPO="milad-luminull/wally"
# NUMERIC ids, not names. A released GitHub username can be re-registered by someone else;
# the numeric id cannot. Refresh with:
#   gh api repos/milad-luminull/wally --jq '{repo: .id, owner: .owner.id}'
GH_REPO_ID="1376336905"
GH_OWNER_ID="331026245"
GH_ENV="production"
# ─────────────────────────────────────────────────────────────────────────────────────

MEMBER="serviceAccount:${DEPLOY_SA}"
POOL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"
PROVIDER="${POOL}/providers/${PROVIDER_ID}"
PRINCIPAL_SET="principalSet://iam.googleapis.com/${POOL}/attribute.repository/${GH_REPO}"

say() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

gcloud config set project "${PROJECT_ID}" >/dev/null

# ─── 0. read-only pre-flight ─────────────────────────────────────────────────────────
# These two org policies have already broken the tutorial path once on this project
# (allUsers on Cloud Run). Read them before building anything on top.
say "Effective domain-restricted-sharing policy"
gcloud org-policies describe iam.allowedPolicyMemberDomains --project="${PROJECT_ID}" --effective || true
cat <<'NOTE'
  Expect Workspace customer IDs (C0xxxxxxx) or principalSet://goog/organizations/<ORG_ID>.
  Either permits workload identity pools that live in a project inside the organization,
  so the binding in step 4 is allowed. This is NOT the same as allUsers, which belongs to
  no domain and can never be permitted — that asymmetry is why section 9c of docs/DEPLOY.md
  had to use --no-invoker-iam-check.
NOTE

say "Allowed WIF issuers (NOT_FOUND / no policy set == unconstrained == fine)"
gcloud org-policies describe iam.workloadIdentityPoolProviders --project="${PROJECT_ID}" --effective || true

say "Artifact Registry immutable tags (expect empty or False)"
gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" \
  --format="value(dockerConfig.immutableTags)" || true

read -rp $'\nDoes the pre-flight above look right? [y/N] ' ok
[ "${ok}" = "y" ] || { echo "aborted"; exit 1; }

# ─── 1. APIs ─────────────────────────────────────────────────────────────────────────
say "Enabling APIs"
gcloud services enable \
  sts.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  firebaserules.googleapis.com

# ─── 2. deployer service account ─────────────────────────────────────────────────────
say "Deployer service account"
gcloud iam service-accounts describe "${DEPLOY_SA}" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "${DEPLOY_SA_ID}" \
    --display-name="GitHub Actions deployer" \
    --description="Impersonated by ${GH_REPO} via WIF. Has no keys; the org policy forbids them."

# ─── 3. workload identity pool + provider ────────────────────────────────────────────
say "Workload identity pool and provider"
gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global --display-name="GitHub Actions" \
    --description="OIDC federation for GitHub Actions"

ATTR_MAP="google.subject=assertion.sub"
ATTR_MAP="${ATTR_MAP},attribute.repository=assertion.repository"
ATTR_MAP="${ATTR_MAP},attribute.repository_id=assertion.repository_id"
ATTR_MAP="${ATTR_MAP},attribute.repository_owner=assertion.repository_owner"
ATTR_MAP="${ATTR_MAP},attribute.repository_owner_id=assertion.repository_owner_id"
ATTR_MAP="${ATTR_MAP},attribute.environment=assertion.environment"
ATTR_MAP="${ATTR_MAP},attribute.ref=assertion.ref"

# token.actions.githubusercontent.com is ONE issuer shared by every repository on GitHub.
# Without an attribute condition this provider would accept a token minted by any workflow
# in any repo on the internet (the `aud` claim is caller-controlled, so it is not a
# boundary). That matters especially here: the repo is public, so the provider name and the
# deployer SA are visible in .github/workflows/release.yml.
#
# The `environment` term is what ties this to the GitHub Environment: GitHub only mints that
# claim for a job that declares `environment:`, and it enforces the environment's protection
# rules (required reviewers, the v* tag policy) BEFORE issuing the token. That is stronger
# than pinning assertion.ref, and it does not break a re-run from a different ref.
ATTR_COND="assertion.repository_owner_id == \"${GH_OWNER_ID}\""
ATTR_COND="${ATTR_COND} && assertion.repository_id == \"${GH_REPO_ID}\""
ATTR_COND="${ATTR_COND} && assertion.environment == \"${GH_ENV}\""

if gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
     --location=global --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" \
    --attribute-mapping="${ATTR_MAP}" --attribute-condition="${ATTR_COND}"
else
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" \
    --display-name="${GH_REPO} ${GH_ENV}" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="${ATTR_MAP}" --attribute-condition="${ATTR_COND}"
fi

# ─── 4. allow the repo to impersonate the deployer ───────────────────────────────────
# This is the binding domain-restricted sharing could plausibly reject. If it fails with
# FAILED_PRECONDITION ("do not belong to a permitted customer"), stop and read the note in
# step 0 — do NOT relax the org policy to Allow All.
say "Letting ${GH_REPO} impersonate the deployer"
gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA}" \
  --role="roles/iam.workloadIdentityUser" --member="${PRINCIPAL_SET}"

# ─── 5. deploy permissions, least privilege ──────────────────────────────────────────
say "Granting deploy permissions"

# Scoped to the repository, not the project.
gcloud artifacts repositories add-iam-policy-binding "${AR_REPO}" \
  --location="${REGION}" --member="${MEMBER}" --role="roles/artifactregistry.writer"

# Scoped to the runtime SA, not the project. A project-wide serviceAccountUser would let the
# deployer act as EVERY service account in the project, including future ones with broader
# rights. This is the single most important scoping decision here.
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="${MEMBER}" --role="roles/iam.serviceAccountUser"

# roles/run.developer, not run.admin: admin is only needed for run.services.setIamPolicy,
# i.e. --no-invoker-iam-check. That is a one-off human action and the setting already
# persists across revisions, so CI never needs the power to change a service's IAM policy.
#
# firebasehosting.admin, not firebase.admin: the narrow role carries firebase.projects.get
# (the CLI's base permission) plus firebasehosting.sites.update, which is all `deploy --only
# hosting` preflights. firebase.admin is ~780 permissions including full Firestore data
# access.
#
# serviceUsageConsumer is genuinely required: the CLI's ensureApiEnabled() sends
# x-goog-user-project and does not swallow a permission error.
for ROLE in \
  roles/run.developer \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="${MEMBER}" --role="${ROLE}" --condition=None >/dev/null
  echo "  granted ${ROLE}"
done

# ─── 6. GitHub side ──────────────────────────────────────────────────────────────────
say "GitHub repository variables"
gh variable set GCP_PROJECT_ID  --repo "${GH_REPO}" --body "${PROJECT_ID}"
gh variable set GCP_REGION      --repo "${GH_REPO}" --body "${REGION}"
gh variable set GCP_WIF_PROVIDER --repo "${GH_REPO}" --body "${PROVIDER}"
gh variable set GCP_DEPLOY_SA   --repo "${GH_REPO}" --body "${DEPLOY_SA}"

say "GitHub environment '${GH_ENV}' with a v* tag policy"
gh api -X PUT "repos/${GH_REPO}/environments/${GH_ENV}" \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true" >/dev/null
gh api -X POST "repos/${GH_REPO}/environments/${GH_ENV}/deployment-branch-policies" \
  -f name='v*' -f type='tag' >/dev/null 2>&1 || echo "  (tag policy already present)"

# ─── 7. verify ───────────────────────────────────────────────────────────────────────
say "Provider"
gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --location=global --workload-identity-pool="${POOL_ID}" \
  --format="yaml(attributeCondition,oidc.issuerUri,state)"

say "Who may impersonate the deployer"
gcloud iam service-accounts get-iam-policy "${DEPLOY_SA}" --format=json

say "Invoker IAM check still disabled on Cloud Run (expect True)"
gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" \
  --format="value(metadata.annotations.'run.googleapis.com/invoker-iam-disabled')"

cat <<EOF

Done. Still to do by hand:

  1. Add required reviewers to the '${GH_ENV}' environment (needs user ids; UI is easier):
       https://github.com/${GH_REPO}/settings/environments

  2. Set the remaining repository VARIABLES (public identifiers, not secrets). The domains
     are exact: scripts/check-api-domain.mjs stops a release on any other value.
       gh variable set API_BASE_URL              --repo ${GH_REPO} --body 'https://api.wally.luminull.com'
       gh variable set WEB_ORIGIN                --repo ${GH_REPO} --body 'https://wally.luminull.com'
       gh variable set FIREBASE_PROJECT_ID       --repo ${GH_REPO} --body '${PROJECT_ID}'
       gh variable set VITE_FIREBASE_API_KEY     --repo ${GH_REPO} --body '...'
       gh variable set VITE_FIREBASE_AUTH_DOMAIN --repo ${GH_REPO} --body '${PROJECT_ID}.firebaseapp.com'
       gh variable set VITE_FIREBASE_PROJECT_ID  --repo ${GH_REPO} --body '${PROJECT_ID}'
       gh variable set VITE_FIREBASE_APP_ID      --repo ${GH_REPO} --body '...'
     The production sign-in and MCP settings (unset, each defaults to false or firebase):
       gh variable set AUTH0_ENABLED             --repo ${GH_REPO} --body 'true'
       gh variable set AUTH0_SIGNUP_ENABLED      --repo ${GH_REPO} --body 'true'
       gh variable set VITE_AUTH_PROVIDER        --repo ${GH_REPO} --body 'auth0'
       gh variable set VITE_AUTH0_CLIENT_ID      --repo ${GH_REPO} --body '<public SPA client id>'
       gh variable set MCP_ENABLED               --repo ${GH_REPO} --body 'true'
       gh variable set MCP_WRITES_ENABLED        --repo ${GH_REPO} --body 'true'
       gh variable set MCP_CLIENT_ID             --repo ${GH_REPO} --body '<public MCP client id>'
     Optional, with the release's defaults: ASSISTANT_ENABLED (false), ASSISTANT_MODEL
     (vertex:gemini-3.8-flash), ASSISTANT_VERTEX_LOCATION (eu), E2E_AUTH_PROVIDER (firebase).
     For the opt-in Auth0 E2E path also set E2E_AUTH0_SUBJECT, E2E_AUTH0_EMAIL, E2E_AUTH0_DEPENDABOT_SUBJECT and
     E2E_AUTH0_DEPENDABOT_EMAIL (see apps/web/e2e/README.md).

  3. Set the three SECRETS, for throwaway test accounts that own no data you care about:
       gh secret set E2E_USER_EMAIL          --repo ${GH_REPO}   # Firebase CI account
       gh secret set E2E_USER_PASSWORD       --repo ${GH_REPO}
       gh secret set E2E_AUTH0_USER_PASSWORD --repo ${GH_REPO}   # Auth0 CI account
     Mirror each into Dependabot secrets too (the Auth0 one holds the Dependabot account's
     password), or Dependabot PRs trip the E2E guard:
       gh secret set E2E_USER_EMAIL          --repo ${GH_REPO} --app dependabot
       gh secret set E2E_USER_PASSWORD       --repo ${GH_REPO} --app dependabot
       gh secret set E2E_AUTH0_USER_PASSWORD --repo ${GH_REPO} --app dependabot

  4. Branch protection on main requiring: "Lint & format", "Typecheck & build",
     "Unit & integration tests", and "E2E gate" (the gate, NOT "E2E (full stack)" — a
     skipped required check counts as passing).
EOF
