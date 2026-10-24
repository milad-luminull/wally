#!/usr/bin/env bash
# Operator setup only. Never called by ordinary release or read-only preflight.
set -euo pipefail
[ "${1:-}" = --apply ] || { echo 'Usage: bootstrap-account-cleanup.sh --apply (operator credentials required)' >&2; exit 1; }
: "${GCP_PROJECT_ID:?}" "${GCP_REGION:?}"
scheduler="wally-account-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
job="projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/jobs/wally-account-cleanup"
# Reuse the prepared job; do not create a worker without a verified image/config.
gcloud run jobs describe wally-account-cleanup --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format='value(metadata.name)' >/dev/null
inventory=$(gcloud scheduler jobs list --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format=json)
jq -e 'type == "array"' <<<"$inventory" >/dev/null
if ! jq -e --arg name "$job" 'any(.[]; .name == $name)' <<<"$inventory" >/dev/null; then
  # The create command cannot create a paused job. Initial GET is read-only even
  # if scheduled before the pause; it cannot execute an account deletion.
  gcloud scheduler jobs create http wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
    --schedule='*/5 * * * *' --time-zone=Etc/UTC --uri="https://run.googleapis.com/v2/${job}" \
    --http-method=GET --oauth-service-account-email="$scheduler" --attempt-deadline=30s
fi
if [ "$(gcloud scheduler jobs describe wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format='value(state)')" != PAUSED ]; then
  gcloud scheduler jobs pause wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION"
fi
state=$(gcloud scheduler jobs describe wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format='value(state)')
[ "$state" = PAUSED ] || { echo 'Scheduler did not pause' >&2; exit 1; }
# The release may inspect job IAM and pause/resume an already prepared schedule.
# Only this operator bootstrap owns creation and grants; remove the old write powers.
gcloud iam roles update wallyCleanupJobIam --project="$GCP_PROJECT_ID" \
  --title='Wally cleanup job policy read' --permissions=run.jobs.getIamPolicy --quiet
gcloud iam roles update wallyScheduleDeployment --project="$GCP_PROJECT_ID" \
  --permissions=cloudscheduler.jobs.get,cloudscheduler.jobs.pause,cloudscheduler.jobs.enable --quiet
gcloud run jobs add-iam-policy-binding wally-account-cleanup --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
  --member="serviceAccount:${scheduler}" --role=roles/run.invoker
gcloud scheduler jobs update http wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION" \
  --schedule='*/5 * * * *' --time-zone=Etc/UTC --uri="https://run.googleapis.com/v2/${job}:run" \
  --http-method=POST --oauth-service-account-email="$scheduler" \
  --headers=Content-Type=application/json --message-body='{}' --attempt-deadline=30s
[ "$(gcloud scheduler jobs describe wally-account-cleanup --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format='value(state)')" = PAUSED ]
gcloud firestore fields ttls update expiresAt --collection-group=accountDeletionJobs \
  --database=wally --project="$GCP_PROJECT_ID" --enable-ttl --quiet
