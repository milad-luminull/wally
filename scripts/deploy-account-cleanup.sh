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
# Accounts and least-privilege IAM are provisioned and reviewed before this workflow.
# Do not give the public API runtime Auth0 Management API credentials.
gcloud run jobs deploy wally-account-cleanup \
  --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
  --image="$ACCOUNT_CLEANUP_IMAGE" --service-account="$worker" \
  --command=node --args=dist/account-maintenance.js,--apply \
  --tasks=1 --parallelism=1 --max-retries=3 --task-timeout=1800s \
  --set-env-vars="^@^NODE_ENV=production@FIREBASE_PROJECT_ID=${GCP_PROJECT_ID}@FIRESTORE_DATABASE_ID=wally@AUTH0_ISSUER=https://login.luminull.com/@AUTH0_MANAGEMENT_DOMAIN=${AUTH0_MANAGEMENT_DOMAIN}@AUTH0_CLEANUP_CLIENT_ID=${AUTH0_CLEANUP_CLIENT_ID}" \
  --set-secrets="AUTH0_CLEANUP_CLIENT_SECRET=${AUTH0_CLEANUP_SECRET_VERSION}"
verb=create
if gcloud scheduler jobs describe wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION" >/dev/null 2>&1; then verb=update; fi
gcloud scheduler jobs "$verb" http wally-account-cleanup \
  --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
  --schedule='*/5 * * * *' --time-zone=Etc/UTC \
  --uri="https://run.googleapis.com/v2/projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/jobs/wally-account-cleanup:run" \
  --http-method=POST --oauth-service-account-email="$scheduler" \
  --headers=Content-Type=application/json --message-body='{}' \
  --attempt-deadline=30s
# This verification is read-only: deployment must not itself delete production accounts.
gcloud run jobs describe wally-account-cleanup --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format='value(name)'
gcloud scheduler jobs describe wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format='value(state,schedule)'

# Only completed jobs receive expiresAt. Pending cleanup and denial markers never expire.
gcloud firestore fields ttls update expiresAt --collection-group=accountDeletionJobs \
  --database=wally --project="$GCP_PROJECT_ID" --enable-ttl --quiet
