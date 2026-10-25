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
location=(--project="$GCP_PROJECT_ID" --location="$GCP_REGION")
region=(--project="$GCP_PROJECT_ID" --region="$GCP_REGION")
# Bootstrap owns IAM, scheduler provisioning and TTL. Never create them here.
# All reads must succeed before replacement; a denied lookup is not absence.
scheduler_state() {
  gcloud scheduler jobs describe wally-account-cleanup "${location[@]}" --format=json | jq -er '.state'
}
# The worker is never replaced while the schedule can start it. Pause it here and verify
# the pause; the release resumes it once API and Hosting are ready, and recovery puts back
# the state it had before this release.
state=$(scheduler_state)
if [ "$state" != PAUSED ]; then
  # A transport error can happen after the server applied the pause, so read it back.
  gcloud scheduler jobs pause wally-account-cleanup "${location[@]}" || true
  [ "$(scheduler_state)" = PAUSED ] \
    || { echo "Cleanup scheduler did not pause; worker not replaced" >&2; exit 1; }
fi
policy=$(gcloud run jobs get-iam-policy wally-account-cleanup "${region[@]}" --format=json)
jq -e --arg member "serviceAccount:${scheduler}" \
  'any(.bindings[]?; .role == "roles/run.invoker" and (.condition == null) and any(.members[]?; . == $member))' \
  <<<"$policy" >/dev/null || { echo "Cleanup invocation binding missing; complete bootstrap" >&2; exit 1; }
# An execution the schedule started just before the pause may still be running. Each one
# is resumable, so wait for it rather than replacing the worker underneath it.
deadline=$((SECONDS + ${CLEANUP_DRAIN_SECONDS:-900}))
until gcloud run jobs executions list --job=wally-account-cleanup "${region[@]}" --format=json \
  | jq -e 'type == "array" and all(.[]; .status.completionTime != null)' >/dev/null; do
  [ "$SECONDS" -lt "$deadline" ] \
    || { echo "Cleanup execution still active; do not replace worker" >&2; exit 1; }
  echo "waiting for the active cleanup execution to finish"
  sleep "${CLEANUP_POLL_SECONDS:-15}"
done
gcloud run jobs deploy wally-account-cleanup "${region[@]}" \
  --image="$ACCOUNT_CLEANUP_IMAGE" --service-account="$worker" \
  --command=node --args=dist/account-maintenance.js,--apply \
  --tasks=1 --parallelism=1 --max-retries=3 --task-timeout=1800s \
  --set-env-vars="^@^NODE_ENV=production@FIREBASE_PROJECT_ID=${GCP_PROJECT_ID}@FIRESTORE_DATABASE_ID=wally@AUTH0_ISSUER=https://login.luminull.com/@AUTH0_MANAGEMENT_DOMAIN=${AUTH0_MANAGEMENT_DOMAIN}@AUTH0_CLEANUP_CLIENT_ID=${AUTH0_CLEANUP_CLIENT_ID}" \
  --set-secrets="AUTH0_CLEANUP_CLIENT_SECRET=${AUTH0_CLEANUP_SECRET_VERSION}"
gcloud run jobs describe wally-account-cleanup "${region[@]}" --format=json \
  | jq -e 'any(.status.conditions[]?; .type == "Ready" and .status == "True")' >/dev/null
# Prove the deployed worker works before anything is published: the new image starts
# under the worker identity, reads the database, may delete Firebase users and holds an
# Auth0 token with exactly delete:users. It deletes nothing (account-maintenance --check).
# --wait exits non-zero when the execution fails, which stops the release and restores
# the previous worker.
gcloud run jobs execute wally-account-cleanup "${region[@]}" \
  --args=dist/account-maintenance.js,--check --task-timeout=300s --wait
