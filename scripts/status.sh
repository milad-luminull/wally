#!/usr/bin/env bash
# Where every change stands, in pipeline order: open pull requests, runs waiting for an
# approval, the last Terraform run on main, and whether a release is due. Ends with what is
# waiting on the owner. See docs/DEPLOY.md, "Lifecycle of a change".
#
# Read-only: it never approves, merges, tags or pushes. Needs gh and jq, and runs on the
# bash 3.2 that macOS ships.
set -euo pipefail

REPO=milad-luminull/wally
OWNER_ACCOUNT=milad-luminull
# Paths the release deploys, and those the Infrastructure workflow plans after a merge.
APP_PATHS='^(apps/(web|api|api-proxy)|packages)/'
TERRAFORM_PATHS='^(infra/terraform/wally/|infra/auth0-post-login\.cjs$)'

command -v gh >/dev/null || { echo "status: gh is not installed" >&2; exit 1; }
command -v jq >/dev/null || { echo "status: jq is not installed" >&2; exit 1; }

# gh may hold several accounts; only one of them can read this repository.
active=$(gh api user --jq .login 2>/dev/null || true)
if [ "$active" != "$OWNER_ACCOUNT" ]; then
  echo "status: gh's active account is '${active:-none}', not $OWNER_ACCOUNT." >&2
  echo "        Run: gh auth switch --user $OWNER_ACCOUNT" >&2
  exit 1
fi

actions=()
add_action() { actions+=("$1"); }

section() { printf '\n== %s ==\n' "$1"; }

# ─── 1. Open pull requests ──────────────────────────────────────────────────────────────────
section "Open pull requests"
prs=$(gh pr list -R "$REPO" --state open --limit 50 \
  --json number,title,url,isDraft,mergeable,mergeStateStatus,statusCheckRollup,files)
if [ "$(jq length <<<"$prs")" -eq 0 ]; then
  echo "none"
