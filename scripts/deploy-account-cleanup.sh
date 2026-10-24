#!/usr/bin/env bash
# Called by the approved production release workflow, using the exact API image.
set -euo pipefail
: "${GCP_PROJECT_ID:?}"
: "${GCP_REGION:?}"
: "${ACCOUNT_CLEANUP_IMAGE:?}"
: "${AUTH0_MANAGEMENT_DOMAIN:?}"
: "${AUTH0_CLEANUP_CLIENT_ID:?}"
: "${AUTH0_CLEANUP_SECRET_VERSION:?Secret Manager name:version is required}"
worker="wally-account-cleanup@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
scheduler="wally-account-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
# Bootstrap owns IAM, scheduler provisioning and TTL. Never create them here.
# All reads must succeed before replacement; a denied lookup is not absence.
state=$(gcloud scheduler jobs describe wally-account-cleanup \
  --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format=json)
jq -e '.state == "PAUSED"' <<<"$state" >/dev/null \
  || { echo "Cleanup scheduler must be paused before worker replacement" >&2; exit 1; }
policy=$(gcloud run jobs get-iam-policy wally-account-cleanup \
  --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json)
jq -e --arg member "serviceAccount:${scheduler}" \
  'any(.bindings[]?; .role == "roles/run.invoker" and (.condition == null) and any(.members[]?; . == $member))' \
  <<<"$policy" >/dev/null || { echo "Cleanup invocation binding missing; complete bootstrap" >&2; exit 1; }
executions=$(gcloud run jobs executions list --job=wally-account-cleanup \
  --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json)
jq -e 'type == "array" and all(.[]; .status.completionTime != null)' <<<"$executions" >/dev/null \
  || { echo "Cleanup execution still active; do not replace worker" >&2; exit 1; }
gcloud run jobs deploy wally-account-cleanup \
  --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
  --image="$ACCOUNT_CLEANUP_IMAGE" --service-account="$worker" \
  --command=node --args=dist/account-maintenance.js,--apply \
  --tasks=1 --parallelism=1 --max-retries=3 --task-timeout=1800s \
  --set-env-vars="^@^NODE_ENV=production@FIREBASE_PROJECT_ID=${GCP_PROJECT_ID}@FIRESTORE_DATABASE_ID=wally@AUTH0_ISSUER=https://login.luminull.com/@AUTH0_MANAGEMENT_DOMAIN=${AUTH0_MANAGEMENT_DOMAIN}@AUTH0_CLEANUP_CLIENT_ID=${AUTH0_CLEANUP_CLIENT_ID}" \
  --set-secrets="AUTH0_CLEANUP_CLIENT_SECRET=${AUTH0_CLEANUP_SECRET_VERSION}"
gcloud run jobs describe wally-account-cleanup \
  --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
  | jq -e 'any(.status.conditions[]?; .type == "Ready" and .status == "True")' >/dev/null
