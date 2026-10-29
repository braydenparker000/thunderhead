#!/usr/bin/env bash
# Publishes the staged site (.deploy/site from scripts/stage.mjs) to the storage account's
# $web container: assets first, then pages, then the service worker, then release.json last, so release.json only
# names this commit once everything is up. Then it waits until the live site reports the
# commit and removes files that are no longer part of the site.
# Needs: `az login` done, AZURE_STORAGE_ACCOUNT, SITE_URL. Usage: scripts/deploy.sh <commit-sha>
set -euo pipefail
sha="${1:?commit sha}"
account="${AZURE_STORAGE_ACCOUNT:?set AZURE_STORAGE_ACCOUNT}"
site="${SITE_URL:?set SITE_URL}"; site="${site%/}"
out=.deploy/site

# The deploy identity can also write the old site's account. Only ever touch a thunderhead* account.
[[ "$account" =~ ^thunderhead[a-z0-9]{0,13}$ ]] || { echo "refusing to deploy to storage account '$account'" >&2; exit 1; }
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit sha: $sha" >&2; exit 1; }
[[ -f "$out/index.html" && -f .deploy/release.json ]] || { echo "run scripts/stage.mjs first" >&2; exit 1; }
grep -q "\"commit\":\"$sha\"" .deploy/release.json || { echo "staged release is not $sha" >&2; exit 1; }

az_blob() { az storage blob "$@" --account-name "$account" --auth-mode login --only-show-errors; }

az_blob upload-batch --destination '$web' --source "$out" --pattern 'ui/*' \
  --overwrite --content-cache-control 'no-cache' --output none
az_blob upload-batch --destination '$web' --source "$out" --pattern 'apps/*' \
  --overwrite --content-cache-control 'no-cache' --output none
az_blob upload-batch --destination '$web' --source "$out" \
  --overwrite --content-cache-control 'no-cache' --output none
# The service worker's list and the worker go up again once everything they name is there, so
# a phone that installs the new worker finds the whole release (it also checks build and sizes).
for name in precache.json sw.js; do
  az_blob upload --container-name '$web' --name "$name" --file "$out/$name" \
    --overwrite --content-cache-control 'no-cache' --output none
done
az_blob upload --container-name '$web' --name release.json --file .deploy/release.json \
  --overwrite --content-type 'application/json' --content-cache-control 'no-cache' --output none

live=no
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  body="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "$site/release.json?t=$attempt" || true)"
  if [[ "$body" == *"\"commit\":\"$sha\""* ]]; then live=yes; break; fi
  sleep 3
done
[[ "$live" == yes ]] || { echo "the live site does not report $sha" >&2; exit 1; }
echo "live: $sha"

# Remove blobs that are not in this build (blob soft delete keeps them 7 days).
# A cleanup problem is only a warning: it never fails or rolls back a good deploy.
{ (cd "$out" && find . -type f | sed 's|^\./||'); echo release.json; } | LC_ALL=C sort > .deploy/keep.txt
if az_blob list --container-name '$web' --num-results '*' --query '[].name' --output tsv | LC_ALL=C sort > .deploy/live.txt; then
  LC_ALL=C comm -23 .deploy/live.txt .deploy/keep.txt > .deploy/stale.txt
  count="$(wc -l < .deploy/stale.txt)"
  if (( count > 50 )); then
    echo "::warning::not removing $count stale files; check the \$web container by hand"
  else
    while IFS= read -r name; do
      echo "remove: $name"
      az_blob delete --container-name '$web' --name "$name" --output none || echo "::warning::could not remove $name"
    done < .deploy/stale.txt
  fi
else
  echo "::warning::could not list \$web; skipped cleanup"
fi