else
  # One tab-separated line per PR: number, draft, CI, mergeable, merge state, terraform, app,
  # the owner's next action (or "-"), title, url. CI folds check runs (status, conclusion) and
  # commit statuses (state) into one word.
  while IFS=$'\t' read -r number draft ci mergeable state terraform app todo title url; do
    after=""
    [ "$terraform" = "true" ] && after="${after}, starts a Terraform plan"
    [ "$app" = "true" ] && after="${after}, needs a release"
    [ -n "$after" ] || after=", nothing after merge"
    kind=""
    [ "$draft" = "true" ] && kind=" (draft)"
    printf '#%s%s %s\n    CI %s, mergeable %s (%s)%s\n    %s\n' \
      "$number" "$kind" "$title" "$ci" "$mergeable" "$state" "$after" "$url"
    [ "$todo" = "-" ] || add_action "PR #$number: $todo: $url"
  done < <(jq -r --arg app "$APP_PATHS" --arg tf "$TERRAFORM_PATHS" '
    def outcome:
      if .__typename == "StatusContext" then
        (if .state == "SUCCESS" then "pass"
         elif (.state == "PENDING" or .state == "EXPECTED") then "pending" else "fail" end)
      elif .status != "COMPLETED" then "pending"
      elif (.conclusion == "SUCCESS" or .conclusion == "SKIPPED" or .conclusion == "NEUTRAL") then "pass"
      else "fail" end;
    .[]
    | [.statusCheckRollup[]? | outcome] as $checks
    | (if ($checks | index("fail")) != null then "failing"
       elif ($checks | index("pending")) != null then "running"
       elif ($checks | length) == 0 then "not started"
       else "passing" end) as $ci
    | [(.files // [])[].path] as $paths
    | (if .isDraft then "-"
       elif .mergeable == "CONFLICTING" then "resolve the merge conflict"
       elif $ci == "failing" then "CI is failing, fix it"
       elif $ci == "passing" then "CI passed, review and merge"
       else "-" end) as $todo
    | [ .number, .isDraft, $ci, .mergeable, .mergeStateStatus,
        ([$paths[] | select(test($tf))] | length > 0),
        ([$paths[] | select(test($app)) | select(endswith(".md") | not)] | length > 0),
        $todo, .title, .url ]
    | @tsv' <<<"$prs")
fi

# ─── 2. Runs waiting for an approval ────────────────────────────────────────────────────────
section "Runs waiting for an approval"
waiting=$(gh run list -R "$REPO" --status waiting --limit 20 \
  --json workflowName,headBranch,displayTitle,url,createdAt)
if [ "$(jq length <<<"$waiting")" -eq 0 ]; then
  echo "none"
else
  jq -r '.[] | "\(.workflowName) on \(.headBranch): \(.displayTitle)\n    since \(.createdAt)  \(.url)"' <<<"$waiting"
  while IFS=$'\t' read -r workflow ref url; do
    add_action "Approve $workflow for $ref after checking it: $url"
  done < <(jq -r '.[] | [.workflowName, .headBranch, .url] | @tsv' <<<"$waiting")
fi

# ─── 3. Terraform on main ───────────────────────────────────────────────────────────────────
section "Terraform (Infrastructure workflow on main)"
infra=$(gh run list -R "$REPO" --workflow infrastructure.yml --branch main --limit 1 \
  --json databaseId,status,conclusion,displayTitle,url,createdAt)
if [ "$(jq length <<<"$infra")" -eq 0 ]; then
  echo "no run on main yet"
else
  # Only the latest run counts: a failure that a later successful run followed is settled.
  run_id=$(jq -r '.[0].databaseId' <<<"$infra")
  status=$(jq -r '.[0].status' <<<"$infra")
  conclusion=$(jq -r '.[0].conclusion // ""' <<<"$infra")
  url=$(jq -r '.[0].url' <<<"$infra")
  jq -r '.[0] | "\(.displayTitle)\n    \(.createdAt)  \(.url)"' <<<"$infra"
  gh run view "$run_id" -R "$REPO" --json jobs \
    --jq '.jobs[] | select(.name != "Format and validate")
          | "    \(.name): \(if .status == "completed" then .conclusion else .status end)"'
  if [ "$status" = "completed" ]; then
    if [ "$conclusion" = "success" ]; then
      echo "    applied; nothing open"
    else
      echo "    $conclusion"
      add_action "The latest Infrastructure run on main ended '$conclusion'; read it, fix, and re-run: $url"
    fi
  elif [ "$status" != "waiting" ]; then
    # A waiting run is already listed in section 2.
    echo "    $status"
  fi
fi

# ─── 4. Release ─────────────────────────────────────────────────────────────────────────────
section "Release"
latest_tag=$(gh api "repos/$REPO/git/matching-refs/tags/v" --paginate --jq '.[].ref' |
  sed -n 's#^refs/tags/v\([0-9]*\.[0-9]*\.[0-9]*\)$#\1#p' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
if [ -z "$latest_tag" ]; then
  echo "no v* tag yet"
else
  latest_tag="v$latest_tag"
  release=$(gh run list -R "$REPO" --workflow release.yml --branch "$latest_tag" --limit 1 \
    --json status,conclusion,url)
  release_state=$(jq -r 'if length == 0 then "no release run"
    elif .[0].status == "completed" then .[0].conclusion else .[0].status end' <<<"$release")
  release_url=$(jq -r '.[0].url // ""' <<<"$release")
  echo "latest tag $latest_tag: release $release_state ${release_url}"
  case "$release_state" in
    success | in_progress | queued | waiting | pending | requested) ;;
    *) add_action "The release of $latest_tag ended '$release_state'; see docs/DEPLOY.md, 'When a release fails': $release_url" ;;
  esac

  compare=$(gh api "repos/$REPO/compare/$latest_tag...main")
  ahead=$(jq -r .ahead_by <<<"$compare")
  echo "commits on main since $latest_tag: $ahead"
  jq -r '.commits[] | "    \(.sha[0:8]) \(.commit.message | split("\n")[0])"' <<<"$compare"
  app_files=$(jq -r --arg app "$APP_PATHS" \
    '[.files[]?.filename | select(test($app)) | select(endswith(".md") | not)] | length' <<<"$compare")
  if [ "$ahead" -eq 0 ]; then
    echo "no release needed: main is at $latest_tag"
  elif [ "$app_files" -eq 0 ]; then
    echo "no release needed: no change to apps/web, apps/api, apps/api-proxy or packages"
  else
    # 0.x: a feature or a breaking change bumps the minor version, anything else the patch.
    IFS=. read -r major minor patch <<<"${latest_tag#v}"
    if jq -e '[.commits[].commit.message | split("\n")[0] | select(test("^[a-z]+(\\([^)]*\\))?!:|^feat(\\([^)]*\\))?:"))] | length > 0' \
      <<<"$compare" >/dev/null; then
      next="v$major.$((minor + 1)).0"
    else
      next="v$major.$minor.$((patch + 1))"
    fi
    head_sha=$(gh api "repos/$REPO/commits/main" --jq .sha)
    ci=$(gh run list -R "$REPO" --workflow ci.yml --branch main --event push --commit "$head_sha" \
      --limit 1 --json status,conclusion \
      --jq 'if length == 0 then "not started" elif .[0].status == "completed" then .[0].conclusion else .[0].status end')
    echo "release due: $app_files app file(s) changed; suggested tag $next on main ${head_sha:0:8} (CI on it: $ci)"
    case "$release_state" in
      in_progress | queued | waiting | pending | requested)
        echo "    wait for the release of $latest_tag to finish first" ;;
      *)
        push="push $next (git tag $next ${head_sha:0:8} && git push origin $next), then approve the deploy"
        if [ "$ci" = "success" ]; then
          add_action "Release: $push"
        else
          add_action "Release: wait for CI on main ${head_sha:0:8} to pass (now: $ci), then $push"
        fi ;;
    esac
  fi
fi

# ─── Verdict ────────────────────────────────────────────────────────────────────────────────
section "Next"
if [ "${#actions[@]}" -eq 0 ]; then
  echo "Nothing waiting on you."
else
  i=1
  for action in "${actions[@]}"; do
    echo "$i. $action"
    i=$((i + 1))
  done
fi
