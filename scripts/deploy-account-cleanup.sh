#!/usr/bin/env bash
# Operator script: sets the account-cleanup worker's full configuration (identity, settings,
# secret). Run it when one of those changes. Releases only move the worker to the new image
# (release.yml, "Move the account-cleanup worker to this release"), so this is not a
# release step. Deletions are leased and resumable, so it is safe while the schedule runs.
set -euo pipefail
: "${GCP_PROJECT_ID:?}"
: "${GCP_REGION:?}"
: "${ACCOUNT_CLEANUP_IMAGE:?}"
: "${AUTH0_MANAGEMENT_DOMAIN:?}"
: "${AUTH0_CLEANUP_CLIENT_ID:?}"
: "${AUTH0_CLEANUP_SECRET_VERSION:?Secret Manager name:version is required}"
gcloud run jobs deploy wally-account-cleanup --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
  --image="$ACCOUNT_CLEANUP_IMAGE" \
  --service-account="wally-account-cleanup@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --command=node --args=dist/account-maintenance.js,--apply \
  --tasks=1 --parallelism=1 --max-retries=3 --task-timeout=1800s \
  --set-env-vars="^@^NODE_ENV=production@FIREBASE_PROJECT_ID=${GCP_PROJECT_ID}@FIRESTORE_DATABASE_ID=wally@AUTH0_ISSUER=https://login.luminull.com/@AUTH0_MANAGEMENT_DOMAIN=${AUTH0_MANAGEMENT_DOMAIN}@AUTH0_CLEANUP_CLIENT_ID=${AUTH0_CLEANUP_CLIENT_ID}" \
  --set-secrets="AUTH0_CLEANUP_CLIENT_SECRET=${AUTH0_CLEANUP_SECRET_VERSION}"
